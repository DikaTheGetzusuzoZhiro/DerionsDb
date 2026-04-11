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

// SILAKAN UBAH CHANNEL ID DI SINI SESUAI KEBUTUHAN
const scannerChannelId = "1489948015618691133"; 
const aiChannelId = "1475164217115021475";      

// Pengaturan Role & Pengecualian Akses Command
const EXCLUSIVE_ROLE_ID = "1466470849266848009"; 
const PUBLIC_COMMANDS = ['panelspam', 'cs', 'create_ticket', 'status']; 

// Pengaturan Auto Welcome Hardcode
const WELCOME_CHANNEL_ID = "1464775422913941568";
const WELCOME_BG_URL = "https://cdn.discordapp.com/attachments/1471539417482006735/1492328908417138720/icegif-421.gif?ex=69daef19&is=69d99d99&hm=ed437869f512ebf94b8c57a29e9f48dac6bc0d46d9db05061ea66579d4536695&";

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];
const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50, 5: 100 };

const detectionPatterns = [
    // 🔴 LEVEL 5: INSTAN 100% BAHAYA TINGGI
    { regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, desc: "Link Discord Webhook", sev: 5 },
    { regex: /api\.telegram\.org\/bot/i, desc: "Link API Telegram Bot", sev: 5 },
    { regex: /\b(password|username|webhook|telegram)\b/i, desc: "Kata Kunci Pencurian Data", sev: 5 },
    { regex: /\bsampGetPlayer(?:Nickname|Name)\b/i, desc: "Fungsi Pencurian Nama Player", sev: 5 },

    // 🟠 LEVEL 4: SANGAT MENCURIGAKAN (50%)
    { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "Eksekusi Command OS", sev: 4 },
    { regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, desc: "Eksekusi Kode Dinamis", sev: 4 },

    // 🟡 LEVEL 3: MENCURIGAKAN (30%)
    { regex: /moonsec|protected with moonsec/i, desc: "MoonSec protection (Obfuscator)", sev: 3 },
    { regex: /luaobfuscator|obfuscate|anti[-_ ]debug/i, desc: "Obfuscation / Anti-Debug", sev: 3 },
    { regex: /require\s*\(\s*['"]socket['"]\s*\)/i, desc: "Koneksi Jaringan Socket", sev: 3 },
    { regex: /(?:[A-Za-z0-9+\/]{100,}={0,2})/, desc: "Base64 Encoded Blob", sev: 3 },

    // 🟢 LEVEL 1: PERLU PERHATIAN KECIL (8%)
    { regex: /loadstring/i, desc: "Loadstring Keyword", sev: 1 }
];

const csSessions = new Map();
const spamConfigs = new Map();
const activeSpams = new Map();
const welcomeConfigs = new Map(); 
const afkUsers = new Map(); 

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
                        content: `Kamu adalah asisten AI. Jawab singkat, padat, dan jelas. Jawab semua pertanyaan dengan baik layaknya AI. Sesuaikan sikapmu: Jika sopan balas ramah, jika toxic balas nyolot dan sarkas.` 
                    },
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
            .setDescription('Gunakan prefix `!` atau `/` (Slash Commands).\n')
            .addFields(
                { name: '🎮 ROLEPLAY & UTILITIES', value: `**> \`!cs\` / \`/cs\`**\nMembuka panel interaktif pembuatan *Character Story*.\n**> \`!panelspam\` / \`/panelspam\`**\nMembuka tools panel Anti-Keylogger.` },
                { name: '🤖 FITUR OTOMATIS', value: `**> 🛡️ Cek Keylogger Otomatis**\nKirim file ke channel Scanner.\n**> 🤖 AI Chat**\nNgobrol bebas tanpa command di channel AI.` },
                { name: '🔒 KHUSUS STAFF', value: `**> \`/upload\`**\nUpload script/mod ke server.\n**> \`/status\`**\nMemeriksa metrik operasional bot.` }
            )
            .setFooter({ text: 'TATANG DEVELOPER System' })
            .setTimestamp()]
    }),
    status: (client) => ({
        embeds: [new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('📊 Metrik & Status Operasional Server')
            .addFields(
                { name: '📡 Ping (Latency)', value: `\`${client ? client.ws.ping : 0}ms\``, inline: true },
                { name: '🤖 Status Core', value: '`🟢 Online`', inline: true }
            )
            .setFooter({ text: 'TATANG DEVELOPER System' })
            .setTimestamp()]
    }),
    panelspam: () => ({
        embeds: [new EmbedBuilder()
            .setTitle('💣 Panel Spam Target Keylogger')
            .setColor('#e74c3c')
            .setDescription('**Panel Spam Webhook & Telegram**\nFitur untuk membanjiri target pembuat keylogger.')
            .setFooter({ text: 'Created By TATANG DEVELOPER' })],
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
            .setFooter({ text: 'Created By TATANG DEVELOPER' })],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_cs').setLabel('Buat Character Story').setStyle(ButtonStyle.Primary))]
    })
};

// =======================
// 📜 SLASH COMMANDS REGISTRATION 
// =======================

const commands = [
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
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Matikan / Hidupkan sistem welcome otomatis')
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
// 🚪 GUILD MEMBER ADD (Welcome System Default On)
// =======================
client.on('guildMemberAdd', async (member) => {
    const config = welcomeConfigs.get(member.guild.id);
    const isEnabled = config !== undefined ? config.enabled : true; 
    if (!isEnabled) return; 

    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#00d2ff')
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription(`Halo ${member}, selamat bergabung dengan komunitas kami!`)
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

    // AFK System
    if (message.mentions.users.size > 0) {
        message.mentions.users.forEach(u => {
            if (afkUsers.has(u.id)) {
                message.reply(`💤 **${u.username}** sedang AFK: ${afkUsers.get(u.id)}`);
            }
        });
    }
    if (afkUsers.has(message.author.id)) {
        afkUsers.delete(message.author.id);
        message.reply(`👋 Selamat datang kembali ${message.author}! Status AFK kamu telah dihapus.`).then(m => setTimeout(() => m.delete(), 5000));
    }

    const content = message.content.toLowerCase();
    if (content === "!help") return message.reply(payloads.help());
    if (content === "!panelspam") return message.channel.send(payloads.panelspam());
    if (content === "!cs") return message.channel.send(payloads.cs());

    // --- AI CHANNEL LOGIC (TANPA PREFIX !ai) ---
    if (message.channel.id === aiChannelId) {
        // Karena di channel khusus AI, bot akan langsung merespons semua chat biasa
        await message.channel.sendTyping();
        const aiResponse = await generateAIResponse(message.content);
        return message.reply(aiResponse);
    }

    // --- SCANNER CHANNEL LOGIC (CEK KEYLOGGER) ---
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
                    { name: "👤 Pengguna", value: `${message.author}`, inline: true },
                    { name: "📄 Nama File", value: attachment.name, inline: true },
                    { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB`, inline: true },
                    { name: "📊 Status Keamanan", value: result.status, inline: true },
                    { name: "⚠️ Tingkat Risiko", value: `${result.percent}%`, inline: true },
                    { name: "🔎 Detail Deteksi", value: result.detail }
                )
                .setFooter({ text: "Deteksi Keylogger by TATANG DEVELOPER" })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // Ekstrak Link untuk Panel Spam
            if (result.extractedData && result.extractedData.length > 0) {
                const uniqueLinks = [...new Set(result.extractedData)].join("\n");
                await message.channel.send(`🚨 **PERINGATAN! DITEMUKAN TARGET BERBAHAYA!** 🚨\nBerikut adalah Webhook/Token Telegram yang berhasil diekstrak:\n\n\`\`\`txt\n${uniqueLinks}\n\`\`\`\n*Gunakan \`/panelspam\` atau \`!panelspam\` untuk menyerang target!*`);
            }
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

    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 🔒 SISTEM FILTER ROLE KHUSUS
        if (!PUBLIC_COMMANDS.includes(commandName)) {
            if (!interaction.member.roles.cache.has(EXCLUSIVE_ROLE_ID)) {
                return interaction.reply({ 
                    content: `❌ **Akses Ditolak!** Hanya role khusus (ID: ${EXCLUSIVE_ROLE_ID}) yang bisa menggunakan perintah bot ini.`, 
                    ephemeral: true 
                });
            }
        }

        // --- COMMANDS UTAMA ---
        if (commandName === 'help') return interaction.reply(payloads.help());
        if (commandName === 'panelspam') return interaction.reply(payloads.panelspam());
        if (commandName === 'cs') return interaction.reply(payloads.cs());
        if (commandName === 'status') return interaction.reply(payloads.status(client));

        // --- WELCOME ---
        if (commandName === 'welcome') {
            const status = interaction.options.getBoolean('status');
            welcomeConfigs.set(interaction.guild.id, { enabled: status });
            return interaction.reply({ content: `✅ Fitur Welcome otomatis **${status ? 'DIAKTIFKAN' : 'DIMATIKAN'}**`, ephemeral: true });
        }

        // --- 30 FITUR TAMBAHAN ---
        if (commandName === 'lock') {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            return interaction.reply('🔒 Channel dikunci!');
        }
        if (commandName === 'unlock') {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
            return interaction.reply('🔓 Channel dibuka!');
        }
        if (commandName === 'purge') {
            const jumlah = interaction.options.getInteger('jumlah');
            await interaction.channel.bulkDelete(jumlah, true);
            return interaction.reply({ content: `🧹 Menghapus ${jumlah} pesan!`, ephemeral: true });
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
            return interaction.reply(`🔇 ${target} di-timeout ${menit} menit.`);
        }
        if (commandName === 'untimeout') {
            const target = interaction.options.getMember('target');
            await target.timeout(null);
            return interaction.reply(`🔊 Timeout ${target} dicabut.`);
        }
        if (commandName === 'serverinfo') {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(interaction.guild.name).addFields({name: 'Member Count', value: `${interaction.guild.memberCount}`})] });
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
        if (commandName === '8ball') return interaction.reply(`🎱 Jawaban: **Mungkin saja.**`);
        if (commandName === 'coinflip') return interaction.reply(`🪙 Koin dilempar... Hasil: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**!`);
        if (commandName === 'roll') return interaction.reply(`🎲 Angka dadumu: **${Math.floor(Math.random() * 100) + 1}**`);
        if (commandName === 'rps') return interaction.reply(`Bermain suit... Aku memilih 📄 Kertas!`);
        if (commandName === 'hug') return interaction.reply(`🤗 ${interaction.user} memeluk ${interaction.options.getUser('target')}!`);
        if (commandName === 'slap') return interaction.reply(`🖐️ ${interaction.user} menampar ${interaction.options.getUser('target')}!`);
        if (commandName === 'kiss') return interaction.reply(`💋 ${interaction.user} mencium ${interaction.options.getUser('target')}!`);
        if (commandName === 'pat') return interaction.reply(`pat pat~ ${interaction.user} mengusap kepala ${interaction.options.getUser('target')}!`);
        if (commandName === 'joke') return interaction.reply(`Kenapa ayam menyeberang jalan? Biar sampai di seberang.`);
        if (commandName === 'quote') return interaction.reply(`"Terkadang sistem rusak bukan karena bug, tapi karena kurang ngopi."`);
        if (commandName === 'meme') return interaction.reply(`Kirim gambar meme: https://i.imgflip.com/1ur9b0.jpg`);
        if (commandName === 'afk') {
            afkUsers.set(interaction.user.id, interaction.options.getString('alasan'));
            return interaction.reply(`💤 Kamu AFK. Alasan: ${interaction.options.getString('alasan')}`);
        }
        if (commandName === 'nickname') {
            const member = interaction.options.getMember('target');
            await member.setNickname(interaction.options.getString('nama_baru'));
            return interaction.reply(`✅ Nickname diubah.`);
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

        // --- UPLOAD COMMAND ---
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
                    .setFooter({ text: `@TATANG DEVELOPER | ${tgl}` });

                if (img) embed.setImage(img.url);

                await channel.send({ embeds: [embed] });
                await interaction.reply({ content: `✅ Berhasil dikirim ke ${channel}`, ephemeral: true });
            } catch (err) {
                console.error("❌ ERROR Upload:", err);
                await interaction.reply({ content: "❌ Terjadi error saat upload!", ephemeral: true });
            }
        }

        // --- CREATE TICKET ---
        if (commandName === 'create_ticket') {
            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🎟️ CREATE TICKET')
                .setDescription(`Pilih kategori tiket di bawah ini untuk bantuan.`);

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_menu_select')
                    .setPlaceholder('Pilih Kategori Ticket...')
                    .addOptions([
                        { label: 'Order', value: 'ticket_order', emoji: '🛒' },
                        { label: 'Support', value: 'ticket_support', emoji: '🛠️' },
                        { label: 'Request Partner', value: 'ticket_partner', emoji: '🤝' }
                    ])
            );
            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '✅ Panel ticket berhasil dikirim!', ephemeral: true });
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

            const welcomeEmbed = new EmbedBuilder().setTitle('🎟️ Ticket Terbuka').setColor('#2ecc71').setDescription(`Halo ${user}, staf kami akan merespons secepatnya.`);
            const closeBtnRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Tutup Ticket').setStyle(ButtonStyle.Danger));

            await ticketChannel.send({ content: `${user}`, embeds: [welcomeEmbed], components: [closeBtnRow] });
            await interaction.reply({ content: `✅ Ticket dibuat di ${ticketChannel}`, ephemeral: true });
        } catch (error) {
            await interaction.reply({ content: '❌ Gagal membuat ticket. Periksa izin bot.', ephemeral: true });
        }
    }
    if (interaction.isButton() && interaction.customId === 'close_ticket_btn') {
        await interaction.reply({ content: '🔒 Ticket ditutup dalam 5 detik...' });
        setTimeout(() => interaction.channel.delete().catch(console.error), 5000);
    }

    // --- PANEL SPAM LOGIC ---
    if (interaction.isButton()) {
        if (interaction.customId === 'spam_set_webhook') {
            const modal = new ModalBuilder().setCustomId('modal_set_webhook').setTitle('Set Target Webhook');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_url').setLabel('Link Webhook Discord').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_webhook_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('WEBHOOK INI TELAH DIHANCURKAN OLEH TATANG DEVELOPER ANTI KEYLOGGER!'))
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'spam_set_tele') {
            const modal = new ModalBuilder().setCustomId('modal_set_tele').setTitle('Set Target Telegram');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_token').setLabel('Bot Token Target').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_chatid').setLabel('Chat ID Target').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('in_tele_msg').setLabel('Pesan Spam').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue('BOT INI TELAH DIHANCURKAN OLEH TATANG DEVELOPER ANTI KEYLOGGER!'))
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'spam_start') {
            const config = spamConfigs.get(interaction.user.id);
            if (!config) return interaction.reply({ content: '⚠️ Belum mengatur target!', ephemeral: true });
            if (activeSpams.has(interaction.user.id)) return interaction.reply({ content: '⚠️ Spam sudah berjalan!', ephemeral: true });

            await interaction.reply({ content: '🔥 Spam dimulai! (Interval 1 detik)', ephemeral: true });
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
            return interaction.reply({ content: '⚠️ Tidak ada spam aktif.', ephemeral: true });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_set_webhook') {
            spamConfigs.set(interaction.user.id, { type: 'webhook', url: interaction.fields.getTextInputValue('in_webhook_url'), msg: interaction.fields.getTextInputValue('in_webhook_msg') });
            return interaction.reply({ content: '✅ Webhook disetel!', ephemeral: true });
        }
        if (interaction.customId === 'modal_set_tele') {
            spamConfigs.set(interaction.user.id, { type: 'telegram', token: interaction.fields.getTextInputValue('in_tele_token'), chatId: interaction.fields.getTextInputValue('in_tele_chatid'), msg: interaction.fields.getTextInputValue('in_tele_msg') });
            return interaction.reply({ content: '✅ Telegram disetel!', ephemeral: true });
        }
    }

    // --- CS CREATION LOGIC ---
    if (interaction.isButton() && interaction.customId === 'start_cs') {
        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_server').setPlaceholder('Pilih server tujuan...').addOptions([
                { label: 'SSRP', value: 'SSRP' }, { label: 'Virtual RP', value: 'Virtual RP' }, { label: 'AARP', value: 'AARP' },
                { label: 'GCRP', value: 'GCRP' }, { label: 'TEN ROLEPLAY', value: 'TEN ROLEPLAY' }, { label: 'CPRP', value: 'CPRP' }
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

        const modal = new ModalBuilder().setCustomId('modal_step_1').setTitle(`Detail (${side}) (1/2)`);
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

        const button = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('to_step_2').setLabel('Lanjutkan (2/2)').setStyle(ButtonStyle.Primary));
        return interaction.reply({ content: '✅ Detail dasar disimpan. Lanjut isi cerita.', components: [button], ephemeral: true });
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
        
        const bakat = interaction.fields.getTextInputValue('in_bakat');
        const kultur = interaction.fields.getTextInputValue('in_kultur') || '-';
        const ekstra = interaction.fields.getTextInputValue('in_ekstra') || '-';

        try {
            const promptContext = `Tuliskan Character Story GTA Roleplay untuk karakter bernama ${session.data.nama} (Gender: ${session.data.gender}). Lahir: ${session.data.dob}, Kota: ${session.data.city}. Sisi: ${session.side}, Bakat: ${bakat}, Kultur: ${kultur}, Tambahan: ${ekstra}. Buat 3 paragraf naratif bahasa Indonesia formal tanpa intro.`;

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
                .setFooter({ text: 'Created By TATANG DEVELOPER' }); 

            await interaction.editReply({ embeds: [finalEmbed] });
            csSessions.delete(interaction.user.id);
        } catch (error) {
            await interaction.editReply({ content: '❌ AI Sedang sibuk.' });
        }
    }
});

// LOGIN
client.login(TOKEN);
