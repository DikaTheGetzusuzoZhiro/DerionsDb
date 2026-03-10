const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder 
} = require("discord.js");

const axios = require("axios");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =======================
// 🔒 CHANNEL CONFIG
// =======================

const scannerChannelId = "1477131305765572618";
const aiChannelId = "1475164217115021475";

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];

// =======================
// 🔎 DETECTION CONFIG (baru & lebih pintar)
// =======================
// tiap pola punya: key, description, regex, severity (1..4)
const detectionPatterns = [
    // High severity (4) - remote webhook / remote command execution
    { key: "discord_webhook", desc: "discord webhook (discord.com/api/webhooks/)", regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, sev: 4 },
    { key: "telegram_bot_api", desc: "telegram bot api (api.telegram.org/bot)", regex: /api\.telegram\.org\/bot/i, sev: 4 },
    { key: "exec_os_execute", desc: "os.execute / exec (command execution)", regex: /\b(?:os\.execute|exec|io\.popen|os\.spawn|os\.execute)\b/i, sev: 4 },
    { key: "loadstring_load", desc: "loadstring/load/loadfile/dofile (dynamic code execution)", regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, sev: 4 },

    // Severity 3 - obfuscation / protection / encoded payloads / remote socket
    { key: "moonsec_protected", desc: "MoonSec / protected packer", regex: /moonsec|protected with moonsec|this file was protected/i, sev: 3 },
    { key: "lua_obfuscator", desc: "LuaObfuscator or obfuscation indicators", regex: /luaobfuscator|obfuscate|obfuscated|anti[-_ ]debug/i, sev: 3 },
    { key: "socket_network", desc: "require('socket') or socket.http", regex: /require\s*\(\s*['"]socket['"]\s*\)|socket\.http|socket\.tcp|socket\.connect/i, sev: 3 },
    { key: "base64_blob", desc: "long base64-like blob", regex: /(?:[A-Za-z0-9+\/]{100,}={0,2})/, sev: 3 },
    { key: "hex_blob", desc: "long hex sequences (possible shellcode/encoded)", regex: /0x[a-fA-F0-9]{4,}/, sev: 3 },

    // Severity 2 - credentials / sensitive api strings / password variables
    { key: "password_keyword", desc: "password / username variables", regex: /\b(password|passwd|pwd|username|user)\b\s*[:=]\s*["']?[\w\-\@\:\.]{3,}["']?/i, sev: 2 },
    { key: "plain_credentials", desc: "hardcoded credentials (user:pass or token patterns)", regex: /[A-Za-z0-9\-_]{8,}[:][A-Za-z0-9\-_]{4,}|token\s*[:=]\s*["'][A-Za-z0-9\-_\.]{8,}["']/i, sev: 2 },
    { key: "samp_functions", desc: "sampGetPlayerNickname / sampGetPlayerName (game functions)", regex: /\bsampGetPlayer(?:Nickname|Name|Ip|PlayerId)\b/i, sev: 2 },

    // Severity 1 - suspicious small patterns (may be benign)
    { key: "loadstring_word", desc: "word 'loadstring' anywhere (suspicious)", regex: /loadstring/i, sev: 1 },
    { key: "password_word", desc: "word 'password' (may be config)", regex: /password/i, sev: 1 },
    { key: "getkeystate", desc: "key capture / getKey", regex: /\b(GetAsyncKeyState|getKeyState|getkey|key\.isDown|isKeyDown)\b/i, sev: 1 },
    { key: "file_write", desc: "io.open / io.write / file write ops", regex: /\b(io\.open|io\.write|file\.write|file\.open)\b/i, sev: 1 },
    { key: "http_request_like", desc: "http.request / https request usage", regex: /\b(http\.request|https?\.request|fetch)\b/i, sev: 1 },
];

// severity weights -> contribute to risk score
const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50 };

// =======================
// 🤖 GROQ AI CONFIG (tetap)
 // (tidak diubah)
function detectTypo(text) {
    return /(.)\1{4,}/i.test(text);
}

async function generateRoast(input) {
    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: `
Kamu AI toxic brutal, sarkas, meremehkan, gaya gamer nyolot.
Jawaban panjang dan kreatif.
Tanpa ujaran kebencian ras/agama atau ancaman kekerasan.
`
                },
                {
                    role: "user",
                    content: input
                }
            ],
            temperature: 1.2
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

    return response.data.choices[0].message.content;
}

client.once("clientReady", () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
});

// =======================
// Helper: analisis konten (baru, lebih pintar)
// =======================
function analyzeContent(text) {
    const lowered = text; // keep original case for regex with /i
    const matches = [];

    let rawScore = 0;
    detectionPatterns.forEach(p => {
        try {
            if (p.regex.test(lowered)) {
                matches.push({ key: p.key, desc: p.desc, sev: p.sev, snippet: extractSnippet(lowered, p.regex) });
                rawScore += (severityWeight[p.sev] || 10);
            }
        } catch (e) {
            // ignore bad regex (safety)
        }
    });

    // bonus score for many unique matches (increases confidence)
    const uniqueSevSum = [...new Set(matches.map(m => m.sev))].reduce((a,b)=>a+b,0);

    // Normalize to 0-100
    let percent = Math.min(100, Math.round((rawScore + uniqueSevSum*2)));
    // small heuristic: if any severity 4 found -> bump up
    if (matches.some(m => m.sev === 4)) percent = Math.max(percent, 75);
    if (matches.length >= 5) percent = Math.max(percent, 85);

    // status mapping (menyesuaikan tampilan yang kamu pakai)
    let status = "🟢 Aman";
    let color = 0x00ff00;
    if (percent >= 80) {
        status = "🔴 BAHAYA TINGGI";
        color = 0xff0000;
    } else if (percent >= 60) {
        status = "🟠 SANGAT MENCURIGAKAN";
        color = 0xff8000;
    } else if (percent >= 30) {
        status = "🟡 MENCURIGAKAN";
        color = 0xffcc00;
    }

    // confidence heuristic (0..100)
    let confidence = Math.min(95, 40 + matches.length * 10 + Math.round(percent / 8));

    // Build detail text (limit to reasonable length)
    let detailLines = matches.map(m => `• ${m.desc} (level ${m.sev})${m.snippet ? ` — ...${m.snippet}...` : ''}`);
    if (detailLines.length === 0) detailLines = ["Tidak ditemukan pola mencurigakan"];

    // if too many lines, truncate and show count
    const maxLines = 12;
    if (detailLines.length > maxLines) {
        const more = detailLines.length - maxLines;
        detailLines = detailLines.slice(0, maxLines);
        detailLines.push(`...dan ${more} lainnya.`);
    }

    return {
        riskPercent: percent,
        status,
        color,
        confidence,
        detectedLines: detailLines,
        rawMatches: matches
    };
}

// small helper to extract small snippet around match for context
function extractSnippet(text, regex) {
    try {
        const m = text.match(regex);
        if (!m) return null;
        const matchIndex = text.indexOf(m[0]);
        const start = Math.max(0, matchIndex - 30);
        const end = Math.min(text.length, matchIndex + m[0].length + 30);
        return text.substring(start, end).replace(/\s+/g, ' ');
    } catch (e) {
        return null;
    }
}

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;

    try {

        // =======================
        // 🤖 AI ONLY CHANNEL
        // =======================
        if (message.channel.id === aiChannelId) {

            if (content.startsWith("!ai")) {
                const userInput = content.slice(3).trim();
                if (!userInput) return message.reply("Ngetik aja setengah-setengah.");

                const roast = await generateRoast(userInput);
                return message.reply(roast);
            }

            if (detectTypo(content)) {
                const roast = await generateRoast("User typo parah: " + content);
                return message.reply(roast);
            }

            if (Math.random() < 0.3) {
                const roast = await generateRoast(content);
                return message.reply(roast);
            }
        }

    } catch (err) {
        console.error(err.response?.data || err.message);
    }

    // =======================
    // 🛡️ SCANNER ONLY CHANNEL
    // =======================

    if (message.channel.id !== scannerChannelId) return;

    if (!message.attachments.size) return;

    const attachment = message.attachments.first();
    const fileName = (attachment.name || "").toLowerCase();

    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isAllowed) {
        const warningEmbed = new EmbedBuilder()
            .setTitle("⚠️ Format File Tidak Didukung")
            .setColor(0xff0000)
            .setDescription("Hanya file berisi lua yang bisa dianalisis:\n\n• .lua\n")
            .setFooter({ text: "Deteksi Keylogger by Tatang" })
            .setTimestamp();

        return message.reply({ embeds: [warningEmbed] });
    }

    try {
        const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
        // try utf8, fallback to latin1 if bad characters
        let contentFile;
        try {
            contentFile = Buffer.from(response.data).toString("utf8");
        } catch (e) {
            contentFile = Buffer.from(response.data).toString("latin1");
        }

        // run the new analyzer
        const analysis = analyzeContent(contentFile);

        // prepare detail text for embed (embed field limit ~1024 chars)
        const detailValue = analysis.detectedLines.join("\n");
        // create an Embed similar to original layout
        const embed = new EmbedBuilder()
            .setTitle("🛡️ Hasil Analisis Keamanan")
            .setColor(analysis.color)
            .addFields(
                { name: "👤 Pengguna", value: `${message.author}`, inline: true },
                { name: "📄 Nama File", value: `${attachment.name}`, inline: true },
                { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB`, inline: true },
                { name: "📊 Status Keamanan", value: analysis.status, inline: true },
                { name: "⚠️ Tingkat Risiko", value: `${analysis.riskPercent}%`, inline: true },
                { name: "🎯 Confidence", value: `${analysis.confidence}%`, inline: true },
                { name: "🔎 Detail Deteksi", value: detailValue }
            )
            .setFooter({ text: "Deteksi Keylogger by Tatang" })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error(error);
        message.reply("❌ Gagal membaca atau menganalisis file.");
    }
});

client.login(process.env.TOKEN_DISCORD);
