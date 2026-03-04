const { 
    Client, 
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    InteractionType
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
const csChannelId = "1478645745069457428";

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
// 🤖 GROQ AI CONFIG (ROAST)
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
                    content: `Kamu AI toxic brutal, sarkas, meremehkan, gaya gamer nyolot.
Jawaban panjang dan kreatif.
Tanpa ujaran kebencian ras/agama atau ancaman kekerasan.`
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

// =======================
// 🎭 GROQ AI CONFIG (CS)
// =======================

async function generateStory(data) {
    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama3-70b-8192",
            messages: [
                {
                    role: "system",
                    content: "Kamu AI pembuat Character Story GTA SAMP yang detail, realistis, immersive, cocok untuk RP Indonesia."
                },
                {
                    role: "user",
                    content: `
Server: ${data.server}
Side: ${data.side}
Nama: ${data.nama}
Level: ${data.level}
Gender: ${data.gender}
TTL: ${data.ttl}
Asal: ${data.asal}
Skill: ${data.skill}
Kultur: ${data.kultur}
Detail: ${data.detail}

Buat cerita panjang dan serius.
`
                }
            ],
            temperature: 0.8
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

// =======================
// ⏳ COOLDOWN 3 JAM
// =======================

const cooldown = new Map();
const COOLDOWN_TIME = 3 * 60 * 60 * 1000;
const tempData = {};

// =======================
// READY
// =======================

client.once("ready", () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
});

// =======================
// MESSAGE HANDLER
// =======================

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;

    // =======================
    // 🎭 SETUP CS PANEL
    // =======================

    if (content === "!setupcs") {

        const embed = new EmbedBuilder()
            .setTitle("📝 Panel Pembuatan Character Story")
            .setDescription(
`Silakan tekan tombol di bawah untuk memulai pembuatan Character Story.

**Alur:**
1️⃣ Pilih Server
2️⃣ Pilih Sisi
3️⃣ Isi Detail (1/2)
4️⃣ Isi Detail (2/2)

Cooldown: 1 CS / 3 Jam`
            )
            .setColor(0x5865F2)
            .setFooter({ text: "Tatang Community CS System" });

        const button = new ButtonBuilder()
            .setCustomId("start_cs")
            .setLabel("📝 Buat Character Story")
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // =======================
    // 🤖 AI ONLY CHANNEL
    // =======================

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

    // =======================
    // 🛡️ SCANNER
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
            .setDescription("Hanya file berikut yang bisa dianalisis:\n\n• .lua\n• .txt\n• .zip\n• .7z")
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
            riskPercent = 99;
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
                { name: "📊 Status Keamanan", value: status },
                { name: "⚠️ Tingkat Risiko", value: `${riskPercent}%` },
                { name: "🔎 Detail Deteksi", value: detailText }
            )
            .setFooter({ text: "Deteksi Keylogger by Tatang" })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        message.reply("❌ Gagal membaca atau menganalisis file.");
    }
});

// =======================
// 🎭 INTERACTION CS SYSTEM
// =======================

client.on("interactionCreate", async (interaction) => {

    if (interaction.isButton() && interaction.customId === "start_cs") {

        const userId = interaction.user.id;
        const now = Date.now();

        if (cooldown.has(userId)) {
            const remaining = COOLDOWN_TIME - (now - cooldown.get(userId));
            if (remaining > 0) {
                const hours = Math.floor(remaining / 3600000);
                const minutes = Math.floor((remaining % 3600000) / 60000);

                return interaction.reply({
                    content: `⚠️ Kamu masih cooldown!\n⏳ Sisa: ${hours} jam ${minutes} menit`,
                    ephemeral: true
                });
            }
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId("select_server")
            .setPlaceholder("Pilih server...")
            .addOptions([
                { label: "SSRP", value: "SSRP" },
                { label: "AARP", value: "AARP" },
                { label: "Virtual RP", value: "Virtual RP" }
            ]);

        const row = new ActionRowBuilder().addComponents(select);

        return interaction.reply({
            content: "Pilih server:",
            components: [row],
            ephemeral: true
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "select_server") {

        tempData[interaction.user.id] = {
            server: interaction.values[0]
        };

        const good = new ButtonBuilder()
            .setCustomId("good")
            .setLabel("Goodside")
            .setStyle(ButtonStyle.Success);

        const bad = new ButtonBuilder()
            .setCustomId("bad")
            .setLabel("Badside")
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(good, bad);

        return interaction.update({
            content: "Pilih sisi:",
            components: [row]
        });
    }

});

client.login(process.env.TOKEN_DISCORD);
