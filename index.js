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
    TextInputStyle,
    REST, 
    Routes, 
    SlashCommandBuilder,
    ChannelType
} = require('discord.js');
const axios = require('axios');
const Groq = require('groq-sdk');

// =======================
// ⚙️ INITIALIZATION & ENV
// =======================

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!TOKEN || !CLIENT_ID) {
    console.error("❌ TOKEN / CLIENT_ID belum di set di Environment Variables!");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const groq = new Groq({ apiKey: GROQ_API_KEY });
const rest = new REST({ version: '10' }).setToken(TOKEN);

// =======================
// 🔒 CONFIGURATION
// =======================

const scannerChannelId = "1477131305765572618";
const aiChannelId = "1475164217115021475";
const uploadRoleId = "1466470849266848009"; // Role khusus untuk /upload

// Menambahkan .rar ke dalam ekstensi yang diizinkan
const allowedExtensions = [".lua", ".txt", ".zip", ".7z", ".rar"];

// Menambahkan pola deteksi yang lebih spesifik dan mematikan
const detectionPatterns = [
    // BAHAYA BESAR (Level 4 - 50 point)
    { regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, desc: "Discord Webhook", sev: 4 },
    { regex: /api\.telegram\.org\/bot/i, desc: "Telegram Bot API", sev: 4 },
    { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "Command Execution", sev: 4 },
    { regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, desc: "Dynamic Code Execution", sev: 4 },
    { regex: /downloadUrlToFile/i, desc: "Malware Downloader", sev: 4 },
    { regex: /ffi\.C\.system/i, desc: "FFI System Command", sev: 4 },
    { regex: /ffi\.load\s*\(\s*['"](?:wininet|ws2_32)['"]\s*\)/i, desc: "FFI Network DLL", sev: 4 },

    // SANGAT MENCURIGAKAN (Level 3 - 30 point)
    { regex: /moonsec|protected with moonsec/i, desc: "MoonSec Protection", sev: 3 },
    { regex: /luaobfuscator|obfuscate|anti[-_ ]debug/i, desc: "Obfuscation", sev: 3 },
    { regex: /require\s*\(\s*['"]socket(?:\.http)?['"]\s*\)/i, desc: "Socket/HTTP Network", sev: 3 },
    { regex: /(?:[A-Za-z0-9+\/]{100,}={0,2})/, desc: "Base64 Encoded Blob", sev: 3 },
    { regex: /os\.remove|os\.rename/i, desc: "OS File Manipulation", sev: 3 },
    { regex: /getenv\s*\(\s*['"]APPDATA['"]\s*\)/i, desc: "Access AppData", sev: 3 },

    // MENCURIGAKAN (Level 2 - 18 point)
    { regex: /\b(password|username|token|hwid|ip)\b\s*[:=]/i, desc: "Credential Variable", sev: 2 },
    { regex: /\bsampGetPlayer(?:Nickname|Name|Ip)\b/i, desc: "SAMP Player Data Grabber", sev: 2 },
    { regex: /getClipboardText/i, desc: "Clipboard Reader", sev: 2 },
    { regex: /io\.open/i, desc: "File I/O Writer", sev: 2 },

    // PERINGATAN (Level 1 - 8 point)
    { regex: /loadstring/i, desc: "Loadstring Keyword", sev: 1 },
    { regex: /password/i, desc: "Password Keyword", sev: 1 }
];

const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50 };

const csSessions = new Map();
const spamConfigs = new Map();
const activeSpams = new Map();

// =======================
// 🛠️ HELPER FUNCTIONS
// =======================

function detectTypo(text) {
    return /(.)\1{4,}/i.test(text);
}

async function generateAIResponse(input) {
    if (!GROQ_API_KEY) return "API Key Groq belum diatur!";
    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `Kamu adalah asisten AI. Aturan utamamu:
1. Jawab pertanyaan pengguna dengan singkat, padat, dan jelas.
2. Jawab semua pertanyaan dengan baik layaknya AI.
3. Sesuaikan sikapmu: Jika sopan balas ramah, jika toxic balas nyolot dan sarkas.`
                    },
                    { role: "user", content: input }
                ],
                temperature: 0.7
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("Groq Chat Error:", err);
        return "Aduh, otak AI aku lagi error nih. Coba lagi nanti ya!";
    }
}

// Fungsi AI Khusus untuk mendeteksi baris berbahaya
async function analyzeCodeWithAI(code, fileName) {
    if (!GROQ_API_KEY) return "AI Scanner belum siap (API Key hilang).";
    
    // Potong kode jika terlalu panjang & tambahkan nomor baris agar AI tidak halusinasi
    const numberedCode = code.split('\n')
        .map((line, i) => `${i + 1}| ${line}`)
        .slice(0, 1500) // Batasi 1500 baris untuk limit token
        .join('\n');

    const promptContext = `Tolong analisis kode Lua berikut. Carikan baris yang mengandung fungsi berbahaya atau pencurian data seperti webhook, API telegram, socket.http, exec, os.execute, atau variabel username/password.
    
    Berikan output HANYA berupa list temuan baris kode dengan format persis seperti ini:
    - \`[kata kunci]\` di \`${fileName}\` (L[nomor baris])
    
    Contoh:
    - \`username\` di \`namasc.lua\` (L7)
    - \`socket.http\` di \`namasc.lua\` (L110)
    
    Jika kodenya murni aman dan tidak ada satu pun yang mencurigakan, balas HANYA dengan kata "Aman".
    
    Kode:
    ${numberedCode}`;

    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: promptContext }],
                temperature: 0.1
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("Groq Code Scanner Error:", err);
        return "Gagal melakukan analisis baris AI.";
    }
}

function analyzeContent(text) {
    const matches = [];
    let rawScore = 0;

    detectionPatterns.forEach(p => {
        if (p.regex.test(text)) {
            matches.push(`• ${p.desc} (Level ${p.sev})`);
            rawScore += severityWeight[p.sev];
        }
    });

    let percent = Math.min(100, rawScore);
    let status = "🟢 AMAN";
    let color = 0x00ff00;

    if (percent >= 80) {
        status = "🔴 BAHAYA BESAR"; color = 0xff0000;
    } else if (percent >= 50) {
        status = "🟠 SANGAT MENCURIGAKAN"; color = 0xff8800;
    } else if (percent >= 20) {
        status = "🟡 MENCURIGAKAN"; color = 0xffcc00;
    }

    if (matches.length === 0) matches.push("Tidak ditemukan pola mencurigakan");
    return { percent, status, color, detail: matches.join("\n") };
}

// Data Pesan Reusable untuk / dan ! commands
const payloads = {
    help: () => ({
        embeds: [new EmbedBuilder()
            .setColor('#00d2ff')
            .setTitle('🌟 Pusat Komando & Panduan Bot 🌟')
            .setDescription('Selamat datang di sistem asisten otomatis!\nBerikut adalah direktori lengkap fitur yang tersedia. Kamu dapat menggunakan prefix `!` atau `/` (Slash Commands).\n')
            .addFields(
                { 
                    name: '🎮 ROLEPLAY & UTILITIES', 
                    value: `**> \`!cs\` / \`/cs\`**\nMembuka panel interaktif pembuatan *Character Story* dengan bantuan AI.\n\n**> \`!panelspam\` / \`/panelspam\`**\nMembuka tools panel untuk melumpuhkan Webhook/Telegram target (Anti-Keylogger).` 
                },
                { 
                    name: '🤖 FITUR OTOMATIS (Pasif)', 
                    value: `**> 🛡️ Cek Keylogger Otomatis**\nKirim file script ke channel Scanner. Bot akan langsung membedah dan mendeteksi script berbahaya / keylogger secara otomatis!\n\n**> 🤖 AI Chat & Typo Fixer**\nMengobrol bebas dengan AI di channel khusus, atau gunakan \`!ai [pesan]\`.` 
                },
                { 
                    name: '🔒 KHUSUS STAFF / ROLE TERTENTU', 
                    value: `**> \`/upload\`**\nPanel terstruktur untuk merilis script/mod ke server.\n\n**> \`/status\`**\nMemeriksa metrik operasional bot dan ping server.` 
                }
            )
            .setFooter({ text: 'Tatang Community System', iconURL: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' })
            .setTimestamp()]
    }),
    status: (client) => ({
        embeds: [new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('📊 Metrik & Status Operasional Server')
            .setDescription('Berikut adalah diagnostik terkini dari sistem bot dan layanan pihak ketiga yang terhubung:')
            .addFields(
                { name: '📡 Koneksi Jaringan', value: `> **Ping (Latency):** \`${client ? client.ws.ping : 0}ms\` 🟢\n> **Uptime:** \`Sistem Stabil\``, inline: false },
                { name: '🤖 Status Core', value: '> `🟢 Online & Optimal`', inline: true },
                { name: '🧠 Groq AI Engine', value: '> `🟢 Terhubung`', inline: true },
                { name: '🛡️ Scanner Module', value: '> `🟢 Memantau Aktif`', inline: true },
                { name: '👥 Staff / Operator', value: '> `✅ Standby`', inline: true }
            )
            .setFooter({ text: 'Tatang Community System' })
            .setTimestamp()]
    }),
    panelspam: () => ({
        embeds: [new EmbedBuilder()
            .setTitle('💣 Panel Spam Target Keylogger')
            .setColor('#e74c3c')
            .setDescription('**Panel Spam Webhook & Telegram**\nFitur untuk membanjiri target pembuat keylogger.\n\n1. Klik **Set Target**.\n2. Klik **Mulai Spam**.\n3. Klik **Stop Spam** untuk berhenti.')
            .setFooter({ text: 'Created By TATANG COMUNITY' })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('spam_set_webhook').setLabel('Set Webhook').setStyle(ButtonStyle.Secondary).setEmoji('🌐'),
                new ButtonBuilder().setCustomId('spam_set_tele').setLabel('Set Token Tele').setStyle(ButtonStyle.Secondary).setEmoji('✈️')
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('spam_start').setLabel('Mulai Spam').setStyle(ButtonStyle.Success).setEmoji('▶️'),
                new ButtonBuilder().setCustomId('spam_stop').setLabel('Stop Spam').setStyle(ButtonStyle.Danger).setEmoji('⏹️')
            )
        ]
    }),
    cs: () => ({
        embeds: [new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('📝 Panel Pembuatan Character Story')
            .setDescription('Tekan tombol di bawah untuk memulai proses pembuatan **Character Story (CS)**.\n\n**⚠️ Persiapkan Data Karaktermu:**\n- **Nama IC** *(Contoh: John Doe, Udin Petot)*\n- **Level IC** *(Contoh: 3, 5, 10)*\n- **Kota Asal** *(Contoh: Los Santos, Las Venturas, San Fierro)*\n- **Tanggal Lahir & Jenis Kelamin**\n- **Bakat & Kultur Cerita**')
            .setFooter({ text: 'Created By TATANG COMUNITY' })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setEmoji('📝').setStyle(ButtonStyle.Primary)
            )
        ]
    })
};

// =======================
// 📜 SLASH COMMANDS REGISTRATION
// =======================

const commands = [
    new SlashCommandBuilder().setName('help').setDescription('Tampilkan menu bantuan bot'),
    new SlashCommandBuilder().setName('panelspam').setDescription('Tampilkan panel spam target keylogger'),
    new SlashCommandBuilder().setName('cs').setDescription('Buka panel pembuatan Character Story (CS)'),
    new SlashCommandBuilder().setName('status').setDescription('Cek status operator bot (Eksklusif Slash Command)'),
    new SlashCommandBuilder()
        .setName('upload')
        .setDescription('Upload script/mod ke channel (Eksklusif Slash Command & Role Khusus)')
        .addChannelOption(opt => opt.setName('channel').setDescription('Pilih channel tujuan').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('judul').setDescription('Judul Script').setRequired(true))
        .addStringOption(opt => opt.setName('cmd').setDescription('Command game').setRequired(true))
        .addStringOption(opt => opt.setName('deskripsi').setDescription('Deskripsi script').setRequired(true))
        .addStringOption(opt => opt.setName('credit').setDescription('Credit pembuat').setRequired(true))
        .addStringOption(opt => opt.setName('download').setDescription('Link download').setRequired(true))
        .addAttachmentOption(opt => opt.setName('gambar').setDescription('Upload gambar (optional)').setRequired(false))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
    try {
        console.log('🔄 Registering Slash Commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash Commands berhasil diregister!');
        console.log(`✅ Scanner, AI Chat, Panel Spam, dan Panel CS siap melayani!`);
    } catch (err) {
        console.error('❌ Gagal register Slash Command:', err);
    }
});

// =======================
// 💬 MESSAGE LISTENER (Prefix & Automations)
// =======================

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();

    // PREFIX COMMANDS (!)
    if (content === "!help") return message.reply(payloads.help());
    if (content === "!panelspam") return message.channel.send(payloads.panelspam());
    if (content === "!cs") return message.channel.send(payloads.cs());

    // AI CHANNEL LOGIC
    if (message.channel.id === aiChannelId) {
        if (content.startsWith("!ai")) {
            const userInput = message.content.slice(3).trim();
            if (!userInput) return message.reply("Mau nanya apa? Ketik pesannya setelah !ai.");
            const aiResponse = await generateAIResponse(userInput);
            return message.reply(aiResponse);
        }
        if (detectTypo(content)) {
            const aiResponse = await generateAIResponse("Tanggapi pesan ini yang sepertinya banyak typo: " + message.content);
            return message.reply(aiResponse);
        }
        if (Math.random() < 0.3) {
            const aiResponse = await generateAIResponse(message.content);
            return message.reply(aiResponse);
        }
    }

    // SCANNER CHANNEL LOGIC
    if (message.channel.id === scannerChannelId && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const fileName = attachment.name.toLowerCase();
        const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

        if (!isAllowed) {
            return message.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Format File Tidak Didukung").setColor(0xff0000).setDescription(`Hanya: ${allowedExtensions.join(", ")}`).setTimestamp()] });
        }

        try {
            const processingMsg = await message.reply("⏳ Sedang membedah file dan memeriksa baris kode dengan AI...");
            
            const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
            const contentFile = Buffer.from(response.data).toString("utf8");
            
            // Regex Analyzer
            const result = analyzeContent(contentFile);
            
            // Ekstraksi Link Webhook / Telegram
            const webhookRegex = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s'"]+/gi;
            const teleRegex = /https?:\/\/api\.telegram\.org\/bot[^\s'"]+/gi;
            const extractedWebhooks = contentFile.match(webhookRegex) || [];
            const extractedTeles = contentFile.match(teleRegex) || [];
            const targetLinks = [...new Set([...extractedWebhooks, ...extractedTeles])];

            // AI Line Analyzer
            const aiLines = await analyzeCodeWithAI(contentFile, attachment.name);

            const embed = new EmbedBuilder()
                .setTitle("🛡️ Hasil Analisis Keamanan")
                .setColor(result.color)
                .addFields(
                    { name: "👤 Pengguna", value: `${message.author}`, inline: true },
                    { name: "📄 Nama File", value: attachment.name, inline: true },
                    { name: "📦 Ukuran", value: `${(attachment.size / 1024).toFixed(2)} KB`, inline: true },
                    { name: "📊 Status Keamanan", value: result.status },
                    { name: "⚠️ Tingkat Risiko", value: `${result.percent}%` },
                    { name: "🔎 Deteksi Sistem", value: result.detail },
                    { name: "🤖 Deteksi Baris AI", value: aiLines }
                )
                .setFooter({ text: "Deteksi Anti-Keylogger by TATANG COMUNITY" })
                .setTimestamp();

            await processingMsg.edit({ content: "✅ Analisis selesai!", embeds: [embed] });

            // Jika ada link webhook atau tele, kirim pesan terpisah agar bisa di copy paste untuk spam
            if (targetLinks.length > 0) {
                await message.channel.send({
                    content: `🚨 **TARGET DITEMUKAN!**\nSistem menemukan link yang mengarah ke pelaku. Salin link di bawah ini dan gunakan di \`!panelspam\` untuk menghancurkan mereka:\n\n${targetLinks.map(link => `\`${link}\``).join('\n')}`
                });
            }

        } catch (error) {
            console.error("Scanner Error:", error);
            message.reply("❌ Gagal membaca atau menganalisis file coba kirim file .lua");
        }
    }
});

// =======================
// 🎛️ INTERACTION HANDLER (Slash Cmds, Buttons, Modals)
// =======================

client.on('interactionCreate', async (interaction) => {

    // --- SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'help') return interaction.reply(payloads.help());
        if (commandName === 'panelspam') return interaction.reply(payloads.panelspam());
        if (commandName === 'cs') return interaction.reply(payloads.cs());
        if (commandName === 'status') return interaction.reply(payloads.status(client));

        if (commandName === 'upload') {
            if (!interaction.member.roles.cache.has(uploadRoleId)) {
                return interaction.reply({ 
                    content: '❌ Akses Ditolak! Kamu tidak memiliki role yang diizinkan untuk menggunakan command ini.', 
                    ephemeral: true 
                });
            }

            try {
                const channel = interaction.options.getChannel('channel');
                const jdl = interaction.options.getString('judul');
                const cmd = interaction.options.getString('cmd');
                const dsk = interaction.options.getString('deskripsi');
                const credit = interaction.options.getString('credit');
                const dwn = interaction.options.getString('download');
                const img = interaction.options.getAttachment('gambar');
                const tgl = new Date().toLocaleDateString('id-ID');

                const embed = new EmbedBuilder()
                    .setColor('#ffffff')
                    .setTitle(`**${jdl}**`)
                    .addFields(
                        { name: 'Command', value: `\`${cmd}\`` },
                        { name: 'Deskripsi', value: dsk },
                        { name: 'Credit', value: credit },
                        { name: 'Download', value: `[klik untuk download](${dwn})` }
                    )
                    .setFooter({ text: `@tatang comunity | ${tgl}` });

                if (img) embed.setImage(img.url);

                await channel.send({ embeds: [embed] });
                await interaction.reply({ content: `✅ Berhasil dikirim ke ${channel}`, ephemeral: true });
            } catch (err) {
                console.error("❌ ERROR Upload:", err);
                await interaction.reply({ content: "❌ Terjadi error saat upload!", ephemeral: true });
            }
        }
        return;
    }

    // --- PANEL SPAM LOGIC ---
    if (interaction.isButton()) {
        if (interaction.customId === 'spam_set_webhook') {
            const modal = new ModalBuilder().setCustomId('modal_set_webhook').setTitle('Set Target Webhook');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_url').setLabel('Link Webhook Discord').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('WEBHOOK INI TELAH DIHANCURKAN OLEH TATANG COMUNITY ANTI KEYLOGGER!'))
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'spam_set_tele') {
            const modal = new ModalBuilder().setCustomId('modal_set_tele').setTitle('Set Target Telegram');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_token').setLabel('Bot Token Target').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_chatid').setLabel('Chat ID Target').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('BOT INI TELAH DIHANCURKAN OLEH TATANG COMUNITY ANTI KEYLOGGER!'))
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'spam_start') {
            const config = spamConfigs.get(interaction.user.id);
            if (!config) return interaction.reply({ content: '⚠️ Belum mengatur target! Set Webhook/Tele dulu.', ephemeral: true });
            if (activeSpams.has(interaction.user.id)) return interaction.reply({ content: '⚠️ Spam sudah berjalan! Stop spam dulu.', ephemeral: true });

            await interaction.reply({ content: '🔥 Spam dimulai! Berjalan di latar belakang (1 detik interval).', ephemeral: true });
            const interval = setInterval(async () => {
                try {
                    if (config.type === 'webhook') await axios.post(config.url, { content: config.msg });
                    else if (config.type === 'telegram') await axios.post(`https://api.telegram.org/bot${config.token}/sendMessage`, { chat_id: config.chatId, text: config.msg });
                } catch (e) { /* Abaikan error limit */ }
            }, 1000);
            activeSpams.set(interaction.user.id, interval);
        }

        if (interaction.customId === 'spam_stop') {
            const interval = activeSpams.get(interaction.user.id);
            if (interval) {
                clearInterval(interval);
                activeSpams.delete(interaction.user.id);
                return interaction.reply({ content: '🛑 Spam dihentikan.', ephemeral: true });
            }
            return interaction.reply({ content: '⚠️ Tidak ada spam berjalan.', ephemeral: true });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_set_webhook') {
            spamConfigs.set(interaction.user.id, { type: 'webhook', url: interaction.fields.getTextInputValue('in_webhook_url'), msg: interaction.fields.getTextInputValue('in_webhook_msg') });
            return interaction.reply({ content: '✅ Target Webhook disetel! Tekan Mulai Spam.', ephemeral: true });
        }
        if (interaction.customId === 'modal_set_tele') {
            spamConfigs.set(interaction.user.id, { type: 'telegram', token: interaction.fields.getTextInputValue('in_tele_token'), chatId: interaction.fields.getTextInputValue('in_tele_chatid'), msg: interaction.fields.getTextInputValue('in_tele_msg') });
            return interaction.reply({ content: '✅ Target Telegram disetel! Tekan Mulai Spam.', ephemeral: true });
        }
    }

    // --- CS CREATION LOGIC ---
    if (interaction.isButton() && interaction.customId === 'start_cs') {
        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_server').setPlaceholder('Pilih server tujuan...').addOptions([
                { label: 'SSRP', value: 'SSRP' }, { label: 'Virtual RP', value: 'Virtual RP' }, { label: 'AARP', value: 'AARP' },
                { label: 'GCRP', value: 'GCRP' }, { label: 'TEN ROLEPLAY', value: 'TEN ROLEPLAY' }, { label: 'CPRP', value: 'CPRP' },
                { label: 'Relative RP', value: 'Relative RP' }, { label: 'JGRP', value: 'JGRP' }, { label: 'FMRP', value: 'FMRP' }
            ])
        );
        return interaction.reply({ content: 'Pilih server karaktermu:', components: [selectMenu], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
        csSessions.set(interaction.user.id, { server: interaction.values[0] });
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('side_good').setLabel('Goodside').setEmoji('😇').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('side_bad').setLabel('Badside').setEmoji('😈').setStyle(ButtonStyle.Danger)
        );
        return interaction.reply({ content: 'Pilih alur cerita:', components: [buttons], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId === 'side_good' || interaction.customId === 'side_bad')) {
        const side = interaction.customId === 'side_good' ? 'Good Side' : 'Bad Side';
        const session = csSessions.get(interaction.user.id) || { server: 'Unknown' };
        session.side = side;
        csSessions.set(interaction.user.id, session);

        const modal = new ModalBuilder().setCustomId('modal_step_1').setTitle(`Detail Karakter (${side}) (1/2)`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_nama').setLabel('Nama Lengkap (IC)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Contoh: John Doe')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_level').setLabel('Level Karakter').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Contoh: 5')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_gender').setLabel('Jenis Kelamin').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Contoh: Laki-laki / Perempuan')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_dob').setLabel('Tanggal Lahir').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Contoh: 12 Mei 1998')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_city').setLabel('Kota Asal').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Contoh: Los Santos'))
        );
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_step_1') {
        const session = csSessions.get(interaction.user.id);
        if (!session) return interaction.reply({ content: 'Sesi habis, ulangi perintah cs.', ephemeral: true });

        session.data = {
            nama: interaction.fields.getTextInputValue('in_nama'),
            level: interaction.fields.getTextInputValue('in_level'),
            gender: interaction.fields.getTextInputValue('in_gender'),
            dob: interaction.fields.getTextInputValue('in_dob'),
            city: interaction.fields.getTextInputValue('in_city')
        };

        const button = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('to_step_2').setLabel('Lanjutkan (2/2)').setEmoji('➡️').setStyle(ButtonStyle.Primary));
        return interaction.reply({ content: '✅ Detail dasar disimpan. Lanjut isi detail cerita.', components: [button], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'to_step_2') {
        const session = csSessions.get(interaction.user.id);
        if (!session) return interaction.reply({ content: 'Sesi habis, ulangi perintah cs.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('modal_step_2').setTitle(`Detail Cerita (${session.side}) (2/2)`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_bakat').setLabel('Bakat Dominan').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Contoh: Jago menembak, pintar negosiasi')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_kultur').setLabel('Kultur/Etnis').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Contoh: African-American, Hispanic')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_ekstra').setLabel('Detail Tambahan').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Contoh: Punya dendam masa lalu di kota asal'))
        );
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_step_2') {
        // Hapus { ephemeral: true } atau biarkan kosong supaya pesan jadi publik dan bot bisa nge-tag!
        await interaction.deferReply(); 
        
        const session = csSessions.get(interaction.user.id);
        if (!session || !session.data) return interaction.editReply({ content: '❌ Terjadi kesalahan sesi.' });

        const bakat = interaction.fields.getTextInputValue('in_bakat');
        const kultur = interaction.fields.getTextInputValue('in_kultur') || '-';
        const ekstra = interaction.fields.getTextInputValue('in_ekstra') || '-';

        try {
            const promptContext = `Tuliskan Character Story GTA Roleplay untuk karakter bernama ${session.data.nama} (Gender: ${session.data.gender}). Tanggal Lahir: ${session.data.dob}, Asal Kota: ${session.data.city}. Sisi Cerita: ${session.side}, Bakat: ${bakat}, Kultur: ${kultur}, Tambahan: ${ekstra}. Buat 3 paragraf bahasa Indonesia formal naratif. Langsung berikan ceritanya tanpa kata pengantar apapun.`;

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
                    { name: '📈 Level', value: session.data.level, inline: true },
                    { name: '🏙️ Asal Kota', value: session.data.city, inline: true }
                )
                .setFooter({ text: 'Created By TATANG COMUNITY' }); 

            // Bot otomatis nge-tag usernya waktu kasih hasil akhir
            await interaction.editReply({ 
                content: `🎉 Yeay! Character Story berhasil dibuat untuk <@${interaction.user.id}>!`, 
                embeds: [finalEmbed] 
            });
            csSessions.delete(interaction.user.id);
        } catch (error) {
            console.error('Groq AI Error:', error);
            await interaction.editReply({ content: '❌ Gagal membuat cerita karena server AI sedang sibuk.' });
        }
    }
});

// LOGIN
client.login(TOKEN);
