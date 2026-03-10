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
// 🔎 DETECTION CONFIG
// =======================

const detectionPatterns = [

    { regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, desc: "discord webhook", sev: 4 },
    { regex: /api\.telegram\.org\/bot/i, desc: "telegram bot api", sev: 4 },
    { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "command execution", sev: 4 },
    { regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, desc: "dynamic code execution", sev: 4 },

    { regex: /moonsec|protected with moonsec/i, desc: "MoonSec protection", sev: 3 },
    { regex: /luaobfuscator|obfuscate|anti[-_ ]debug/i, desc: "obfuscation", sev: 3 },
    { regex: /require\s*\(\s*['"]socket['"]\s*\)/i, desc: "socket network", sev: 3 },
    { regex: /(?:[A-Za-z0-9+\/]{100,}={0,2})/, desc: "base64 encoded blob", sev: 3 },

    { regex: /\b(password|username)\b\s*[:=]/i, desc: "credential variable", sev: 2 },
    { regex: /\bsampGetPlayer(?:Nickname|Name)\b/i, desc: "samp player function", sev: 2 },

    { regex: /loadstring/i, desc: "loadstring keyword", sev: 1 },
    { regex: /password/i, desc: "password keyword", sev: 1 }

];

const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50 };

// =======================
// 🤖 GROQ AI CONFIG
// =======================

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
// ANALYSIS FUNCTION
// =======================

function analyzeContent(text) {

    const matches = [];
    let rawScore = 0;

    detectionPatterns.forEach(p => {

        if (p.regex.test(text)) {
            matches.push(`• ${p.desc} (level ${p.sev})`);
            rawScore += severityWeight[p.sev];
        }

    });

    let percent = Math.min(100, rawScore);

    let status = "🟢 Aman";
    let color = 0x00ff00;

    if (percent >= 80) {
        status = "🔴 BAHAYA TINGGI";
        color = 0xff0000;
    } else if (percent >= 50) {
        status = "🟠 SANGAT MENCURIGAKAN";
        color = 0xff8800;
    } else if (percent >= 20) {
        status = "🟡 MENCURIGAKAN";
        color = 0xffcc00;
    }

    if (matches.length === 0) {
        matches.push("Tidak ditemukan pola mencurigakan");
    }

    return {
        percent,
        status,
        color,
        detail: matches.join("\n")
    };
}

client.on("messageCreate", async (message) => {

    if (message.author.bot) return;

    const content = message.content;

    try {

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

    if (message.channel.id !== scannerChannelId) return;

    if (!message.attachments.size) return;

    const attachment = message.attachments.first();

    const fileName = attachment.name.toLowerCase();

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

        const contentFile = Buffer.from(response.data).toString("utf8");

        const result = analyzeContent(contentFile);

        const embed = new EmbedBuilder()
            .setTitle("🛡️ Hasil Analisis Keamanan")
            .setColor(result.color)
            .addFields(
                { name: "👤 Pengguna", value: `${message.author}` },
                { name: "📄 Nama File", value: attachment.name },
                { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB` },
                { name: "📊 Status Keamanan", value: result.status },
                { name: "⚠️ Tingkat Risiko", value: `${result.percent}%` },
                { name: "🔎 Detail Deteksi", value: result.detail }
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
