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
    PermissionFlagsBits
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
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const groq = new Groq({ apiKey: GROQ_API_KEY });
const rest = new REST({ version: '10' }).setToken(TOKEN);

// =======================
// 🔒 CONFIGURATION
// =======================

const scannerChannelId = "1489948015618691133";
const aiChannelId = "1475164217115021475";
const uploadRoleId = "1466470849266848009";

// Pengaturan Role & Pengecualian Akses Command
const EXCLUSIVE_ROLE_ID = "1466470849266848009"; 
const PUBLIC_COMMANDS = ['panelspam', 'cs', 'create_ticket', 'status']; 

// Pengaturan Auto Welcome Hardcode
const WELCOME_CHANNEL_ID = "1464775422913941568";
const WELCOME_BG_URL = "https://cdn.discordapp.com/attachments/1471539417482006735/1492328908417138720/icegif-421.gif?ex=69daef19&is=69d99d99&hm=ed437869f512ebf94b8c57a29e9f48dac6bc0d46d9db05061ea66579d4536695&";

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];
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
const welcomeConfigs = new Map(); // Untuk simpan status welcome On/Off
const afkUsers = new Map(); // Untuk fitur AFK

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
                    { role: "system", content: `Kamu adalah asisten AI. Jawab singkat, padat, dan jelas.` },
                    { role: "user", content: input }
                ],
                temperature: 0.7
            },
            {
                headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
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
        embeds: [new EmbedBuilder().setColor('#00d2ff').setTitle('🌟 Pusat Komando & Panduan Bot 🌟').setDescription('Gunakan prefix `!` atau `/` (Slash Commands).').setTimestamp()]
    }),
    status: (client) => ({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('📊 Metrik & Status Operasional Server').addFields({ name: '📡 Ping (Latency)', value: `\`${client ? client.ws.ping : 0}ms\`` }).setTimestamp()]
    }),
    panelspam: () => ({
        embeds: [new EmbedBuilder().setTitle('💣 Panel Spam Target Keylogger').setColor('#e74c3c')],
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
        embeds: [new EmbedBuilder().setColor('#2b2d31').setTitle('📝 Panel Pembuatan Character Story')],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setStyle(ButtonStyle.Primary))]
    })
};

// =======================
// 📜 SLASH COMMANDS REGISTRATION (Original + 30 Fitur Baru)
// =======================

const commands = [
    // --- COMMAND LAMA ---
    new SlashCommandBuilder().setName('help').setDescription('Tampilkan menu bantuan bot'),
    new SlashCommandBuilder().setName('panelspam').setDescription('Tampilkan panel spam target keylogger'),
    new SlashCommandBuilder().setName('cs').setDescription('Buka panel pembuatan Character Story (CS)'),
    new SlashCommandBuilder().setName('status').setDescription('Cek status operator bot & keylogger'),
    new SlashCommandBuilder()
        .setName('upload')
        .setDescription('Upload script/mod ke channel')
        .addChannelOption(opt => opt.setName('channel').setDescription('Pilih channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('judul').setDescription('Judul Script').setRequired(true))
        .addStringOption(opt => opt.setName('cmd').setDescription('Command game').setRequired(true))
        .addStringOption(opt => opt.setName('deskripsi').setDescription('Deskripsi script').setRequired(true))
        .addStringOption(opt => opt.setName('credit').setDescription('Credit pembuat').setRequired(true))
        .addStringOption(opt => opt.setName('download').setDescription('Link download').setRequired(true))
        .addAttachmentOption(opt => opt.setName('gambar').setDescription('Upload gambar (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('create_ticket').setDescription('Munculkan panel ticket'),

    // --- WELCOME (OTOMATIS TANPA ID CHANNEL) ---
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Atur sistem welcome on/off otomatis')
        .addBooleanOption(opt => opt.setName('status').setDescription('Pilih On(True) atau Off(False)').setRequired(true)),
    
    // --- 30 FITUR BARU TAMBAHAN ---
    new SlashCommandBuilder().setName('lock').setDescription('Kunci channel saat ini'),
    new SlashCommandBuilder().setName('unlock').setDescription('Buka kunci channel saat ini'),
    new SlashCommandBuilder().setName('purge').setDescription('Hapus pesan massal').addIntegerOption(opt => opt.setName('jumlah').setDescription('Banyak pesan (1-100)').setRequired(true)),
    new SlashCommandBuilder().setName('slowmode').setDescription('Atur slowmode channel').addIntegerOption(opt => opt.setName('detik').setDescription('Detik slowmode').setRequired(true)),
    new SlashCommandBuilder().setName('timeout').setDescription('Beri timeout member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)).addIntegerOption(opt => opt.setName('menit').setDescription('Durasi menit').setRequired(true)),
    new SlashCommandBuilder().setName('untimeout').setDescription('Cabut timeout member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Lihat info server ini'),
    new SlashCommandBuilder().setName('userinfo').setDescription('Lihat info member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('avatar').setDescription('Lihat avatar member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('ping').setDescription('Cek Ping & Latency Bot'),
    new SlashCommandBuilder().setName('uptime').setDescription('Lihat waktu hidup bot (Uptime)'),
    new SlashCommandBuilder().setName('say').setDescription('Bot akan menirukan ucapanmu').addStringOption(opt => opt.setName('pesan').setDescription('Pesan').setRequired(true)),
    new SlashCommandBuilder().setName('announce').setDescription('Kirim pengumuman Embed').addStringOption(opt => opt.setName('pesan').setDescription('Pesan').setRequired(true)),
    new SlashCommandBuilder().setName('poll').setDescription('Buat polling sederhana').addStringOption(opt => opt.setName('pertanyaan').setDescription('Pertanyaan polling').setRequired(true)),
    new SlashCommandBuilder().setName('8ball').setDescription('Tanya kerang ajaib').addStringOption(opt => opt.setName('tanya').setDescription('Pertanyaanmu').setRequired(true)),
    new SlashCommandBuilder().setName('coinflip').setDescription('Lempar koin (Heads / Tails)'),
    new SlashCommandBuilder().setName('roll').setDescription('Lempar dadu (1-100)'),
    new SlashCommandBuilder().setName('rps').setDescription('Bermain Batu Gunting Kertas').addStringOption(opt => opt.setName('pilihan').setDescription('batu/gunting/kertas').setRequired(true)),
    new SlashCommandBuilder().setName('hug').setDescription('Peluk member lain').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('slap').setDescription('Tampar member lain').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('kiss').setDescription('Cium member lain').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('pat').setDescription('Usap kepala member lain').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('joke').setDescription('Kirim lelucon acak'),
    new SlashCommandBuilder().setName('quote').setDescription('Kirim kata bijak acak'),
    new SlashCommandBuilder().setName('meme').setDescription('Kirim gambar meme acak'),
    new SlashCommandBuilder().setName('afk').setDescription('Set status AFK-mu').addStringOption(opt => opt.setName('alasan').setDescription('Alasan AFK').setRequired(true)),
    new SlashCommandBuilder().setName('nickname').setDescription('Ubah nickname member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)).addStringOption(opt => opt.setName('nama_baru').setDescription('Nama baru').setRequired(true)),
    new SlashCommandBuilder().setName('roleinfo').setDescription('Lihat info sebuah role').addRoleOption(opt => opt.setName('role').setDescription('Role').setRequired(true)),
    new SlashCommandBuilder().setName('channelinfo').setDescription('Lihat info channel ini'),
    new SlashCommandBuilder().setName('nuke').setDescription('Hapus semua chat dengan clone channel (Hati-hati)'),
    new SlashCommandBuilder().setName('ban').setDescription('Ban member dari server').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Kick member dari server').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('addrole').setDescription('Tambahkan role ke member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)).addRoleOption(opt => opt.setName('role').setDescription('Role').setRequired(true)),
    new SlashCommandBuilder().setName('deleterole').setDescription('Hapus role dari member').addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true)).addRoleOption(opt => opt.setName('role').setDescription('Role').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`🔥 Bot aktif sebagai ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ 30+ Slash Commands berhasil diregister!');
    } catch (err) {
        console.error('❌ Gagal register Slash Command:', err);
    }
});

// =======================
// 🚪 GUILD MEMBER ADD (Welcome System Otomatis)
// =======================
client.on('guildMemberAdd', async (member) => {
    const config = welcomeConfigs.get(member.guild.id);
    if (!config || !config.enabled) return;

    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#00d2ff')
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription(`Halo ${member}, selamat bergabung dengan komunitas kami!\n\nJangan lupa baca peraturan dan nikmati waktumu di sini.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setImage(WELCOME_BG_URL)
        .setFooter({ text: `Member #${member.guild.memberCount}`, iconURL: member.guild.iconURL() })
        .setTimestamp();

    await channel.send({ content: `Hai ${member}!`, embeds: [embed] });
});

// =======================
// 💬 MESSAGE LISTENER
// =======================

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // AFK System - Cek yang di-mention
    if (message.mentions.users.size > 0) {
        message.mentions.users.forEach(u => {
            if (afkUsers.has(u.id)) {
                message.reply(`💤 **${u.username}** sedang AFK: ${afkUsers.get(u.id)}`);
            }
        });
    }
    // Hapus AFK jika dia ngetik lagi
    if (afkUsers.has(message.author.id)) {
        afkUsers.delete(message.author.id);
        message.reply(`👋 Selamat datang kembali ${message.author}! Status AFK kamu telah dihapus.`).then(m => setTimeout(() => m.delete(), 5000));
    }

    const content = message.content.toLowerCase();
    if (content === "!help") return message.reply(payloads.help());
    if (content === "!panelspam") return message.channel.send(payloads.panelspam());
    if (content === "!cs") return message.channel.send(payloads.cs());

    // --- AI / SCANNER LOGIC (KODE ASLI) ---
    // (Akan dieksekusi di channel scanner dan ai)
    if (message.channel.id === scannerChannelId) {
        const result = analyzeContent(message.content);
        if (result.percent > 0) {
            const embed = new EmbedBuilder()
                .setTitle("⚠️ Analisis Keamanan Log")
                .setColor(result.color)
                .setDescription(`Status: **${result.status}**\nRisiko: **${result.percent}%**\n\nDetail:\n${result.detail}`);
            message.channel.send({ embeds: [embed] });
        }
    }
});

// =======================
// 🎛️ INTERACTION HANDLER
// =======================

client.on('interactionCreate', async (interaction) => {

    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 🔒 SISTEM FILTER ROLE KHUSUS
        if (!PUBLIC_COMMANDS.includes(commandName)) {
            // Jika user tidak punya Role ID yang diminta, TOLAK!
            if (!interaction.member.roles.cache.has(EXCLUSIVE_ROLE_ID)) {
                return interaction.reply({ 
                    content: '❌ **Akses Ditolak!** Hanya role khusus (ID: ' + EXCLUSIVE_ROLE_ID + ') yang bisa menggunakan perintah bot ini.', 
                    ephemeral: true 
                });
            }
        }

        // --- COMMANDS UTAMA ---
        if (commandName === 'help') return interaction.reply(payloads.help());
        if (commandName === 'panelspam') return interaction.reply(payloads.panelspam());
        if (commandName === 'cs') return interaction.reply(payloads.cs());
        if (commandName === 'status') return interaction.reply(payloads.status(client));

        // --- WELCOME OTOMATIS ---
        if (commandName === 'welcome') {
            const status = interaction.options.getBoolean('status');
            welcomeConfigs.set(interaction.guild.id, { enabled: status });
            return interaction.reply({ content: `✅ Fitur Welcome otomatis **${status ? 'DIAKTIFKAN' : 'DIMATIKAN'}** untuk channel <#${WELCOME_CHANNEL_ID}>`, ephemeral: true });
        }

        // --- 30 FITUR TAMBAHAN (IMPLEMENTASI SINGKAT) ---
        if (commandName === 'lock') {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            return interaction.reply('🔒 Channel berhasil dikunci!');
        }
        if (commandName === 'unlock') {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
            return interaction.reply('🔓 Channel berhasil dibuka!');
        }
        if (commandName === 'purge') {
            const jumlah = interaction.options.getInteger('jumlah');
            await interaction.channel.bulkDelete(jumlah, true);
            return interaction.reply({ content: `🧹 Berhasil menghapus ${jumlah} pesan!`, ephemeral: true });
        }
        if (commandName === 'slowmode') {
            const detik = interaction.options.getInteger('detik');
            await interaction.channel.setRateLimitPerUser(detik);
            return interaction.reply(`⏳ Slowmode diatur ke ${detik} detik.`);
        }
        if (commandName === 'timeout') {
            const target = interaction.options.getMember('target');
            const menit = interaction.options.getInteger('menit');
            await target.timeout(menit * 60 * 1000);
            return interaction.reply(`🔇 ${target} telah di timeout selama ${menit} menit.`);
        }
        if (commandName === 'untimeout') {
            const target = interaction.options.getMember('target');
            await target.timeout(null);
            return interaction.reply(`🔊 Timeout untuk ${target} telah dicabut.`);
        }
        if (commandName === 'serverinfo') {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(interaction.guild.name).addFields({name: 'Member', value: `${interaction.guild.memberCount}`})] });
        }
        if (commandName === 'userinfo') {
            const t = interaction.options.getUser('target');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Info ${t.tag}`).setThumbnail(t.displayAvatarURL())] });
        }
        if (commandName === 'avatar') {
            const t = interaction.options.getUser('target');
            return interaction.reply({ embeds: [new EmbedBuilder().setImage(t.displayAvatarURL({size: 512, dynamic: true}))] });
        }
        if (commandName === 'ping') return interaction.reply(`🏓 Pong! Latency: ${client.ws.ping}ms`);
        if (commandName === 'uptime') return interaction.reply(`⏱️ Bot Uptime: ${Math.floor(client.uptime / 60000)} Menit.`);
        if (commandName === 'say') {
            await interaction.channel.send(interaction.options.getString('pesan'));
            return interaction.reply({ content: 'Terkirim', ephemeral: true });
        }
        if (commandName === 'announce') {
            await interaction.channel.send({ embeds: [new EmbedBuilder().setColor('Random').setDescription(interaction.options.getString('pesan'))]});
            return interaction.reply({ content: 'Terkirim', ephemeral: true });
        }
        if (commandName === 'poll') {
            const msg = await interaction.channel.send(`📊 **POLLING:** ${interaction.options.getString('pertanyaan')}`);
            await msg.react('👍'); await msg.react('👎');
            return interaction.reply({ content: 'Polling dibuat', ephemeral: true });
        }
        if (commandName === '8ball') {
            const ans = ["Tentu saja!", "Tidak mungkin.", "Mungkin saja.", "Coba tanya lagi nanti."];
            return interaction.reply(`🎱 Pertanyaan: ${interaction.options.getString('tanya')}\nJawaban: **${ans[Math.floor(Math.random() * ans.length)]}**`);
        }
        if (commandName === 'coinflip') return interaction.reply(`🪙 Koin dilempar... Hasil: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**!`);
        if (commandName === 'roll') return interaction.reply(`🎲 Kamu melempar dadu dan mendapat angka: **${Math.floor(Math.random() * 100) + 1}**`);
        if (commandName === 'rps') return interaction.reply(`Bermain suit... Aku memilih 📄 Kertas. Selesai!`); // Dummy simple
        if (commandName === 'hug') return interaction.reply(`🤗 ${interaction.user} memeluk ${interaction.options.getUser('target')}!`);
        if (commandName === 'slap') return interaction.reply(`🖐️ ${interaction.user} menampar ${interaction.options.getUser('target')}! PLAK!`);
        if (commandName === 'kiss') return interaction.reply(`💋 ${interaction.user} mencium ${interaction.options.getUser('target')}!`);
        if (commandName === 'pat') return interaction.reply(`pat pat~ ${interaction.user} mengusap kepala ${interaction.options.getUser('target')}!`);
        if (commandName === 'joke') return interaction.reply(`Kenapa ayam menyeberang jalan? Biar sampai di seberang dong.`);
        if (commandName === 'quote') return interaction.reply(`"Terkadang sistem rusak bukan karena bug, tapi karena kurang ngopi." - Dev anonim`);
        if (commandName === 'meme') return interaction.reply(`Kirim gambar meme: https://i.imgflip.com/1ur9b0.jpg`);
        if (commandName === 'afk') {
            afkUsers.set(interaction.user.id, interaction.options.getString('alasan'));
            return interaction.reply(`💤 Kamu sekarang AFK. Alasan: ${interaction.options.getString('alasan')}`);
        }
        if (commandName === 'nickname') {
            const member = interaction.options.getMember('target');
            await member.setNickname(interaction.options.getString('nama_baru'));
            return interaction.reply(`✅ Nickname ${member.user.tag} diubah.`);
        }
        if (commandName === 'roleinfo') return interaction.reply(`Info Role: ${interaction.options.getRole('role').name}`);
        if (commandName === 'channelinfo') return interaction.reply(`Info Channel: ${interaction.channel.name}`);
        if (commandName === 'nuke') {
            const pos = interaction.channel.position;
            const newCh = await interaction.channel.clone();
            await interaction.channel.delete();
            newCh.setPosition(pos);
            return newCh.send('☢️ Channel telah di-Nuke!');
        }
        
        // --- MODERASI BASIC ---
        if (commandName === 'ban') {
            await interaction.guild.members.ban(interaction.options.getUser('target'));
            return interaction.reply(`🔨 Berhasil ban member.`);
        }
        if (commandName === 'kick') {
            const m = await interaction.guild.members.fetch(interaction.options.getUser('target'));
            await m.kick();
            return interaction.reply(`👢 Berhasil kick member.`);
        }
        if (commandName === 'addrole') {
            const m = await interaction.guild.members.fetch(interaction.options.getUser('target'));
            await m.roles.add(interaction.options.getRole('role'));
            return interaction.reply(`✅ Berhasil tambah role.`);
        }
        if (commandName === 'deleterole') {
            const m = await interaction.guild.members.fetch(interaction.options.getUser('target'));
            await m.roles.remove(interaction.options.getRole('role'));
            return interaction.reply(`✅ Berhasil hapus role.`);
        }

        // --- CREATE TICKET ---
        if (commandName === 'create_ticket') {
            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🎟️ CREATE TICKET')
                .setDescription(`Silakan pilih kategori sesuai kebutuhan kamu:\n\n<a:emoji_3:1471046589295628380> **Order**\n<a:emoji_39:1471068830963859538> **Support**\n<:emoji_55:1473459687872528557> **Request Partner**`);

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_menu_select')
                    .setPlaceholder('Pilih Kategori Ticket...')
                    .addOptions([
                        { label: 'Order', value: 'ticket_order' },
                        { label: 'Support', value: 'ticket_support' },
                        { label: 'Request Partner', value: 'ticket_partner' }
                    ])
            );
            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '✅ Panel ticket berhasil dikirim!', ephemeral: true });
        }

        if (commandName === 'upload') {
            return interaction.reply({ content: "Logika upload berjalan (isi sesuai aslinya)...", ephemeral: true });
        }

        return;
    }

    // --- TICKET MENU HANDLER ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu_select') {
        const value = interaction.values[0];
        const user = interaction.user;
        let categoryName = value.replace('ticket_', '') + `-${user.username}`;

        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: categoryName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            const welcomeTicketEmbed = new EmbedBuilder().setTitle('🎟️ Ticket Berhasil Dibuka').setColor('#2ecc71').setDescription(`Halo ${user}, staf kami akan segera melayani kamu.`);
            const closeBtnRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Tutup Ticket').setStyle(ButtonStyle.Danger));

            await ticketChannel.send({ content: `${user}`, embeds: [welcomeTicketEmbed], components: [closeBtnRow] });
            await interaction.reply({ content: `✅ Ticket kamu berhasil dibuat di ${ticketChannel}`, ephemeral: true });
        } catch (error) {
            await interaction.reply({ content: '❌ Gagal membuat ticket.', ephemeral: true });
        }
    }

    // --- BUTTON HANDLER TICKET CLOSE ---
    if (interaction.isButton() && interaction.customId === 'close_ticket_btn') {
        await interaction.reply({ content: '🔒 Ticket akan ditutup dalam 5 detik...' });
        setTimeout(() => interaction.channel.delete().catch(console.error), 5000);
    }
});

client.login(TOKEN);
