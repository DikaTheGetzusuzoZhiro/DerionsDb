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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

const groq = new Groq({ apiKey: GROQ_API_KEY });
const rest = new REST({ version: '10' }).setToken(TOKEN);

// =======================
// 🔒 CONFIGURATION
// =======================

const scannerChannelId = "1492337144021385336";
const aiChannelId = "1475164217115021475";
const welcomeChannelId = "1464775422913941568";
const staffRoleId = "1466470849266848009";
const autoRoleId = "1464778755372486717"; // Role yang akan diberikan otomatis saat member join

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];

const WELCOME_BG_URL = "https://cdn.discordapp.com/attachments/1464776243324125399/1494239246599323719/icegif-421.gif?ex=69e1e23e&is=69e090be&hm=ae3ff62b75ebc0f487dae5c47f50f238085ffb233e6613131e1418e419dbeda8&";

const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50, 5: 100 };
const detectionPatterns = [
    { regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, desc: "Link Discord Webhook", sev: 5 },
    { regex: /api\.telegram\.org\/bot/i, desc: "Link API Telegram Bot", sev: 5 },
    { regex: /\b(password|username|webhook|telegram)\b/i, desc: "Kata Kunci Pencurian Data", sev: 5 },
    { regex: /\bsampGetPlayer(?:Nickname|Name)\b/i, desc: "Fungsi Pencurian Nama Player", sev: 5 },
    { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "Eksekusi Command OS", sev: 4 },
    { regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, desc: "Eksekusi Kode Dinamis", sev: 4 },
    { regex: /moonsec|protected with moonsec/i, desc: "MoonSec protection (Obfuscator)", sev: 3 },
    { regex: /luaobfuscator|obfuscate|anti[-_ ]debug/i, desc: "Obfuscation / Anti-Debug", sev: 3 },
    { regex: /require\s*\(\s*['"]socket['"]\s*\)/i, desc: "Koneksi Jaringan Socket", sev: 3 },
    { regex: /(?:[A-Za-z0-9+\/]{100,}={0,2})/, desc: "Base64 Encoded Blob", sev: 3 },
    { regex: /loadstring/i, desc: "Loadstring Keyword", sev: 1 }
];

const csSessions = new Map();
const spamConfigs = new Map();
const activeSpams = new Map();
const welcomeConfigs = new Map();
const userWarnings = new Map(); // Untuk anti link Discord

// =======================
// 🛡️ ANTI LINK DISCORD (OTOMATIS)
// =======================
const discordLinkRegex = /https?:\/\/(?:www\.)?(?:discord(?:app)?\.com|discord\.gg)\/[^\s]+/gi;

async function handleDiscordLinkViolation(message) {
    if (message.author.bot) return false;
    const member = message.member;
    if (member && member.roles.cache.has(staffRoleId)) return false;

    const userId = message.author.id;
    const now = Date.now();

    let userData = userWarnings.get(userId);
    if (!userData) {
        userData = { count: 0, lastWarningTime: now };
    }

    try {
        await message.delete();
    } catch (err) {
        console.error("Gagal hapus pesan link Discord:", err);
    }

    const warningEmbed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("⚠️ Peringatan! Dilarang Share Link Discord")
        .setDescription(`${message.author}, kamu tidak diperbolehkan mengirim link Discord di server ini.`)
        .addFields({ name: "Pelanggaran ke", value: `${userData.count + 1}`, inline: true })
        .setFooter({ text: "Jika mencapai 2x, akan di-timeout 30 menit" })
        .setTimestamp();
    await message.channel.send({ embeds: [warningEmbed] }).then(msg => {
        setTimeout(() => msg.delete().catch(() => {}), 5000);
    });

    userData.count++;
    userData.lastWarningTime = now;
    userWarnings.set(userId, userData);

    if (userData.count >= 2) {
        try {
            await member.timeout(30 * 60 * 1000, "Mengirim link Discord sebanyak 2 kali");
            const timeoutEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle("🔇 Timeout Diterapkan")
                .setDescription(`${message.author} telah di-timeout selama 30 menit karena mengirim link Discord sebanyak 2 kali.`)
                .setTimestamp();
            await message.channel.send({ embeds: [timeoutEmbed] }).then(msg => {
                setTimeout(() => msg.delete().catch(() => {}), 10000);
            });
            userWarnings.delete(userId);
        } catch (err) {
            console.error("Gagal melakukan timeout:", err);
        }
    }
    return true;
}

// =======================
// 🛠️ HELPER FUNCTIONS
// =======================

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
3. Sesuaikan sikapmu: Jika sopan balas ramah, jika toxic balas nyolot dan sarkas.
4. Info Konteks Real-time: Saat ini adalah hari Sabtu, 11 April 2026, pukul 09:39 WIB. Posisi server di Banjarnegara, Jawa Tengah, Indonesia. Gunakan informasi ini jika pengguna bertanya soal waktu atau lokasi tanpa perlu mengarahkan mereka untuk menggunakan command tertentu.`
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
    const extractedData = []; 
    let rawScore = 0;

    const webhookRegex = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/gi;
    const teleRegex = /([0-9]{8,10}:[a-zA-Z0-9_-]{35})/gi; 

    const foundWebhooks = text.match(webhookRegex);
    if (foundWebhooks) extractedData.push(...foundWebhooks);

    const foundTeleTokens = text.match(teleRegex);
    if (foundTeleTokens) {
        foundTeleTokens.forEach(token => extractedData.push(`Telegram Token: ${token}`));
    }

    detectionPatterns.forEach(p => {
        if (p.regex.test(text)) {
            matches.push(`• ${p.desc} (level ${p.sev})`);
            rawScore += severityWeight[p.sev];
        }
    });

    let percent = Math.min(100, rawScore);
    let status = "🟢 Aman";
    let color = 0x00ff00;

    if (percent >= 80) { status = "🔴 BAHAYA TINGGI"; color = 0xff0000; } 
    else if (percent >= 50) { status = "🟠 SANGAT MENCURIGAKAN"; color = 0xff8800; } 
    else if (percent >= 20) { status = "🟡 MENCURIGAKAN"; color = 0xffcc00; }

    if (matches.length === 0) matches.push("Tidak ditemukan pola mencurigakan");
    return { percent, status, color, detail: matches.join("\n"), extractedData };
}

const payloads = {
    help: () => ({
        embeds: [new EmbedBuilder()
            .setColor('#00d2ff')
            .setTitle('🌟 Pusat Komando & Panduan Bot 🌟')
            .setDescription('Selamat datang di sistem asisten otomatis!\nBerikut adalah direktori lengkap fitur yang tersedia.')
            .addFields(
                { name: '🎮 Roleplay & Utilitas', value: '`!cs` atau `/cs` - Buat Character Story.\n`!panelspam` atau `/panelspam` - Panel spam target keylogger.', inline: false },
                { name: '🤖 Fitur Otomatis', value: '📁 **Cek Keylogger** - Kirim file ke channel scanner.\n💬 **AI Chat** - Kirim pesan di channel AI, otomatis dijawab.', inline: false },
                { name: '🔒 Khusus Staff', value: '`/upload` - Rilis script.\n`/ban`, `/kick`, `/timeout`, `/clear`, `/clearall` - Moderasi server.\n`/status` - Cek ping & sistem.\n`/welcome` - Nyalakan/matikan welcome.', inline: false }
            )
            .setFooter({ text: 'Tatang Community System', iconURL: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' })
            .setTimestamp()]
    }),
    status: (client) => ({
        embeds: [new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('📊 Metrik & Status Operasional Server')
            .addFields(
                { name: '📡 Ping:', value: `\`${client ? client.ws.ping : 0}ms\` 🟢`, inline: true },
                { name: '🤖 Core:', value: '`🟢 Online`', inline: true },
                { name: '🧠 AI Engine:', value: '`🟢 Aktif`', inline: true }
            )
            .setFooter({ text: 'Tatang Community System' })
            .setTimestamp()]
    }),
    panelspam: () => ({
        embeds: [new EmbedBuilder()
            .setTitle('💣 Panel Spam Target Keylogger')
            .setColor('#e74c3c')
            .setDescription('**Panel Spam Webhook & Telegram**\nFitur untuk membanjiri target pembuat keylogger.')
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
    })
};

// =======================
// 📜 SLASH COMMANDS REGISTRATION
// =======================

const commands = [
    new SlashCommandBuilder().setName('help').setDescription('Tampilkan menu bantuan bot'),
    new SlashCommandBuilder().setName('panelspam').setDescription('Tampilkan panel spam target keylogger'),
    new SlashCommandBuilder().setName('cs').setDescription('Buka panel pembuatan Character Story (CS)'),
    new SlashCommandBuilder().setName('status').setDescription('Cek status bot'),
    new SlashCommandBuilder()
        .setName('ques')
        .setDescription('Tanya sesuatu ke AI Groq secara langsung')
        .addStringOption(opt => opt.setName('pertanyaan').setDescription('Masukkan pertanyaan kamu').setRequired(true)),
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Nyalakan atau matikan pesan welcome otomatis')
        .addStringOption(opt => opt.setName('status').setDescription('Pilih On atau Off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban member (Khusus Staff)')
        .addUserOption(opt => opt.setName('target').setDescription('Member yang di-ban').setRequired(true))
        .addStringOption(opt => opt.setName('alasan').setDescription('Alasan ban').setRequired(true)),
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick member (Khusus Staff)')
        .addUserOption(opt => opt.setName('target').setDescription('Member yang di-kick').setRequired(true))
        .addStringOption(opt => opt.setName('alasan').setDescription('Alasan kick').setRequired(true)),
    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout member (Khusus Staff)')
        .addUserOption(opt => opt.setName('target').setDescription('Member yang di-timeout').setRequired(true))
        .addIntegerOption(opt => opt.setName('durasi').setDescription('Durasi dalam menit').setRequired(true))
        .addStringOption(opt => opt.setName('alasan').setDescription('Alasan timeout').setRequired(true)),
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Hapus sejumlah pesan (Khusus Staff)')
        .addIntegerOption(opt => opt.setName('jumlah').setDescription('Jumlah pesan yang dihapus (1-100)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('clearall')
        .setDescription('Hapus pesan hingga 100 sekaligus (Khusus Staff)'),
    new SlashCommandBuilder()
        .setName('upload')
        .setDescription('Upload script/mod ke channel (Khusus Staff)')
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
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash Commands berhasil diregister!');
    } catch (err) {
        console.error('❌ Gagal register Slash Command:', err);
    }
});

// =======================
// 👋 EVENT: MEMBER JOIN (WELCOME + AUTO ROLE)
// =======================

client.on('guildMemberAdd', async (member) => {
    // 1. Berikan role otomatis
    try {
        const role = member.guild.roles.cache.get(autoRoleId);
        if (role) {
            await member.roles.add(role);
            console.log(`✅ Auto-role diberikan kepada ${member.user.tag} (${role.name})`);
        } else {
            console.warn(`⚠️ Role dengan ID ${autoRoleId} tidak ditemukan di server ${member.guild.name}`);
        }
    } catch (err) {
        console.error(`❌ Gagal memberikan auto-role ke ${member.user.tag}:`, err);
    }

    // 2. Kirim pesan welcome (jika diaktifkan)
    const config = welcomeConfigs.get(member.guild.id);
    if (config && config.enabled === false) return;

    const channel = member.guild.channels.cache.get(welcomeChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#00d2ff')
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription(`Halo ${member}, selamat bergabung dengan komunitas kami!\n\nJangan lupa baca peraturan dan nikmati waktumu di sini.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setImage(WELCOME_BG_URL)
        .setFooter({ text: `Member #${member.guild.memberCount}` })
        .setTimestamp();

    await channel.send({ content: `Hai ${member}!`, embeds: [embed] });
});

// =======================
// 💬 MESSAGE LISTENER
// =======================

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // ANTI LINK DISCORD OTOMATIS
    if (discordLinkRegex.test(message.content)) {
        await handleDiscordLinkViolation(message);
        return;
    }

    const content = message.content.toLowerCase();

    if (content === "!help") return message.reply(payloads.help());
    if (content === "!panelspam") return message.channel.send(payloads.panelspam());
    if (content === "!cs") return message.channel.send(payloads.cs());

    // AI CHANNEL - BALAS SEMUA PESAN TANPA PERINTAH !ai
    if (message.channel.id === aiChannelId) {
        const aiResponse = await generateAIResponse(message.content);
        return message.reply(aiResponse);
    }

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
                    { name: "📦 Ukuran", value: `${(attachment.size / 1024).toFixed(2)} KB` },
                    { name: "📊 Status", value: result.status },
                    { name: "⚠️ Risiko", value: `${result.percent}%` },
                    { name: "🔎 Detail", value: result.detail }
                )
                .setFooter({ text: "Deteksi by TATANG COMUNITY" })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            if (result.extractedData && result.extractedData.length > 0) {
                const uniqueLinks = [...new Set(result.extractedData)].join("\n");
                await message.channel.send(`🚨 **PERINGATAN! TARGET BERBAHAYA!** 🚨\n\`\`\`txt\n${uniqueLinks}\n\`\`\`\n*Segera gunakan \`/panelspam\`!*`);
            }
        } catch (error) {
            console.error("Scanner Error:", error);
            message.reply("❌ Gagal membaca file.");
        }
    }
});

// =======================
// 🎛️ INTERACTION HANDLER
// =======================

client.on('interactionCreate', async (interaction) => {

    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        const isStaff = interaction.member.roles.cache.has(staffRoleId);

        if (commandName === 'help') return interaction.reply(payloads.help());
        if (commandName === 'panelspam') return interaction.reply(payloads.panelspam());
        if (commandName === 'cs') return interaction.reply(payloads.cs());
        if (commandName === 'status') return interaction.reply(payloads.status(client));

        if (commandName === 'ques') {
            await interaction.deferReply();
            const question = interaction.options.getString('pertanyaan');
            const answer = await generateAIResponse(question);
            return interaction.editReply(`**Tanya:** ${question}\n**AI:** ${answer}`);
        }

        // MODERATION COMMANDS (khusus staff)
        if (['welcome', 'ban', 'kick', 'timeout', 'clear', 'clearall', 'upload'].includes(commandName) && !isStaff) {
            return interaction.reply({ content: '❌ Akses Ditolak! Kamu tidak memiliki role khusus (Staff).', ephemeral: true });
        }

        if (commandName === 'welcome') {
            const status = interaction.options.getString('status');
            const isEnabled = status === 'on';
            welcomeConfigs.set(interaction.guild.id, { enabled: isEnabled });
            return interaction.reply({ content: `✅ Fitur Welcome otomatis telah di-${status.toUpperCase()}.`, ephemeral: true });
        }

        if (commandName === 'ban') {
            const target = interaction.options.getMember('target');
            const reason = interaction.options.getString('alasan');
            if (!target) return interaction.reply({ content: "User tidak ditemukan.", ephemeral: true });
            await target.ban({ reason });
            return interaction.reply(`🔨 **${target.user.tag}** telah dibanned.\nAlasan: *${reason}*`);
        }

        if (commandName === 'kick') {
            const target = interaction.options.getMember('target');
            const reason = interaction.options.getString('alasan');
            if (!target) return interaction.reply({ content: "User tidak ditemukan.", ephemeral: true });
            await target.kick(reason);
            return interaction.reply(`👢 **${target.user.tag}** telah dikick.\nAlasan: *${reason}*`);
        }

        if (commandName === 'timeout') {
            const target = interaction.options.getMember('target');
            const durasi = interaction.options.getInteger('durasi');
            const reason = interaction.options.getString('alasan');
            if (!target) return interaction.reply({ content: "User tidak ditemukan.", ephemeral: true });
            await target.timeout(durasi * 60 * 1000, reason);
            return interaction.reply(`⏱️ **${target.user.tag}** kena timeout selama ${durasi} menit.\nAlasan: *${reason}*`);
        }

        if (commandName === 'clear') {
            const jumlah = interaction.options.getInteger('jumlah');
            if (jumlah < 1 || jumlah > 100) return interaction.reply({ content: "Jumlah pesan harus antara 1-100.", ephemeral: true });
            await interaction.channel.bulkDelete(jumlah, true);
            return interaction.reply({ content: `🧹 Berhasil menghapus ${jumlah} pesan!`, ephemeral: true });
        }

        if (commandName === 'clearall') {
            await interaction.channel.bulkDelete(100, true);
            return interaction.reply({ content: `🧹 Berhasil menghapus 100 pesan sekaligus (Batas maksimal Discord API)!`, ephemeral: true });
        }

        if (commandName === 'upload') {
            try {
                const channel = interaction.options.getChannel('channel');
                const embed = new EmbedBuilder()
                    .setColor('#ffffff')
                    .setTitle(`**${interaction.options.getString('judul')}**`)
                    .addFields(
                        { name: 'Command', value: `\`${interaction.options.getString('cmd')}\`` },
                        { name: 'Deskripsi', value: interaction.options.getString('deskripsi') },
                        { name: 'Credit', value: interaction.options.getString('credit') },
                        { name: 'Download', value: `[klik untuk download](${interaction.options.getString('download')})` }
                    )
                    .setFooter({ text: `@tatang comunity | ${new Date().toLocaleDateString('id-ID')}` });

                const img = interaction.options.getAttachment('gambar');
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
            if (!config) return interaction.reply({ content: '⚠️ Belum mengatur target!', ephemeral: true });
            if (activeSpams.has(interaction.user.id)) return interaction.reply({ content: '⚠️ Spam sudah berjalan!', ephemeral: true });

            await interaction.reply({ content: '🔥 Spam dimulai! (1 detik interval).', ephemeral: true });
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

        const modal = new ModalBuilder().setCustomId('modal_step_1').setTitle(`Detail Karakter (1/2)`);
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
        if (!session) return interaction.reply({ content: 'Sesi habis.', ephemeral: true });

        session.data = {
            nama: interaction.fields.getTextInputValue('in_nama'),
            level: interaction.fields.getTextInputValue('in_level'),
            gender: interaction.fields.getTextInputValue('in_gender'),
            dob: interaction.fields.getTextInputValue('in_dob'),
            city: interaction.fields.getTextInputValue('in_city')
        };

        const button = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('to_step_2').setLabel('Lanjutkan').setStyle(ButtonStyle.Primary));
        return interaction.reply({ content: '✅ Detail dasar disimpan.', components: [button], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'to_step_2') {
        const session = csSessions.get(interaction.user.id);
        if (!session) return interaction.reply({ content: 'Sesi habis.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('modal_step_2').setTitle(`Detail Cerita (2/2)`);
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
        
        try {
            const promptContext = `Tuliskan Character Story GTA Roleplay untuk karakter bernama ${session.data.nama} (Gender: ${session.data.gender}). Lahir: ${session.data.dob}, Kota: ${session.data.city}. Sisi Cerita: ${session.side}, Bakat: ${interaction.fields.getTextInputValue('in_bakat')}. Buat 3 paragraf bahasa Indonesia formal naratif.`;

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

            // TAG USER YANG BERHASIL MEMBUAT CS
            await interaction.editReply({ content: `🎉 <@${interaction.user.id}> Yeay! Character Story berhasil dibuat!`, embeds: [finalEmbed] });
            csSessions.delete(interaction.user.id);
        } catch (error) {
            await interaction.editReply({ content: '❌ Gagal membuat cerita karena server AI sibuk.' });
        }
    }
});

client.login(TOKEN);
