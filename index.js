const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    Partials
} = require("discord.js");

const axios = require("axios");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// =======================
// 🔒 CONFIGURATION
// =======================
const scannerChannelId = "1477131305765572618";
const aiChannelId = "1475164217115021475";

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];
const suspiciousPatterns = ["LuaObfuscator", "loadstring", "require('socket')", "username", "password", "api.telegram.org", "telegram.org/bot"];
const dangerousPatterns = ["discord.com/api/webhooks/", "discordapp.com/api/webhooks/", "api.telegram.org/bot"];

// Session Map untuk simpan data CS sementara
const userSessions = new Map();

// =======================
// 🤖 AI FUNCTIONS
// =======================

function detectTypo(text) {
    return /(.)\1{4,}/i.test(text);
}

// Roast AI (Sesuai Script Asli)
async function generateRoast(input) {
    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: "Kamu AI toxic brutal, sarkas, meremehkan, gaya gamer nyolot. Jawaban panjang dan kreatif. Tanpa ujaran kebencian ras/agama atau ancaman kekerasan."
                },
                { role: "user", content: input }
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

// CS AI (Model Baru agar No Error)
async function generateCS(prompt) {
    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: "Kamu adalah penulis cerita Roleplay profesional. Buat cerita minimal 4 paragraf dengan detail yang mendalam dan bahasa Indonesia yang baik."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.7
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
// 🚀 BOT EVENTS
// =======================

client.once("ready", () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const content = message.content;

    // 📝 COMMAND SETUP CS
    if (content === "!setupcs") {
        const embed = new EmbedBuilder()
            .setTitle('📝 Panel Pembuatan Character Story')
            .setDescription('Tekan tombol di bawah untuk mulai membuat **Character Story (CS)**.\n\nCreated By Kotka.')
            .setColor('#2b2d31');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setEmoji('📝').setStyle(ButtonStyle.Primary)
        );
        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // 🤖 AI ONLY CHANNEL (Original Logic)
    if (message.channel.id === aiChannelId) {
        try {
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
        } catch (err) { console.error(err.response?.data || err.message); }
    }

    // 🛡️ SCANNER ONLY CHANNEL (Original Logic)
    if (message.channel.id === scannerChannelId) {
        if (!message.attachments.size) return;
        const attachment = message.attachments.first();
        const fileName = attachment.name.toLowerCase();
        if (!allowedExtensions.some(ext => fileName.endsWith(ext))) {
            const warningEmbed = new EmbedBuilder().setTitle("⚠️ Format File Tidak Didukung").setColor(0xff0000).setDescription("Hanya file: .lua, .txt, .zip, .7z").setFooter({ text: "Deteksi Keylogger" });
            return message.reply({ embeds: [warningEmbed] });
        }
        try {
            const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
            const contentFile = Buffer.from(response.data).toString("utf8");
            let risk = 0, status = "🟢 Aman", color = 0x00ff00, detail = "Tidak ditemukan pola mencurigakan";
            const danger = dangerousPatterns.find(p => contentFile.includes(p));
            if (danger) {
                risk = 99; status = "🔴 Bahaya"; color = 0xff0000; detail = `Terdeteksi: ${danger}`;
            } else {
                const sus = suspiciousPatterns.filter(p => contentFile.includes(p));
                if (sus.length > 0) { risk = 50; status = "🟡 Mencurigakan"; color = 0xffcc00; detail = sus.join("\n"); }
            }
            const embed = new EmbedBuilder().setTitle("🛡️ Hasil Analisis").setColor(color).addFields({ name: "📄 File", value: attachment.name }, { name: "📊 Status", value: status }, { name: "⚠️ Risiko", value: `${risk}%` }, { name: "🔎 Detail", value: detail }).setFooter({ text: "Deteksi Keylogger by Tatang" });
            await message.reply({ embeds: [embed] });
        } catch (error) { console.error(error); message.reply("❌ Gagal menganalisis file."); }
    }
});

// =======================
// 🖱️ INTERACTION HANDLER (CS)
// =======================

client.on('interactionCreate', async (interaction) => {
    // Tombol Start
    if (interaction.isButton() && interaction.customId === 'start_cs') {
        const select = new StringSelectMenuBuilder()
            .setCustomId('select_server').setPlaceholder('Pilih server...')
            .addOptions(
                { label: 'SSRP', value: 'SSRP' }, { label: 'JGRP', value: 'JGRP' }, 
                { label: 'Virtual RP', value: 'Virtual RP' }, { label: 'TEN RP', value: 'TEN ROLEPLAY' }
            );
        await interaction.reply({ content: 'Pilih server:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // Pilih Server
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
        userSessions.set(interaction.user.id, { server: interaction.values[0] });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('side_good').setLabel('Sisi Baik').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('side_bad').setLabel('Sisi Jahat').setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ content: `Server: ${interaction.values[0]}. Pilih alur:`, components: [row] });
    }

    // Pilih Side -> Modal 1
    if (interaction.isButton() && (interaction.customId === 'side_good' || interaction.customId === 'side_bad')) {
        const session = userSessions.get(interaction.user.id);
        session.side = interaction.customId === 'side_good' ? 'Good Side' : 'Bad Side';
        
        const modal = new ModalBuilder().setCustomId('modal_1').setTitle('Data Karakter (1/2)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nama').setLabel('Nama IC').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gender').setLabel('Gender').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ttl').setLabel('Tanggal Lahir').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kota').setLabel('Kota Asal').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Level').setStyle(TextInputStyle.Short).setRequired(true))
        );
        await interaction.showModal(modal);
    }

    // Modal 1 Submit
    if (interaction.isModalSubmit() && interaction.customId === 'modal_1') {
        const session = userSessions.get(interaction.user.id);
        ['nama', 'gender', 'ttl', 'kota', 'level'].forEach(k => session[k] = interaction.fields.getTextInputValue(k));
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal_2').setLabel('Lanjutkan Ke Detail (2/2)').setStyle(ButtonStyle.Primary));
        await interaction.update({ content: '✅ Data disimpan.', components: [row] });
    }

    // Modal 2 Trigger
    if (interaction.isButton() && interaction.customId === 'open_modal_2') {
        const modal = new ModalBuilder().setCustomId('modal_2').setTitle('Detail Cerita (2/2)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bakat').setLabel('Bakat/Keahlian').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kultur').setLabel('Kultur/Etnis').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tambahan').setLabel('Detail Cerita Tambahan').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        await interaction.showModal(modal);
    }

    // Modal 2 Submit -> AI Process
    if (interaction.isModalSubmit() && interaction.customId === 'modal_2') {
        const session = userSessions.get(interaction.user.id);
        session.bakat = interaction.fields.getTextInputValue('bakat');
        session.kultur = interaction.fields.getTextInputValue('kultur') || 'Umum';
        session.tambahan = interaction.fields.getTextInputValue('tambahan') || 'Tidak ada';

        await interaction.update({ content: `⏳ Sedang menulis CS untuk **${session.nama}**...`, components: [] });

        try {
            const prompt = `Buatkan CS RP GTA: Nama ${session.nama}, Server ${session.server}, Side ${session.side}, TTL ${session.ttl}, Kota ${session.kota}, Bakat ${session.bakat}, Kultur ${session.kultur}. Tambahan: ${session.tambahan}. Tanpa pembukaan AI, langsung ceritanya saja.`;
            const story = await generateCS(prompt);
            const embed = new EmbedBuilder()
                .setTitle(`📖 Character Story: ${session.nama}`)
                .setDescription(story)
                .setColor(session.side === 'Good Side' ? '#2ecc71' : '#e74c3c');
            await interaction.followUp({ embeds: [embed], ephemeral: true });
            userSessions.delete(interaction.user.id);
        } catch (e) {
            console.error(e);
            await interaction.followUp({ content: "❌ AI Error: Coba lagi nanti.", ephemeral: true });
        }
    }
});

client.login(process.env.TOKEN_DISCORD);
