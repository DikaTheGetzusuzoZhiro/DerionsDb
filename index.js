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
const suspiciousPatterns = [
    "LuaObfuscator", "loadstring", "require('socket')", 
    "username", "password", "api.telegram.org", "telegram.org/bot"
];
const dangerousPatterns = [
    "discord.com/api/webhooks/", 
    "discordapp.com/api/webhooks/", 
    "api.telegram.org/bot"
];

// =======================
// 🛠️ FUNGSI BANTUAN (AI ROASTER)
// =======================
function detectTypo(text) {
    return /(.)\1{4,}/i.test(text); // Mendeteksi huruf yang diulang 5 kali atau lebih (ex: haloooooo)
}

async function generateRoast(input) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: "Kamu AI toxic brutal, sarkas, meremehkan, gaya gamer nyolot. Jawaban panjang dan kreatif. Tanpa ujaran kebencian ras/agama atau ancaman kekerasan."
                },
                {
                    role: "user",
                    content: input
                }
            ],
            temperature: 1.2
        });
        return chatCompletion.choices[0]?.message?.content || "Lagi males ngetik gue, mending lu diem.";
    } catch (error) {
        console.error("Error generating roast:", error);
        return "Sistem gue lagi error gara-gara ngebaca chat lu yang nggak bermutu.";
    }
}

// =======================
// 🚀 EVENT: BOT READY
// =======================
client.once('ready', () => {
    console.log(`✅ Bot berhasil login sebagai ${client.user.tag}`);
    console.log(`🔥 Sistem CS Builder, AI Roaster, dan Keamanan Aktif!`);
});

// =======================
// 📨 EVENT: MESSAGE CREATE
// =======================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content;

    // ------------------------------------------------
    // 1. FITUR SETUP CS (CHARACTER STORY)
    // ------------------------------------------------
    if (content === '!setupcs') {
        const embed = new EmbedBuilder()
            .setTitle('📝 Panel Pembuatan Character Story')
            .setDescription('Tekan tombol di bawah untuk memulai proses pembuatan **Character Story (CS)** yang lebih detail dan sesuai keinginanmu.\n\n**Alur Baru yang Lebih Detail**\n1. Pilih Server\n2. Pilih Sisi Cerita (Baik/Jahat)\n3. Isi Detail Lengkap Karakter (Nama, Kultur, Bakat, dll.)\n\nCreated By Kotkaaja.')
            .setColor('#2b2d31');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_cs')
                .setLabel('Buat Character Story')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Primary)
        );

        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // ------------------------------------------------
    // 2. FITUR AI ROASTER (CHANNEL KHUSUS AI)
    // ------------------------------------------------
    if (message.channel.id === aiChannelId) {
        try {
            if (content.startsWith("!ai")) {
                const userInput = content.slice(3).trim();
                if (!userInput) return message.reply("Ngetik aja setengah-setengah. Kasih text yang bener!");

                const roast = await generateRoast(userInput);
                return message.reply(roast);
            }

            if (detectTypo(content)) {
                const roast = await generateRoast("User typo parah atau ngetik panjang nggak jelas: " + content);
                return message.reply(roast);
            }

            // Peluang 30% untuk ngeroast secara acak
            if (Math.random() < 0.3) {
                const roast = await generateRoast(content);
                return message.reply(roast);
            }
        } catch (err) {
            console.error("AI Feature Error:", err.message);
        }
    }

    // ------------------------------------------------
    // 3. FITUR FILE SCANNER (CHANNEL KHUSUS SCANNER)
    // ------------------------------------------------
    if (message.channel.id === scannerChannelId) {
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
            // Download isi file
            const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
            const contentFile = Buffer.from(response.data).toString("utf8");

            let riskPercent = 0;
            let status = "🟢 Aman";
            let color = 0x00ff00;
            let detailText = "Tidak ditemukan pola mencurigakan";

            // Cek tingkat bahaya
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
                    { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB` },
                    { name: "📊 Status Keamanan", value: status },
                    { name: "⚠️ Tingkat Risiko", value: `${riskPercent}%` },
                    { name: "🔎 Detail Deteksi", value: detailText }
                )
                .setFooter({ text: "Deteksi Keylogger by Tatang" })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error("Scanner Error:", error);
            message.reply("❌ Gagal membaca atau menganalisis file.");
        }
    }
});

// =======================
// 🖱️ EVENT: INTERACTION CREATE (CS BUILDER LOGIC)
// =======================
client.on('interactionCreate', async (interaction) => {
    // 1. TOMBOL "BUAT CHARACTER STORY"
    if (interaction.isButton() && interaction.customId === 'start_cs') {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_server')
            .setPlaceholder('Pilih server tujuan...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('SSRP').setDescription('Buat CS untuk server State Side RP.').setValue('SSRP'),
                new StringSelectMenuOptionBuilder().setLabel('Virtual RP').setDescription('Buat CS untuk server Virtual RP.').setValue('Virtual RP'),
                new StringSelectMenuOptionBuilder().setLabel('AARP').setDescription('Buat CS untuk server Air Asia RP.').setValue('AARP'),
                new StringSelectMenuOptionBuilder().setLabel('GCRP').setDescription('Buat CS untuk server Grand Country RP.').setValue('GCRP'),
                new StringSelectMenuOptionBuilder().setLabel('TEN ROLEPLAY').setDescription('Buat CS untuk server 10RP.').setValue('TEN ROLEPLAY'),
                new StringSelectMenuOptionBuilder().setLabel('CPRP').setDescription('Buat CS untuk server Cyristal Pride RP.').setValue('CPRP'),
                new StringSelectMenuOptionBuilder().setLabel('Relative RP').setDescription('Buat CS untuk server Relative RP.').setValue('Relative RP'),
                new StringSelectMenuOptionBuilder().setLabel('JGRP').setDescription('Buat CS untuk server JGRP.').setValue('JGRP'),
                new StringSelectMenuOptionBuilder().setLabel('FMRP').setDescription('Buat CS untuk server FAMERLONE RP.').setValue('FMRP')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: 'Pilih server di mana karaktermu akan bermain:',
            components: [row],
            ephemeral: true
        });
    }

    // 2. DROPDOWN PILIH SERVER
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
        const selectedServer = interaction.values[0];
        userSessions.set(interaction.user.id, { server: selectedServer });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('side_good').setLabel('Sisi Baik (Goodside)').setEmoji('😇').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('side_bad').setLabel('Sisi Jahat (Badside)').setEmoji('😈').setStyle(ButtonStyle.Danger)
        );

        await interaction.update({
            content: `Pilih alur cerita untuk karaktermu (Server: **${selectedServer}**):`,
            components: [row]
        });
    }

    // 3. PILIH SISI CERITA -> MODAL 1
    if (interaction.isButton() && (interaction.customId === 'side_good' || interaction.customId === 'side_bad')) {
        const side = interaction.customId === 'side_good' ? 'Good Side' : 'Bad Side';
        
        const sessionData = userSessions.get(interaction.user.id) || {};
        sessionData.side = side;
        userSessions.set(interaction.user.id, sessionData);

        const modal = new ModalBuilder()
            .setCustomId('modal_1')
            .setTitle(`Detail Karakter (${side}) (1/2)`);

        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nama').setLabel('Nama Lengkap Karakter (IC)').setPlaceholder('Contoh: John Washington, Kenji Tanaka').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Level Karakter').setPlaceholder('Contoh: 1').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gender').setLabel('Jenis Kelamin').setPlaceholder('Contoh: Laki-laki / Perempuan').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ttl').setLabel('Tanggal Lahir').setPlaceholder('Contoh: 17 Agustus 1995').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kota').setLabel('Kota Asal').setPlaceholder('Contoh: Chicago, Illinois').setStyle(TextInputStyle.Short).setRequired(true))
        );

        await interaction.showModal(modal);
    }

    // 4. SUBMIT MODAL 1 -> MUNCUL TOMBOL LANJUT
    if (interaction.isModalSubmit() && interaction.customId === 'modal_1') {
        const sessionData = userSessions.get(interaction.user.id);
        
        sessionData.nama = interaction.fields.getTextInputValue('nama');
        sessionData.level = interaction.fields.getTextInputValue('level');
        sessionData.gender = interaction.fields.getTextInputValue('gender');
        sessionData.ttl = interaction.fields.getTextInputValue('ttl');
        sessionData.kota = interaction.fields.getTextInputValue('kota');
        userSessions.set(interaction.user.id, sessionData);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_modal_2').setLabel('Lanjutkan ke Detail Cerita (2/2)').setEmoji('➡').setStyle(ButtonStyle.Primary)
        );

        await interaction.update({
            content: '✅ Detail dasar berhasil disimpan. Tekan tombol di bawah untuk melanjutkan.',
            components: [row]
        });
    }

    // 5. TOMBOL LANJUTKAN -> MODAL 2
    if (interaction.isButton() && interaction.customId === 'open_modal_2') {
        const sessionData = userSessions.get(interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId('modal_2')
            .setTitle(`Detail Cerita (${sessionData.side}) (2/2)`);

        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bakat').setLabel('Bakat/Keahlian Dominan Karakter').setPlaceholder('Contoh: Penembak jitu, negosiator ulung...').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kultur').setLabel('Kultur/Etnis (Opsional)').setPlaceholder('Contoh: African-American, Hispanic...').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tambahan').setLabel('Detail Tambahan (Opsional)').setPlaceholder('Contoh: Punya hutang, dikhianati geng lama, dll.').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );

        await interaction.showModal(modal);
    }

    // 6. SUBMIT MODAL 2 -> GENERATE STORY PAKAI AI
    if (interaction.isModalSubmit() && interaction.customId === 'modal_2') {
        const sessionData = userSessions.get(interaction.user.id);
        
        sessionData.bakat = interaction.fields.getTextInputValue('bakat');
        sessionData.kultur = interaction.fields.getTextInputValue('kultur') || 'Tidak ada spesifikasi kultur';
        sessionData.tambahan = interaction.fields.getTextInputValue('tambahan') || 'Tidak ada info tambahan';

        await interaction.update({
            content: `⏳ Character Story untuk **${sessionData.nama}** sedang diproses oleh AI...\n*(Mohon tunggu beberapa detik)*`,
            components: []
        });

        try {
            const prompt = `
            Tuliskan Character Story (latar belakang Roleplay GTA) berbahasa Indonesia yang sangat mendalam, realistis, dan rapi (minimal 4 paragraf).
            Data Karakter:
            - Nama: ${sessionData.nama}
            - Gender: ${sessionData.gender}
            - Tanggal Lahir: ${sessionData.ttl}
            - Kota Asal: ${sessionData.kota}
            - Level: ${sessionData.level}
            - Etnis/Kultur: ${sessionData.kultur}
            - Keahlian Utama: ${sessionData.bakat}
            - Background Tambahan: ${sessionData.tambahan}

            Bentuk cerita agar sesuai dengan jalur '${sessionData.side}' (Goodside = Pahlawan, jujur, mencari keadilan, dsb. Badside = Kriminal, gelap, mafia, dendam, dsb).
            Cerita harus langsung dimulai tanpa basa-basi pembuka atau penutup dari AI. Buat agar emosinya terasa.
            `;

            const chatCompletion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama3-70b-8192',
                temperature: 0.7,
                max_tokens: 2000
            });

            const story = chatCompletion.choices[0]?.message?.content || "AI gagal menyusun cerita. Coba lagi.";

            const embed = new EmbedBuilder()
                .setTitle(`📖 Character Story: ${sessionData.nama}`)
                .setDescription(story)
                .setColor(sessionData.side === 'Good Side' ? '#2ecc71' : '#e74c3c')
                .setFooter({ text: `Generated by Groq AI | Server: ${sessionData.server}` });

            await interaction.followUp({ embeds: [embed], ephemeral: true });
            userSessions.delete(interaction.user.id);

        } catch (error) {
            console.error("AI Generation Error:", error);
            await interaction.followUp({
                content: "❌ Semua layanan AI sedang bermasalah atau gagal dihubungi. Coba lagi nanti.",
                ephemeral: true
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
