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

// 🔒 EXTENSION DIIZINKAN
const allowedExtensions = [".lua", ".txt", ".zip"];

// 🔍 POLA MENCURIGAKAN
const suspiciousPatterns = [
    "api.telegram.org",
    "telegram.org/bot",
    "username",
    "password",
    "LuaObfuscator",
    "loadstring",
    "require('socket')",
    "http://",
    "https://"
];

client.once("ready", () => {
    console.log(`✅ Bot aktif sebagai ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.attachments.size) return;

    const attachment = message.attachments.first();
    const fileName = attachment.name.toLowerCase();

    // 🚫 CEK FORMAT FILE
    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isAllowed) {
        const warningEmbed = new EmbedBuilder()
            .setTitle("⚠️ Format File Tidak Didukung")
            .setColor(0xff0000)
            .setDescription("Hanya file berikut yang bisa dianalisis:\n\n• .lua\n• .txt\n• .zip")
            .setFooter({ text: "Advanced Security Scanner" })
            .setTimestamp();

        return message.reply({ embeds: [warningEmbed] });
    }

    try {
        const response = await axios.get(attachment.url);
        const content = response.data.toString();

        let detected = [];

        suspiciousPatterns.forEach(pattern => {
            if (content.includes(pattern)) {
                detected.push(pattern);
            }
        });

        // 📊 HITUNG RISIKO
        let riskPercent = Math.min(detected.length * 15, 100);
        let status = "🟢 Aman";
        let color = 0x00ff00;
        let detailText = "Tidak ditemukan pola mencurigakan";

        if (riskPercent >= 60) {
            status = "🔴 Bahaya Tinggi";
            color = 0xff0000;
        } else if (riskPercent >= 30) {
            status = "🟡 Mencurigakan";
            color = 0xffcc00;
        }

        if (detected.length > 0) {
            detailText = detected.map(d => `• ${d}`).join("\n");
        }

        const embed = new EmbedBuilder()
            .setTitle("🛡️ Hasil Analisis Keamanan")
            .setColor(color)
            .addFields(
                { name: "📌 Status", value: "Analisis file selesai diproses" },
                { name: "👤 Pengguna", value: `${message.author}` },
                { name: "📄 Nama File", value: attachment.name },
                { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB` },
                { name: "📊 Status Keamanan", value: status },
                { name: "⚠️ Tingkat Risiko", value: `${riskPercent}%` },
                { name: "🔎 Detail Deteksi", value: detailText }
            )
            .setFooter({ text: "Advanced Security Scanner | Railway System" })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error(error);
        message.reply("❌ Gagal membaca atau menganalisis file.");
    }
});

// 🔑 LOGIN BOT
client.login(process.env.TOKEN_DISCORD);
