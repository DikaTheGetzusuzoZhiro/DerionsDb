require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const axios = require('axios');
const Groq = require('groq-sdk');

// =======================
// ⚙️ INITIALIZATION
// =======================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// =======================
// 🔒 CONFIGURATION
// =======================

// Channel IDs
const scannerChannelId = "1477131305765572618";
const aiChannelId = "1475164217115021475";

// Scanner Config
const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];
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

// In-Memory Storage
const csSessions = new Map();
const spamConfigs = new Map(); // Menyimpan target spam user
const activeSpams = new Map(); // Menyimpan interval spam yang sedang berjalan

// =======================
// 🛠️ HELPER FUNCTIONS
// =======================

function detectTypo(text) {
    return /(.)\1{4,}/i.test(text);
}

async function generateAIResponse(input) {
    const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: `Kamu adalah asisten AI. Aturan utamamu:
1. Jawab pertanyaan pengguna dengan singkat, padat, dan jelas. Jangan memberikan penjelasan panjang yang bertele-tele kecuali diminta.
2. Jawab semua pertanyaan dengan baik dan informatif layaknya AI pada umumnya.
3. Sesuaikan sikapmu dengan pengguna: Jika pengguna bertanya dengan sopan, balas dengan ramah. Namun, jika pengguna berkata kasar, toxic, atau menghina, balas dengan kasar, nyolot, dan sarkas.`
                },
                {
                    role: "user",
                    content: input
                }
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

    return { percent, status, color, detail: matches.join("\n") };
}

// =======================
// 🚀 BOT EVENTS
// =======================

client.once('ready', () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
    console.log(`✅ Scanner, AI Chat, Upload, Panel Spam, dan Panel CS siap melayani! (Created by TATANG COMUNITY)`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;

    // ----------------------------------------------------
    // 📖 COMMAND: !help
    // ----------------------------------------------------
    if (content.toLowerCase() === "!help") {
        const helpEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📚 Pusat Bantuan & Panduan Bot')
            .setDescription('Daftar lengkap semua perintah (commands) yang tersedia di bot ini:')
            .addFields(
                { 
                    name: '🛠️ COMMANDS UTAMA', 
                    value: `**\`!help\`**\nMenampilkan menu ini.\n\n**\`!cs\`**\nMembuka Panel Interaktif untuk pembuatan Character Story (CS) GTA Roleplay.\n\n**\`!ai [pesan]\`**\n*(Hanya di Channel AI)*. Ngobrol dengan AI.\n\n**\`!upload Judul | Command | Deskripsi | Author\`**\nMembuat panel postingan download script. **Wajib** lampirkan file script, dan boleh tambah lampiran gambar (opsional) sebagai preview.\n\n**\`!panelspam\`**\nMenampilkan panel eksekusi (spam) untuk menghancurkan Webhook/Token Tele pembuat keylogger.`
                },
                {
                    name: '🤖 FITUR OTOMATIS (PASIF)',
                    value: `**🛡️ Lua & Script Scanner**\n*(Hanya di Channel Scanner)*. Kirim file lua, otomatis akan di-scan dari kode bahaya.`
                }
            )
            .setFooter({ text: 'ASISTEN | TATANG COMUNITY' })
            .setTimestamp();

        return message.reply({ embeds: [helpEmbed] });
    }

    // ----------------------------------------------------
    // 📤 COMMAND: !upload
    // ----------------------------------------------------
    if (content.toLowerCase().startsWith('!upload')) {
        const argsText = content.slice(7).trim();
        const parts = argsText.split('|').map(p => p.trim());
        
        if (parts.length < 4) {
            return message.reply("⚠️ **Format salah!** Gunakan pemisah tanda `|`.\n**Format:** `!upload Judul | Command | Deskripsi | Author`\n*Jangan lupa lampirkan file scriptnya sebelum dikirim!*");
        }

        const [judul, cmd, deskripsi, author] = parts;
        const fileAttachment = message.attachments.first();
        const imageAttachment = message.attachments.find(a => a.contentType && a.contentType.startsWith('image/'));

        if (!fileAttachment) {
            return message.reply("⚠️ Kamu wajib melampirkan file yang ingin diupload!");
        }

        const uploadEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(judul)
            .addFields(
                { name: 'Command', value: `\`${cmd}\`` },
                { name: 'Deskripsi', value: deskripsi },
                { name: 'Author', value: author },
                { name: 'Download', value: `[klik untuk download](${fileAttachment.url})` }
            )
            .setFooter({ text: `@${message.author.username} | Today` });

        // Jika ada attachment berupa gambar, jadikan preview besar di bawah
        if (imageAttachment) {
            uploadEmbed.setImage(imageAttachment.url);
        }

        await message.channel.send({ embeds: [uploadEmbed] });
        
        // Opsional: Hapus pesan command asli agar chat bersih
        try { await message.delete(); } catch (e) { /* ignore */ }
        return;
    }

    // ----------------------------------------------------
    // 💣 COMMAND: !panelspam
    // ----------------------------------------------------
    if (content.toLowerCase() === '!panelspam') {
        const embed = new EmbedBuilder()
            .setTitle('💣 Panel Spam Target Keylogger')
            .setColor('#e74c3c')
            .setDescription('**Apa itu Panel Spam?**\nFitur ini khusus dibuat untuk membanjiri (spamming) Webhook Discord atau Token Bot Telegram milik pencuri data (pembuat keylogger) yang terdeteksi oleh sistem scanner. Tujuannya merusak webhook/bot mereka.\n\n**Cara Penggunaan:**\n1. Klik **Set Webhook** atau **Set Tele** lalu masukkan link/token target.\n2. Klik **▶️ Mulai Spam** untuk mengirim spam beruntun secara otomatis di latar belakang.\n3. Klik **⏹️ Stop Spam** untuk menghentikan serangan.')
            .setFooter({ text: 'Created By TATANG COMUNITY' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('spam_set_webhook').setLabel('Set Webhook Target').setStyle(ButtonStyle.Secondary).setEmoji('🌐'),
            new ButtonBuilder().setCustomId('spam_set_tele').setLabel('Set Token Tele').setStyle(ButtonStyle.Secondary).setEmoji('✈️')
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('spam_start').setLabel('Mulai Spam').setStyle(ButtonStyle.Success).setEmoji('▶️'),
            new ButtonBuilder().setCustomId('spam_stop').setLabel('Stop Spam').setStyle(ButtonStyle.Danger).setEmoji('⏹️')
        );

        return message.channel.send({ embeds: [embed], components: [row1, row2] });
    }

    // ----------------------------------------------------
    // 📝 COMMAND: !cs
    // ----------------------------------------------------
    if (content.toLowerCase() === '!cs') {
        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('📝 Panel Pembuatan Character Story')
            .setDescription('Tekan tombol di bawah untuk memulai proses pembuatan **Character Story (CS)** yang lebih detail dan sesuai keinginanmu.\n\n**Alur Baru yang Lebih Detail**\n1. Pilih Server\n2. Pilih Sisi Cerita (Baik/Jahat)\n3. Isi Detail Lengkap Karakter (Nama, Kultur, Bakat, dll.)')
            .setFooter({ text: 'Created By TATANG COMUNITY' });

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_cs')
                .setLabel('Buat Character Story')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Primary)
        );

        return message.channel.send({ embeds: [embed], components: [button] });
    }

    // ----------------------------------------------------
    // 🤖 AI CHANNEL LOGIC (Chat)
    // ----------------------------------------------------
    if (message.channel.id === aiChannelId) {
        try {
            if (content.startsWith("!ai")) {
                const userInput = content.slice(3).trim();
                if (!userInput) return message.reply("Mau nanya apa? Ketik pesannya setelah !ai.");
                const aiResponse = await generateAIResponse(userInput);
                return message.reply(aiResponse);
            }

            if (detectTypo(content)) {
                const aiResponse = await generateAIResponse("Tanggapi pesan ini yang sepertinya banyak typo: " + content);
                return message.reply(aiResponse);
            }

            if (Math.random() < 0.3) {
                const aiResponse = await generateAIResponse(content);
                return message.reply(aiResponse);
            }
        } catch (err) {
            console.error("AI Error:", err.response?.data || err.message);
        }
    }

    // ----------------------------------------------------
    // 🔎 SCANNER CHANNEL LOGIC
    // ----------------------------------------------------
    if (message.channel.id === scannerChannelId) {
        if (!message.attachments.size) return;

        const attachment = message.attachments.first();
        const fileName = attachment.name.toLowerCase();
        const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

        if (!isAllowed) {
            const warningEmbed = new EmbedBuilder()
                .setTitle("⚠️ Format File Tidak Didukung")
                .setColor(0xff0000)
                .setDescription("Hanya file berisi script yang bisa dianalisis:\n\n• .lua\n• .txt\n• .zip\n• .7z")
                .setFooter({ text: "Deteksi Keylogger by TATANG COMUNITY" })
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
                .setFooter({ text: "Deteksi Keylogger by TATANG COMUNITY" })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error("Scanner Error:", error);
            message.reply("❌ Gagal membaca atau menganalisis file.");
        }
    }
});

// =======================
// 🎛️ INTERACTION HANDLER 
// =======================

client.on('interactionCreate', async (interaction) => {

    // ==========================================
    // LOGIKA PANEL SPAM KEYLOGGER
    // ==========================================
    if (interaction.isButton() && interaction.customId === 'spam_set_webhook') {
        const modal = new ModalBuilder().setCustomId('modal_set_webhook').setTitle('Set Target Webhook');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_url').setLabel('Link Webhook Discord').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('WEBHOOK INI TELAH DIHANCURKAN OLEH TATANG COMUNITY ANTI KEYLOGGER!'))
        );
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'spam_set_tele') {
        const modal = new ModalBuilder().setCustomId('modal_set_tele').setTitle('Set Target Telegram');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_token').setLabel('Bot Token Target').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_chatid').setLabel('Chat ID Target').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('BOT INI TELAH DIHANCURKAN OLEH TATANG COMUNITY ANTI KEYLOGGER!'))
        );
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_webhook') {
        const url = interaction.fields.getTextInputValue('in_webhook_url');
        const msg = interaction.fields.getTextInputValue('in_webhook_msg');
        spamConfigs.set(interaction.user.id, { type: 'webhook', url, msg });
        await interaction.reply({ content: '✅ Target Webhook disetel! Sekarang tekan tombol **Mulai Spam**.', ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_tele') {
        const token = interaction.fields.getTextInputValue('in_tele_token');
        const chatId = interaction.fields.getTextInputValue('in_tele_chatid');
        const msg = interaction.fields.getTextInputValue('in_tele_msg');
        spamConfigs.set(interaction.user.id, { type: 'telegram', token, chatId, msg });
        await interaction.reply({ content: '✅ Target Telegram disetel! Sekarang tekan tombol **Mulai Spam**.', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'spam_start') {
        const config = spamConfigs.get(interaction.user.id);
        if (!config) return interaction.reply({ content: '⚠️ Kamu belum mengatur target! Silakan klik **Set Webhook** atau **Set Tele** dulu.', ephemeral: true });
        
        if (activeSpams.has(interaction.user.id)) {
            return interaction.reply({ content: '⚠️ Spam sudah berjalan! Jika ingin mengganti target, tekan **Stop Spam** terlebih dahulu.', ephemeral: true });
        }

        await interaction.reply({ content: '🔥 Menginisiasi serangan... Spam berjalan di latar belakang! (Interval: 1 detik)', ephemeral: true });

        // Mulai interval spam (1 pesan per detik agar rate-limit tidak langsung ban IP bot kamu)
        const interval = setInterval(async () => {
            try {
                if (config.type === 'webhook') {
                    await axios.post(config.url, { content: config.msg });
                } else if (config.type === 'telegram') {
                    await axios.post(`https://api.telegram.org/bot${config.token}/sendMessage`, { chat_id: config.chatId, text: config.msg });
                }
            } catch (e) {
                // Ignore error (biasanya 429 Too Many Requests atau 404 Not Found jika webhook sudah terhapus)
            }
        }, 1000);

        activeSpams.set(interaction.user.id, interval);
    }

    if (interaction.isButton() && interaction.customId === 'spam_stop') {
        const interval = activeSpams.get(interaction.user.id);
        if (interval) {
            clearInterval(interval);
            activeSpams.delete(interaction.user.id);
            return interaction.reply({ content: '🛑 Serangan spam dihentikan.', ephemeral: true });
        } else {
            return interaction.reply({ content: '⚠️ Tidak ada serangan spam yang sedang berjalan atas nama kamu.', ephemeral: true });
        }
    }


    // ==========================================
    // LOGIKA PEMBUATAN CHARACTER STORY
    // ==========================================
    if (interaction.isButton() && interaction.customId === 'start_cs') {
        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_server')
                .setPlaceholder('Pilih server tujuan...')
                .addOptions([
                    { label: 'SSRP', description: 'Buat CS untuk server State Side RP', value: 'SSRP' },
                    { label: 'Virtual RP', description: 'Buat CS untuk server Virtual RP', value: 'Virtual RP' },
                    { label: 'AARP', description: 'Buat CS untuk server Arsy Asia RP', value: 'AARP' },
                    { label: 'GCRP', description: 'Buat CS untuk server Grand Country RP', value: 'GCRP' },
                    { label: 'TEN ROLEPLAY', description: 'Buat CS untuk server 10RP', value: 'TEN ROLEPLAY' },
                    { label: 'CPRP', description: 'Buat CS untuk server Crystal Pride RP', value: 'CPRP' },
                    { label: 'Relative RP', description: 'Buat CS untuk server Relative RP', value: 'Relative RP' },
                    { label: 'JGRP', description: 'Buat CS untuk server Jogja Gamers RP', value: 'JGRP' },
                    { label: 'FMRP', description: 'Buat CS untuk server FAMERLONE RP', value: 'FMRP' }
                ])
        );

        await interaction.reply({ content: 'Pilih server di mana karaktermu akan bermain:', components: [selectMenu], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
        csSessions.set(interaction.user.id, { server: interaction.values[0] });

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('side_good').setLabel('Sisi Baik (Goodside)').setEmoji('😇').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('side_bad').setLabel('Sisi Jahat (Badside)').setEmoji('😈').setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({ content: 'Pilih alur cerita untuk karaktermu:', components: [buttons], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId === 'side_good' || interaction.customId === 'side_bad')) {
        const side = interaction.customId === 'side_good' ? 'Good Side' : 'Bad Side';
        
        const session = csSessions.get(interaction.user.id) || { server: 'Unknown' };
        session.side = side;
        csSessions.set(interaction.user.id, session);

        const modal = new ModalBuilder().setCustomId('modal_step_1').setTitle(`Detail Karakter (${side}) (1/2)`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_nama').setLabel('Nama Lengkap Karakter (IC)').setPlaceholder('Contoh: John Washington, Kenji Tanaka...').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_level').setLabel('Level Karakter').setPlaceholder('Contoh: 1').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_gender').setLabel('Jenis Kelamin').setPlaceholder('Contoh: Laki-laki / Perempuan').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_dob').setLabel('Tanggal Lahir').setPlaceholder('Contoh: 20 Desember 2006').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_city').setLabel('Kota Asal').setPlaceholder('Contoh: Chicago, Illinois').setStyle(TextInputStyle.Short).setRequired(true))
        );

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_step_1') {
        const session = csSessions.get(interaction.user.id);
        if (!session) return interaction.reply({ content: 'Sesi pembuatan habis, silakan ketik !cs kembali.', ephemeral: true });

        session.data = {
            nama: interaction.fields.getTextInputValue('in_nama'),
            level: interaction.fields.getTextInputValue('in_level'),
            gender: interaction.fields.getTextInputValue('in_gender'),
            dob: interaction.fields.getTextInputValue('in_dob'),
            city: interaction.fields.getTextInputValue('in_city')
        };

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('to_step_2').setLabel('Lanjutkan ke Detail Cerita (2/2)').setEmoji('➡️').setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({ content: '✅ Detail dasar berhasil disimpan. Tekan tombol di bawah untuk melanjutkan pengisian detail cerita.', components: [button], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'to_step_2') {
        const session = csSessions.get(interaction.user.id);
        if (!session) return interaction.reply({ content: 'Sesi pembuatan habis, silakan ketik !cs kembali.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('modal_step_2').setTitle(`Detail Cerita (${session.side}) (2/2)`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_bakat').setLabel('Bakat/Keahlian Dominan Karakter').setPlaceholder('Contoh: Penembak jitu, negosiator ulung,...').setStyle(TextInputStyle.Paragraph).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_kultur').setLabel('Kultur/Etnis (Opsional)').setPlaceholder('Contoh: African-American, Hispanic,...').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_ekstra').setLabel('Detail Tambahan (Opsional)').setPlaceholder('Contoh: Punya hutang, dikhianati geng lama...').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_step_2') {
        await interaction.deferReply(); 

        const session = csSessions.get(interaction.user.id);
        if (!session || !session.data) {
            return interaction.editReply({ content: '❌ Terjadi kesalahan sesi. Silakan ulangi !cs' });
        }

        const bakat = interaction.fields.getTextInputValue('in_bakat');
        const kultur = interaction.fields.getTextInputValue('in_kultur') || '-';
        const ekstra = interaction.fields.getTextInputValue('in_ekstra') || '-';

        try {
            const promptContext = `Tuliskan Character Story GTA Roleplay untuk karakter bernama ${session.data.nama} (Gender: ${session.data.gender}). Tanggal Lahir: ${session.data.dob}, Asal Kota: ${session.data.city}. 
            Sisi Cerita: ${session.side}, Bakat Dominan: ${bakat}, Kultur/Etnis: ${kultur}, Detail Tambahan: ${ekstra}.
            Buat cerita masa lalunya dalam 3 paragraf panjang bahasa Indonesia formal bergaya naratif (novel). Langsung berikan ceritanya tanpa kata pengantar apapun.`;

            const chatCompletion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: promptContext }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.7
            });

            const story = chatCompletion.choices[0].message.content;

            const finalEmbed = new EmbedBuilder()
                .setColor(session.side === 'Good Side' ? '#2ecc71' : '#e74c3c')
                .setTitle(`📄 Character Story: ${session.data.nama}`)
                .setDescription(story.substring(0, 4000))
                .addFields(
                    { name: '🌐 Server', value: session.server, inline: true },
                    { name: '🎭 Sisi Cerita', value: session.side, inline: true },
                    { name: '📈 Level', value: session.data.level, inline: true }
                )
                .setFooter({ text: 'Created By TATANG COMUNITY' }); 

            await interaction.editReply({ embeds: [finalEmbed] });
            
            csSessions.delete(interaction.user.id);
        } catch (error) {
            console.error('Groq AI Error:', error);
            await interaction.editReply({ content: '❌ Gagal membuat cerita karena server AI sedang sibuk. Coba beberapa saat lagi.' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
