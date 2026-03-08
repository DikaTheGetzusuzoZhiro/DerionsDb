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

const suspiciousPatterns = [
    "LuaObfuscator",
    "loadstring",
    "require('socket')",
    "username",
    "password",
    "api.telegram.org",
    "telegram.org/bot"
];

const dangerousPatterns = [
    "discord.com/api/webhooks/",
    "discordapp.com/api/webhooks/",
    "api.telegram.org/bot"
];

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

        let riskPercent = 0;
        let status = "🟢 Aman";
        let color = 0x00ff00;
        let detailText = "Tidak ditemukan pola mencurigakan";

        const foundDanger = dangerousPatterns.find(pattern => contentFile.includes(pattern));

        if (foundDanger) {
            riskPercent = 100;
            status = "🔴 Bahaya";
            color = 0xff0000;
            detailText = `Terdeteksi webhook berbahaya:\n• ${foundDanger}`;
        } else {
            const foundSuspicious = suspiciousPatterns.filter(pattern => contentFile.includes(pattern));

            if (foundSuspicious.length > 0) {
                riskPercent = 50;
                status = "🟡 Mencurigakan";
                color = 0xffcc00;
                detailText = foundSuspicious.map(p => `• ${p}`).join("\n");
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("🛡️ Hasil Analisis Keamanan")
            .setColor(color)
            .addFields(
                { name: "👤 Pengguna", value: `${message.author}` },
                { name: "📄 Nama File", value: attachment.name },
                { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB` },
                { name: "📊 Status Keamanan", value: status },
                { name: "⚠️ Tingkat Risiko", value: `${riskPercent}%` },
                { name: "🔎 Detail Deteksi", value: detailText }
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
