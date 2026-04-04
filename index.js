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
    ChannelType,
    AttachmentBuilder
} = require('discord.js');
const axios = require('axios');
const Groq = require('groq-sdk');
const AdmZip = require('adm-zip'); // WAJIB: npm install adm-zip

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
const uploadRoleId = "1466470849266848009"; 

const allowedExtensions = [".lua", ".txt", ".zip", ".7z", ".rar"];

const detectionPatterns = [
    // BAHAYA BESAR (Level 4 - 50 point) - Baris ini akan otomatis dihapus di versi "Clean"
    { regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, desc: "Discord Webhook", sev: 4 },
    { regex: /api\.telegram\.org\/bot/i, desc: "Telegram Bot API", sev: 4 },
    { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "Command Execution", sev: 4 },
    { regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, desc: "Dynamic Code Execution", sev: 4 },
    { regex: /downloadUrlToFile/i, desc: "Malware Downloader", sev: 4 },
    { regex: /ffi\.C\.system/i, desc: "FFI System Command", sev: 4 },
    { regex: /ffi\.load\s*\(\s*['"](?:wininet|ws2_32)['"]\s*\)/i, desc: "FFI Network DLL", sev: 4 },

    // SANGAT MENCURIGAKAN (Level 3 - 30 point) - Baris ini juga akan otomatis dihapus
    { regex: /moonsec|protected with moonsec/i, desc: "MoonSec Protection", sev: 3 },
    { regex: /luaobfuscator|obfuscate|anti[-_ ]debug/i, desc: "Obfuscation", sev: 3 },
    { regex: /require\s*\(\s*['"]socket(?:\.http)?['"]\s*\)/i, desc: "Socket/HTTP Network", sev: 3 },
    { regex: /os\.remove|os\.rename/i, desc: "OS File Manipulation", sev: 3 },

    // MENCURIGAKAN (Level 2 - 18 point) - Hanya deteksi, tidak dihapus agar script tidak rusak
    { regex: /\b(password|username|token|hwid|ip)\b\s*[:=]/i, desc: "Credential Variable", sev: 2 },
    { regex: /\bsampGetPlayer(?:Nickname|Name|Ip)\b/i, desc: "SAMP Player Data Grabber", sev: 2 },
    { regex: /getClipboardText/i, desc: "Clipboard Reader", sev: 2 },
    { regex: /io\.open/i, desc: "File I/O Writer", sev: 2 },

    // PERINGATAN (Level 1 - 8 point)
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

// Fungsi untuk menghapus baris berbahaya dari kode
function cleanDangerousLines(code) {
    return code.split('\n').filter(line => {
        let isSafe = true;
        // Hanya hapus baris dengan severity Level 3 dan Level 4
        detectionPatterns.forEach(p => {
            if (p.sev >= 3 && p.regex.test(line)) {
                isSafe = false;
            }
        });
        return isSafe;
    }).join('\n');
}

async function generateAIResponse(input) {
    if (!GROQ_API_KEY) return "API Key Groq belum diatur!";
    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Kamu adalah asisten AI. Jawab singkat, padat, jelas. Jika sopan balas ramah, jika toxic balas nyolot dan sarkas." },
                    { role: "user", content: input }
                ],
                temperature: 0.7
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("Groq Chat Error:", err);
        return "Aduh, otak AI aku lagi error nih. Coba lagi nanti ya!";
    }
}

async function analyzeCodeWithAI(code, fileName) {
    if (!GROQ_API_KEY) return "AI Scanner belum siap (API Key hilang).";
    
    const numberedCode = code.split('\n')
        .map((line, i) => `${i + 1}| ${line}`)
        .slice(0, 1500) 
        .join('\n');

    const promptContext = `Tolong analisis kode Lua berikut. Carikan baris yang mengandung fungsi berbahaya atau pencurian data.
    Berikan output HANYA berupa list temuan baris kode dengan format persis seperti ini:
    - \`[kata kunci]\` di \`${fileName}\` (L[nomor baris])
    
    Jika kodenya murni aman, balas HANYA dengan kata "Aman".
    
    Kode:
    ${numberedCode}`;

    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            { model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptContext }], temperature: 0.1 },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
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
            if (!matches.includes(`• ${p.desc} (Level ${p.sev})`)) {
                matches.push(`• ${p.desc} (Level ${p.sev})`);
                rawScore += severityWeight[p.sev];
            }
        }
    });

    let percent = Math.min(100, rawScore);
    let status = "🟢 AMAN";
    let color = 0x00ff00;

    if (percent >= 80) { status = "🔴 BAHAYA BESAR"; color = 0xff0000; } 
    else if (percent >= 50) { status = "🟠 SANGAT MENCURIGAKAN"; color = 0xff8800; } 
    else if (percent >= 20) { status = "🟡 MENCURIGAKAN"; color = 0xffcc00; }

    if (matches.length === 0) matches.push("Tidak ditemukan pola mencurigakan");
    return { percent, status, color, detail: matches.join("\n") };
}

// =======================
// 📜 MENUS & PAYLOADS
// =======================

const payloads = {
    help: () => ({ /* Menu Help */ embeds: [new EmbedBuilder().setColor('#00d2ff').setTitle('🌟 Pusat Komando & Panduan Bot 🌟').setDescription('Selamat datang di sistem asisten otomatis!\nBerikut adalah direktori lengkap fitur yang tersedia. Kamu dapat menggunakan prefix `!` atau `/` (Slash Commands).\n').addFields({ name: '🎮 ROLEPLAY & UTILITIES', value: `**> \`!cs\` / \`/cs\`**\nMembuka panel interaktif pembuatan *Character Story* dengan bantuan AI.\n\n**> \`!panelspam\` / \`/panelspam\`**\nMembuka tools panel untuk melumpuhkan Webhook/Telegram target (Anti-Keylogger).` }, { name: '🤖 FITUR OTOMATIS (Pasif)', value: `**> 🛡️ Cek Keylogger Otomatis**\nKirim file script ke channel Scanner. Bot akan otomatis membedah file (.lua, .txt, .zip)!\n\n**> 🤖 AI Chat & Typo Fixer**\nMengobrol bebas dengan AI di channel khusus.` }, { name: '🔒 KHUSUS STAFF', value: `**> \`/upload\`**\nPanel rilis script.\n**> \`/status\`**\nCek ping server.` }).setFooter({ text: 'Tatang Community System' }).setTimestamp()] }),
    status: (client) => ({ /* Status Menu */ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('📊 Status Operasional').addFields({ name: '📡 Koneksi', value: `Ping: \`${client ? client.ws.ping : 0}ms\`` }).setFooter({ text: 'Tatang Community System' }).setTimestamp()] }),
    panelspam: () => ({ /* Panel Spam */ embeds: [new EmbedBuilder().setTitle('💣 Panel Spam Target Keylogger').setColor('#e74c3c').setDescription('1. Klik **Set Target**.\n2. Klik **Mulai Spam**.\n3. Klik **Stop Spam**.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('spam_set_webhook').setLabel('Set Webhook').setStyle(ButtonStyle.Secondary).setEmoji('🌐'), new ButtonBuilder().setCustomId('spam_set_tele').setLabel('Set Token Tele').setStyle(ButtonStyle.Secondary).setEmoji('✈️')), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('spam_start').setLabel('Mulai Spam').setStyle(ButtonStyle.Success).setEmoji('▶️'), new ButtonBuilder().setCustomId('spam_stop').setLabel('Stop Spam').setStyle(ButtonStyle.Danger).setEmoji('⏹️'))] }),
    cs: () => ({ /* Panel CS */ embeds: [new EmbedBuilder().setColor('#2b2d31').setTitle('📝 Panel Pembuatan Character Story').setDescription('Tekan tombol di bawah untuk memulai.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setEmoji('📝').setStyle(ButtonStyle.Primary))] })
};

// =======================
// 💻 BOT CORE LOGIC
// =======================

client.once('ready', async () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();

    // PREFIX
    if (content === "!help") return message.reply(payloads.help());
    if (content === "!panelspam") return message.channel.send(payloads.panelspam());
    if (content === "!cs") return message.channel.send(payloads.cs());

    // AI CHAT
    if (message.channel.id === aiChannelId) {
        if (content.startsWith("!ai")) {
            const userInput = message.content.slice(3).trim();
            if (!userInput) return message.reply("Mau nanya apa?");
            return message.reply(await generateAIResponse(userInput));
        }
        if (detectTypo(content)) return message.reply(await generateAIResponse("Tanggapi pesan ini yang banyak typo: " + message.content));
        if (Math.random() < 0.3) return message.reply(await generateAIResponse(message.content));
    }

    // SCANNER CHANNEL
    if (message.channel.id === scannerChannelId && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const fileName = attachment.name.toLowerCase();
        const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

        if (!isAllowed) {
            return message.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Format File Tidak Didukung").setColor(0xff0000).setDescription(`Hanya: ${allowedExtensions.join(", ")}`).setTimestamp()] });
        }

        try {
            const processingMsg = await message.reply("⏳ Sedang mengalisis file dan mengurai isi arsip, tunggu sebentar...");
            const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
            const buffer = Buffer.from(response.data);
            
            let contentFile = "";

            // LOGIKA PEMBACAAN FILE
            if (fileName.endsWith('.zip')) {
                try {
                    const zip = new AdmZip(buffer);
                    const zipEntries = zip.getEntries();
                    zipEntries.forEach(entry => {
                        if (!entry.isDirectory && (entry.entryName.endsWith('.lua') || entry.entryName.endsWith('.txt'))) {
                            contentFile += `\n-- [File: ${entry.entryName}] --\n`;
                            contentFile += entry.getData().toString("utf8");
                        }
                    });
                    if (!contentFile) throw new Error("Kosong");
                } catch (e) {
                    return processingMsg.edit("❌ Gagal mengekstrak `.zip`. Pastikan tidak dipassword dan berisi file `.lua`/`.txt`.");
                }
            } else if (fileName.endsWith('.rar') || fileName.endsWith('.7z')) {
                // Untuk rar/7z, Node.js tidak punya native module ringan. Beri notifikasi.
                return processingMsg.edit("⚠️ **Perhatian:** Ekstrak otomatis untuk `.rar` dan `.7z` dibatasi oleh sistem host. Tolong compress ulang file tersebut menjadi **.zip** atau kirim langsung file **.lua** nya.");
            } else {
                contentFile = buffer.toString("utf8");
            }
            
            // ANALISIS ISI
            const result = analyzeContent(contentFile);
            const webhookRegex = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s'"]+/gi;
            const teleRegex = /https?:\/\/api\.telegram\.org\/bot[^\s'"]+/gi;
            const extractedWebhooks = contentFile.match(webhookRegex) || [];
            const extractedTeles = contentFile.match(teleRegex) || [];
            const targetLinks = [...new Set([...extractedWebhooks, ...extractedTeles])];

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
                    { name: "🎭 Baris Berbahaya", value: aiLines }
                )
                .setFooter({ text: "Deteksi Anti-Keylogger by TATANG COMUNITY" })
                .setTimestamp();

            await processingMsg.edit({ content: "✅ Analisis selesai!", embeds: [embed] });

            // KIRIM TARGET SPAM JIKA ADA
            if (targetLinks.length > 0) {
                await message.channel.send({
                    content: `🚨 **TARGET DITEMUKAN!**\nSalin link di bawah ini dan gunakan di \`!panelspam\`:\n\n${targetLinks.map(link => `\`${link}\``).join('\n')}`
                });
            }

            // CLEANER: Jika ada indikasi bahaya berat (Level 3/4), kirim versi bersihnya
            if (result.percent >= 30) {
                const cleanedCode = cleanDangerousLines(contentFile);
                const safeExt = fileName.endsWith('.zip') ? '.lua' : ''; // Ubah nama jadi .lua kalau asalnya zip
                const newFileName = `CLEANED_${fileName.replace('.zip', '')}${safeExt}`;
                
                const cleanBuffer = Buffer.from(cleanedCode, 'utf-8');
                const cleanAttachment = new AttachmentBuilder(cleanBuffer, { name: newFileName });

                await message.channel.send({
                    content: `✨ **FILE DIBERSIHKAN!**\nSistem telah menghapus baris-baris kode berbahaya (Webhook, Eksekusi Command, Obfuscate). Berikut adalah versi file yang aman:`,
                    files: [cleanAttachment]
                });
            }

        } catch (error) {
            console.error("Scanner Error:", error);
            message.reply("❌ Gagal membaca atau menganalisis file.");
        }
    }
});

// =======================
// 🎛️ INTERACTION HANDLER (Buttons, Modals)
// =======================

client.on('interactionCreate', async (interaction) => {
    // (Abaikan kode panelspam & cs yang tidak berubah, biarkan tetap berjalan seperti sebelumnya)
    if (interaction.isButton()) {
        if (interaction.customId === 'spam_set_webhook') {
            const modal = new ModalBuilder().setCustomId('modal_set_webhook').setTitle('Set Target Webhook');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_url').setLabel('Link Webhook Discord').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('WEBHOOK INI TELAH DIHANCURKAN OLEH TATANG COMUNITY ANTI KEYLOGGER!')));
            return interaction.showModal(modal);
        }
        if (interaction.customId === 'spam_set_tele') {
            const modal = new ModalBuilder().setCustomId('modal_set_tele').setTitle('Set Target Telegram');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_token').setLabel('Bot Token Target').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_chatid').setLabel('Chat ID Target').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('BOT INI TELAH DIHANCURKAN OLEH TATANG COMUNITY ANTI KEYLOGGER!')));
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
                } catch (e) {}
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
        if (interaction.customId === 'start_cs') {
            const selectMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_server').setPlaceholder('Pilih server tujuan...').addOptions([{ label: 'SSRP', value: 'SSRP' }, { label: 'Virtual RP', value: 'Virtual RP' }, { label: 'AARP', value: 'AARP' }, { label: 'GCRP', value: 'GCRP' }, { label: 'TEN ROLEPLAY', value: 'TEN ROLEPLAY' }, { label: 'CPRP', value: 'CPRP' }, { label: 'Relative RP', value: 'Relative RP' }, { label: 'JGRP', value: 'JGRP' }, { label: 'FMRP', value: 'FMRP' }])
            );
            return interaction.reply({ content: 'Pilih server karaktermu:', components: [selectMenu], ephemeral: true });
        }
        if (interaction.customId === 'side_good' || interaction.customId === 'side_bad') {
            const side = interaction.customId === 'side_good' ? 'Good Side' : 'Bad Side';
            const session = csSessions.get(interaction.user.id) || { server: 'Unknown' };
            session.side = side;
            csSessions.set(interaction.user.id, session);
            const modal = new ModalBuilder().setCustomId('modal_step_1').setTitle(`Detail Karakter (${side}) (1/2)`);
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_nama').setLabel('Nama Lengkap (IC)').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_level').setLabel('Level Karakter').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_gender').setLabel('Jenis Kelamin').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_dob').setLabel('Tanggal Lahir').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_city').setLabel('Kota Asal').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
        }
        if (interaction.customId === 'to_step_2') {
            const session = csSessions.get(interaction.user.id);
            if (!session) return interaction.reply({ content: 'Sesi habis, ulangi perintah cs.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId('modal_step_2').setTitle(`Detail Cerita (${session.side}) (2/2)`);
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_bakat').setLabel('Bakat Dominan').setStyle(TextInputStyle.Paragraph).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_kultur').setLabel('Kultur/Etnis').setStyle(TextInputStyle.Short).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_ekstra').setLabel('Detail Tambahan').setStyle(TextInputStyle.Paragraph).setRequired(false)));
            return interaction.showModal(modal);
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
        csSessions.set(interaction.user.id, { server: interaction.values[0] });
        const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('side_good').setLabel('Goodside').setEmoji('😇').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('side_bad').setLabel('Badside').setEmoji('😈').setStyle(ButtonStyle.Danger));
        return interaction.reply({ content: 'Pilih alur cerita:', components: [buttons], ephemeral: true });
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_set_webhook') {
            spamConfigs.set(interaction.user.id, { type: 'webhook', url: interaction.fields.getTextInputValue('in_webhook_url'), msg: interaction.fields.getTextInputValue('in_webhook_msg') });
            return interaction.reply({ content: '✅ Target Webhook disetel!', ephemeral: true });
        }
        if (interaction.customId === 'modal_set_tele') {
            spamConfigs.set(interaction.user.id, { type: 'telegram', token: interaction.fields.getTextInputValue('in_tele_token'), chatId: interaction.fields.getTextInputValue('in_tele_chatid'), msg: interaction.fields.getTextInputValue('in_tele_msg') });
            return interaction.reply({ content: '✅ Target Telegram disetel!', ephemeral: true });
        }
        if (interaction.customId === 'modal_step_1') {
            const session = csSessions.get(interaction.user.id);
            if (!session) return;
            session.data = { nama: interaction.fields.getTextInputValue('in_nama'), level: interaction.fields.getTextInputValue('in_level'), gender: interaction.fields.getTextInputValue('in_gender'), dob: interaction.fields.getTextInputValue('in_dob'), city: interaction.fields.getTextInputValue('in_city') };
            const button = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('to_step_2').setLabel('Lanjutkan (2/2)').setEmoji('➡️').setStyle(ButtonStyle.Primary));
            return interaction.reply({ content: '✅ Lanjut isi detail cerita.', components: [button], ephemeral: true });
        }
        if (interaction.customId === 'modal_step_2') {
            await interaction.deferReply();
            const session = csSessions.get(interaction.user.id);
            const bakat = interaction.fields.getTextInputValue('in_bakat');
            const kultur = interaction.fields.getTextInputValue('in_kultur') || '-';
            const ekstra = interaction.fields.getTextInputValue('in_ekstra') || '-';

            try {
                const promptContext = `Tuliskan Character Story GTA Roleplay untuk karakter bernama ${session.data.nama} (Gender: ${session.data.gender}). Tanggal Lahir: ${session.data.dob}, Asal Kota: ${session.data.city}. Sisi Cerita: ${session.side}, Bakat: ${bakat}, Kultur: ${kultur}, Tambahan: ${ekstra}. Buat 3 paragraf bahasa Indonesia formal naratif. Langsung berikan ceritanya tanpa kata pengantar apapun.`;
                const chatCompletion = await groq.chat.completions.create({ messages: [{ role: 'user', content: promptContext }], model: 'llama-3.3-70b-versatile', temperature: 0.7 });
                const story = chatCompletion.choices[0].message.content;

                const finalEmbed = new EmbedBuilder().setColor(session.side === 'Good Side' ? '#2ecc71' : '#e74c3c').setTitle(`📄 Character Story: ${session.data.nama}`).setDescription(story.substring(0, 4000)).addFields({ name: '🌐 Server', value: session.server, inline: true }, { name: '🎭 Sisi Cerita', value: session.side, inline: true }, { name: '🏙️ Asal Kota', value: session.data.city, inline: true }).setFooter({ text: 'Created By TATANG COMUNITY' }); 
                
                await interaction.editReply({ content: `🎉 Yeay! Character Story berhasil dibuat untuk <@${interaction.user.id}>!`, embeds: [finalEmbed] });
                csSessions.delete(interaction.user.id);
            } catch (error) {
                await interaction.editReply({ content: '❌ Gagal membuat cerita.' });
            }
        }
    }
});

client.login(TOKEN);
