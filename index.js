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

// 🔒 CHANNEL YANG DIIZINKAN
const allowedChannelId = "1477131305765572618";

// 🔒 EXTENSION DIIZINKAN
const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];

// ⚠️ POLA MENCURIGAKAN (50%)
const suspiciousPatterns = [
    "LuaObfuscator",
    "loadstring",
    "require('socket')",
    "username",
    "password",
    "api.telegram.org",
    "telegram.org/bot"
];

// 🚨 WEBHOOK BERBAHAYA (99%)
const dangerousPatterns = [
    "discord.com/api/webhooks/",
    "discordapp.com/api/webhooks/",
    "api.telegram.org/bot"
];

client.once("ready", () => {
    console.log(`✅ Bot aktif sebagai ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // 🚫 JIKA BUKAN CHANNEL YANG DIIZINKAN
    if (message.channel.id !== allowedChannelId) {

        if (message.attachments.size > 0) {
            const warnEmbed = new EmbedBuilder()
                .setTitle("🚫 Channel Tidak Diizinkan")
                .setColor(0xff0000)
                .setDescription(
                    `Bot scanner hanya bisa digunakan di channel:\n<#!${allowedChannelId}>`
                )
                .setFooter({ text: "Deteksi Keylogger by Tatang" })
                .setTimestamp();

            return message.reply({ embeds: [warnEmbed] });
        }

        return;
    }

    if (!message.attachments.size) return;

    const attachment = message.attachments.first();
    const fileName = attachment.name.toLowerCase();

    // 🔒 CEK FORMAT FILE
    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isAllowed) {
        const warningEmbed = new EmbedBuilder()
            .setTitle("⚠️ Format File Tidak Didukung")
            .setColor(0xff0000)
            .setDescription("Hanya file berikut yang bisa dianalisis:\n\n• .lua\n• .txt\n• .zip\n• .7z")
            .setFooter({ text: "Deteksi Keylogger by Tatang" })
            .setTimestamp();

        return message.reply({ embeds: [warningEmbed] });
    }

    try {
        const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
        const content = Buffer.from(response.data).toString("utf8");

        let riskPercent = 0;
        let status = "🟢 Aman";
        let color = 0x00ff00;
        let detailText = "Tidak ditemukan pola mencurigakan";

        // 🚨 PRIORITAS WEBHOOK
        const foundDanger = dangerousPatterns.find(pattern => content.includes(pattern));

        if (foundDanger) {
            riskPercent = 99;
            status = "🔴 Bahaya";
            color = 0xff0000;
            detailText = `Terdeteksi webhook berbahaya:\n• ${foundDanger}`;
        } else {
            const foundSuspicious = suspiciousPatterns.filter(pattern => content.includes(pattern));

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
                { name: "📌 Status", value: "Analisis file selesai diproses" },
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

// 🔑 LOGIN
client.login(process.env.TOKEN_DISCORD);
