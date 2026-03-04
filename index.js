require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const Groq = require('groq-sdk');
const axios = require('axios');

// =======================
// 🤖 INISIALISASI BOT & API
// =======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Pastikan GROQ_API_KEY ada di Variables Railway atau .env
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// =======================
// 🔒 KONFIGURASI CHANNEL & FITUR
// =======================
const scannerChannelId = "1477131305765572618";
const aiChannelId = "1475164217115021475";

// Penyimpanan sementara untuk data CS (Session Map)
const userSessions = new Map();

// Pola untuk Scanner File
const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];
const suspiciousPatterns = ["LuaObfuscator", "loadstring", "require('socket')", "username", "password", "api.telegram.org"];
const dangerousPatterns = ["discord.com/api/webhooks/", "discordapp.com/api/webhooks/", "api.telegram.org/bot"];

// =======================
// 🛠️ FUNGSI BANTUAN (AI ROASTER)
// =======================
function detectTypo(text) {
    return /(.)\1{4,}/i.test(text); 
}

async function generateRoast(input) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", // Model cepat untuk roast
            messages: [
                {
                    role: "system",
                    content: "Kamu AI toxic brutal, sarkas, meremehkan, gaya gamer nyolot. Jawaban panjang dan kreatif. Tanpa ujaran kebencian ras/agama."
                },
                { role: "user", content: input }
            ],
            temperature: 1.2
        });
        return chatCompletion.choices[0]?.message?.content || "Lagi males ngetik gue.";
    } catch (error) {
        return "Sistem gue lagi error gara-gara chat lu yang sampah.";
    }
}

// =======================
// 🚀 EVENT: BOT READY
// =======================
client.once('ready', () => {
    console.log(`✅ Bot Online: ${client.user.tag}`);
});

// =======================
// 📨 EVENT: MESSAGE CREATE
// =======================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content;

    // 1. SETUP CS COMMAND
    if (content === '!setupcs') {
        const embed = new EmbedBuilder()
            .setTitle('📝 Panel Pembuatan Character Story')
            .setDescription('Tekan tombol di bawah untuk memulai pembuatan **Character Story (CS)**.\n\nCreated By Kotka.')
            .setColor('#2b2d31');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setEmoji('📝').setStyle(ButtonStyle.Primary)
        );
        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // 2. AI ROASTER CHANNEL
    if (message.channel.id === aiChannelId) {
        if (content.startsWith("!ai")) {
            const userInput = content.slice(3).trim();
            if (!userInput) return message.reply("Isi pesannya apa tolol?");
            const roast = await generateRoast(userInput);
            return message.reply(roast);
        }
        if (detectTypo(content) || Math.random() < 0.2) {
            const roast = await generateRoast(content);
            return message.reply(roast);
        }
    }

    // 3. SCANNER CHANNEL
    if (message.channel.id === scannerChannelId && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const fileName = attachment.name.toLowerCase();
        if (!allowedExtensions.some(ext => fileName.endsWith(ext))) return;

        try {
            const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
            const contentFile = Buffer.from(response.data).toString("utf8");

            let risk = 0, status = "🟢 Aman", color = 0x00ff00, detail = "Bersih.";
            const danger = dangerousPatterns.find(p => contentFile.includes(p));

            if (danger) {
                risk = 99; status = "🔴 Bahaya"; color = 0xff0000; detail = `Webhook: ${danger}`;
            } else {
                const sus = suspiciousPatterns.filter(p => contentFile.includes(p));
                if (sus.length > 0) { risk = 50; status = "🟡 Mencurigakan"; color = 0xffcc00; detail = sus.join(", "); }
            }

            const embed = new EmbedBuilder()
                .setTitle("🛡️ Analisis File")
                .setColor(color)
                .addFields(
                    { name: "File", value: attachment.name, inline: true },
                    { name: "Status", value: status, inline: true },
                    { name: "Risiko", value: `${risk}%`, inline: true },
                    { name: "Detail", value: detail }
                ).setTimestamp();
            await message.reply({ embeds: [embed] });
        } catch (e) { console.error(e); }
    }
});

// =======================
// 🖱️ INTERACTION LOGIC (CS BUILDER)
// =======================
client.on('interactionCreate', async (interaction) => {
    // START BUTTON
    if (interaction.isButton() && interaction.customId === 'start_cs') {
        const select = new StringSelectMenuBuilder()
            .setCustomId('select_server').setPlaceholder('Pilih server...')
            .addOptions(
                { label: 'SSRP', value: 'SSRP' }, { label: 'Virtual RP', value: 'Virtual RP' },
                { label: 'JGRP', value: 'JGRP' }, { label: 'AARP', value: 'AARP' },
                { label: 'TEN RP', value: 'TEN ROLEPLAY' }, { label: 'FMRP', value: 'FMRP' }
            );
        await interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // SERVER SELECT
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
        userSessions.set(interaction.user.id, { server: interaction.values[0] });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('side_good').setLabel('Goodside').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('side_bad').setLabel('Badside').setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ content: `Server: **${interaction.values[0]}**. Pilih alur:`, components: [row] });
    }

    // SIDE BUTTON -> MODAL 1
    if (interaction.isButton() && (interaction.customId === 'side_good' || interaction.customId === 'side_bad')) {
        const side = interaction.customId === 'side_good' ? 'Good Side' : 'Bad Side';
        const session = userSessions.get(interaction.user.id);
        session.side = side;

        const modal = new ModalBuilder().setCustomId('modal_1').setTitle('Data Karakter (1/2)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nama').setLabel('Nama IC').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Level').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gender').setLabel('Gender').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ttl').setLabel('TTL').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kota').setLabel('Kota Asal').setStyle(TextInputStyle.Short).setRequired(true))
        );
        await interaction.showModal(modal);
    }

    // MODAL 1 -> MODAL 2 TRIGGER
    if (interaction.isModalSubmit() && interaction.customId === 'modal_1') {
        const session = userSessions.get(interaction.user.id);
        ['nama', 'level', 'gender', 'ttl', 'kota'].forEach(key => session[key] = interaction.fields.getTextInputValue(key));
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal_2').setLabel('Isi Detail Cerita (2/2)').setStyle(ButtonStyle.Primary));
        await interaction.update({ content: '✅ Data dasar tersimpan.', components: [row] });
    }

    // MODAL 2
    if (interaction.isButton() && interaction.customId === 'open_modal_2') {
        const modal = new ModalBuilder().setCustomId('modal_2').setTitle('Detail Cerita (2/2)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bakat').setLabel('Bakat/Keahlian').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kultur').setLabel('Kultur/Etnis').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tambahan').setLabel('Cerita Tambahan').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        await interaction.showModal(modal);
    }

    // FINAL SUBMIT -> AI GENERATION
    if (interaction.isModalSubmit() && interaction.customId === 'modal_2') {
        const session = userSessions.get(interaction.user.id);
        session.bakat = interaction.fields.getTextInputValue('bakat');
        session.kultur = interaction.fields.getTextInputValue('kultur') || 'Umum';
        session.tambahan = interaction.fields.getTextInputValue('tambahan') || 'Tidak ada';

        await interaction.update({ content: `⏳ Menulis cerita untuk **${session.nama}**...`, components: [] });

        try {
            const prompt = `Buatkan Character Story Roleplay GTA Bahasa Indonesia (minimal 4 paragraf) untuk:
            Nama: ${session.nama}, Side: ${session.side}, Server: ${session.server}, TTL: ${session.ttl}, Kota: ${session.kota}, Bakat: ${session.bakat}, Etnis: ${session.kultur}.
            Cerita tambahan: ${session.tambahan}. Langsung ke inti cerita, jangan ada pembukaan AI.`;

            const res = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama-3.3-70b-versatile', // <--- MODEL TERBARU (NO ERROR)
                temperature: 0.7,
                max_tokens: 2000
            });

            const embed = new EmbedBuilder()
                .setTitle(`📖 CS: ${session.nama}`)
                .setDescription(res.choices[0]?.message?.content || "Gagal.")
                .setColor(session.side === 'Good Side' ? '#2ecc71' : '#e74c3c');

            await interaction.followUp({ embeds: [embed], ephemeral: true });
            userSessions.delete(interaction.user.id);
        } catch (err) {
            console.error(err);
            await interaction.followUp({ content: "❌ AI Error: " + err.message, ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
