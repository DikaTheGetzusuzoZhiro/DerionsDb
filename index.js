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
        status = "🔴 BAHAYA TINGGI"; color = 0xff0000;
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
            .setColor('#3498db')
            .setTitle('📚 Pusat Bantuan & Panduan Bot')
            .setDescription('Daftar lengkap semua perintah yang tersedia (bisa pakai `!` atau `/`):')
            .addFields(
                { name: '🛠️ COMMANDS UTAMA', value: `**\`help\`** - Menu ini\n**\`cs\`** - Panel pembuatan Character Story\n**\`panelspam\`** - Panel penghancur Webhook/Tele\n**\`/status\`** - Cek status operator (Hanya Slash Cmd)\n**\`/upload\`** - Upload script (Hanya Slash Cmd)` },
                { name: '🤖 FITUR OTOMATIS', value: `**🛡️ Lua Scanner** (Di Channel Scanner)\n**🤖 AI Chat** (Di Channel AI, atau gunakan \`!ai [pesan]\`)` }
            )
            .setFooter({ text: 'ASISTEN | TATANG COMUNITY' })
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
            .setDescription('Tekan tombol di bawah untuk memulai proses pembuatan **Character Story (CS)**.')
            .setFooter({ text: 'Created By TATANG COMUNITY' })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setEmoji('📝').setStyle(ButtonStyle.Primary)
            )
        ]
    }),
    status: () => ({ content: '✅ Semua operator online!' })
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
        .setDescription('Upload script/mod ke channel (Eksklusif Slash Command)')
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

    // PREFIX COMMANDS (!) - Tidak memasukkan !status dan !upload
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
            return message.reply({ embeds: [new EmbedBuilder().setTitle("⚠️ Format File Tidak Didukung").setColor(0xff0000).setDescription("Hanya: .lua, .txt, .zip, .7z").setTimestamp()] });
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
// 🎛️ INTERACTION HANDLER (Slash Cmds, Buttons, Modals)
// =======================

client.on('interactionCreate', async (interaction) => {

    // --- SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'help') return interaction.reply(payloads.help());
        if (commandName === 'panelspam') return interaction.reply(payloads.panelspam());
        if (commandName === 'cs') return interaction.reply(payloads.cs());
        if (commandName === 'status') return interaction.reply(payloads.status());

        if (commandName === 'upload') {
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
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_nama').setLabel('Nama Lengkap (IC)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_level').setLabel('Level Karakter').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_gender').setLabel('Jenis Kelamin').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_dob').setLabel('Tanggal Lahir').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_city').setLabel('Kota Asal').setStyle(TextInputStyle.Short).setRequired(true))
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
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_bakat').setLabel('Bakat Dominan').setStyle(TextInputStyle.Paragraph).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_kultur').setLabel('Kultur/Etnis').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_ekstra').setLabel('Detail Tambahan').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_step_2') {
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
                    { name: '📈 Level', value: session.data.level, inline: true }
                )
                .setFooter({ text: 'Created By TATANG COMUNITY' }); 

            await interaction.editReply({ embeds: [finalEmbed] });
            csSessions.delete(interaction.user.id);
        } catch (error) {
            console.error('Groq AI Error:', error);
            await interaction.editReply({ content: '❌ Gagal membuat cerita karena server AI sedang sibuk.' });
        }
    }
});

// LOGIN
client.login(TOKEN);
