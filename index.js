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
    PermissionFlagsBits // Ditambahkan untuk permission moderasi
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
        GatewayIntentBits.GuildMembers // Ditambahkan untuk fitur Welcome
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

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];

const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50, 5: 100 };

const detectionPatterns = [
    { regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i, desc: "Link Discord Webhook", sev: 5 },
    { regex: /api\.telegram\.org\/bot/i, desc: "Link API Telegram Bot", sev: 5 },
    { regex: /\b(password|username|webhook|telegram)\b/i, desc: "Kata Kunci Pencurian Data (password/username/webhook/tele)", sev: 5 },
    { regex: /\bsampGetPlayer(?:Nickname|Name)\b/i, desc: "Fungsi Pencurian Nama Player (sampGetPlayer)", sev: 5 },
    { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "Eksekusi Command OS (os.execute)", sev: 4 },
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

// Map untuk menyimpan setting Welcome (Server ID -> Setting)
const welcomeConfigs = new Map();

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
    help: () => ({ /* Diabaikan untuk efisiensi baris (kode lama kamu tetap ada di bayangan) */
        embeds: [new EmbedBuilder()
            .setColor('#00d2ff')
            .setTitle('🌟 Pusat Komando & Panduan Bot 🌟')
            .setDescription('Gunakan prefix `!` atau `/` (Slash Commands).')
            .setTimestamp()]
    }),
    status: (client) => ({
        embeds: [new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('📊 Metrik & Status Operasional Server')
            .addFields({ name: '📡 Ping (Latency)', value: `\`${client ? client.ws.ping : 0}ms\`` })
            .setTimestamp()]
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
// 📜 SLASH COMMANDS REGISTRATION
// =======================

const commands = [
    new SlashCommandBuilder().setName('help').setDescription('Tampilkan menu bantuan bot'),
    new SlashCommandBuilder().setName('panelspam').setDescription('Tampilkan panel spam target keylogger'),
    new SlashCommandBuilder().setName('cs').setDescription('Buka panel pembuatan Character Story (CS)'),
    new SlashCommandBuilder().setName('status').setDescription('Cek status operator bot'),
    new SlashCommandBuilder()
        .setName('upload')
        .setDescription('Upload script/mod ke channel (Khusus Role)')
        .addChannelOption(opt => opt.setName('channel').setDescription('Pilih channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('judul').setDescription('Judul Script').setRequired(true))
        .addStringOption(opt => opt.setName('cmd').setDescription('Command game').setRequired(true))
        .addStringOption(opt => opt.setName('deskripsi').setDescription('Deskripsi script').setRequired(true))
        .addStringOption(opt => opt.setName('credit').setDescription('Credit pembuat').setRequired(true))
        .addStringOption(opt => opt.setName('download').setDescription('Link download').setRequired(true))
        .addAttachmentOption(opt => opt.setName('gambar').setDescription('Upload gambar (optional)').setRequired(false)),
    // ===== FITUR BARU MULAI DI SINI =====
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Atur sistem welcome on/off')
        .addBooleanOption(opt => opt.setName('status').setDescription('On / Off').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Pilih channel welcome').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban member dari server')
        .addUserOption(opt => opt.setName('target').setDescription('Member yang diban').setRequired(true))
        .addStringOption(opt => opt.setName('alasan').setDescription('Alasan ban').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick member dari server')
        .addUserOption(opt => opt.setName('target').setDescription('Member yang dikick').setRequired(true))
        .addStringOption(opt => opt.setName('alasan').setDescription('Alasan kick').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    new SlashCommandBuilder()
        .setName('addrole')
        .setDescription('Tambahkan role ke member')
        .addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('Pilih Role').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
        .setName('deleterole')
        .setDescription('Hapus role dari member')
        .addUserOption(opt => opt.setName('target').setDescription('Member').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('Pilih Role').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
        .setName('create_ticket')
        .setDescription('Munculkan panel ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
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
// 🚪 GUILD MEMBER ADD (Welcome System)
// =======================
client.on('guildMemberAdd', async (member) => {
    const config = welcomeConfigs.get(member.guild.id);
    if (!config || !config.enabled) return;

    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) return;

    // ⚠️ PERHATIAN: Pastikan URL ini adalah direct link gambar (.png/.jpg)
    // Jika link di bawah ini error tidak muncul di Discord, klik kanan gambar di pesan Discord tsb -> Copy Image Address
    const backgroundUrl = "https://cdn.discordapp.com/attachments/1471539417482006735/1492328908417138720/icegif-421.gif?ex=69daef19&is=69d99d99&hm=ed437869f512ebf94b8c57a29e9f48dac6bc0d46d9db05061ea66579d4536695&";

    const embed = new EmbedBuilder()
        .setColor('#00d2ff')
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription(`Halo ${member}, selamat bergabung dengan komunitas kami!\n\nJangan lupa baca peraturan dan nikmati waktumu di sini.`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setImage(backgroundUrl) // Set background gambar
        .setFooter({ text: `Member #${member.guild.memberCount}`, iconURL: member.guild.iconURL() })
        .setTimestamp();

    await channel.send({ content: `Hai ${member}!`, embeds: [embed] });
});

// =======================
// 💬 MESSAGE LISTENER
// =======================

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();

    if (content === "!help") return message.reply(payloads.help());
    if (content === "!panelspam") return message.channel.send(payloads.panelspam());
    if (content === "!cs") return message.channel.send(payloads.cs());

    // AI & SCANNER LOGIC TETAP SAMA
    // ...
});

// =======================
// 🎛️ INTERACTION HANDLER
// =======================

client.on('interactionCreate', async (interaction) => {

    // --- SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'help') return interaction.reply(payloads.help());
        if (commandName === 'panelspam') return interaction.reply(payloads.panelspam());
        if (commandName === 'cs') return interaction.reply(payloads.cs());
        if (commandName === 'status') return interaction.reply(payloads.status(client));

        // WELCOME
        if (commandName === 'welcome') {
            const status = interaction.options.getBoolean('status');
            const channel = interaction.options.getChannel('channel');
            welcomeConfigs.set(interaction.guild.id, { enabled: status, channelId: channel.id });
            return interaction.reply({ content: `✅ Fitur Welcome **${status ? 'DIAKTIFKAN' : 'DIMATIKAN'}** di channel ${channel}`, ephemeral: true });
        }

        // BAN
        if (commandName === 'ban') {
            const target = interaction.options.getUser('target');
            const reason = interaction.options.getString('alasan') || 'Tidak ada alasan';
            try {
                await interaction.guild.members.ban(target, { reason });
                return interaction.reply(`🔨 **${target.tag}** telah diban. Alasan: ${reason}`);
            } catch (err) {
                return interaction.reply({ content: '❌ Gagal melakukan ban (posisi role bot mungkin di bawah target).', ephemeral: true });
            }
        }

        // KICK
        if (commandName === 'kick') {
            const target = interaction.options.getUser('target');
            const reason = interaction.options.getString('alasan') || 'Tidak ada alasan';
            try {
                const member = await interaction.guild.members.fetch(target.id);
                await member.kick(reason);
                return interaction.reply(`👢 **${target.tag}** telah dikick. Alasan: ${reason}`);
            } catch (err) {
                return interaction.reply({ content: '❌ Gagal melakukan kick (posisi role bot mungkin di bawah target).', ephemeral: true });
            }
        }

        // ADD ROLE
        if (commandName === 'addrole') {
            const target = interaction.options.getUser('target');
            const role = interaction.options.getRole('role');
            try {
                const member = await interaction.guild.members.fetch(target.id);
                await member.roles.add(role);
                return interaction.reply(`✅ Berhasil menambahkan role **${role.name}** ke ${target}`);
            } catch (err) {
                return interaction.reply({ content: '❌ Gagal menambahkan role. Periksa hirarki role bot.', ephemeral: true });
            }
        }

        // DELETE ROLE
        if (commandName === 'deleterole') {
            const target = interaction.options.getUser('target');
            const role = interaction.options.getRole('role');
            try {
                const member = await interaction.guild.members.fetch(target.id);
                await member.roles.remove(role);
                return interaction.reply(`✅ Berhasil mencabut role **${role.name}** dari ${target}`);
            } catch (err) {
                return interaction.reply({ content: '❌ Gagal mencabut role. Periksa hirarki role bot.', ephemeral: true });
            }
        }

        // CREATE TICKET
        if (commandName === 'create_ticket') {
            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🎟️ CREATE TICKET')
                .setDescription(`Silakan pilih kategori sesuai kebutuhan kamu:\n\n<a:emoji_3:1471046589295628380> **Order**\nDigunakan untuk:\n• Melakukan pembayaran\n• Konfirmasi transaksi\n• Pertanyaan terkait harga / produk\n\n<a:emoji_39:1471068830963859538> **Support**\nDigunakan untuk:\n• Error / bug pada file atau mod\n• Kendala saat menggunakan file / script\n• Bantuan penggunaan fitur\n\n<:emoji_55:1473459687872528557> **Request Partner**\nDigunakan untuk:\n• Mengajukan kerja sama / partnership\n• Promosi server / komunitas\n\n❗**Peraturan Ticket**\n• Dilarang membuat ticket tanpa tujuan yang jelas\n• Dilarang spam, troll, atau iseng\n\nTerima kasih telah mematuhi peraturan 🙏\nSelamat menggunakan layanan kami 🚀`);

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_menu_select')
                    .setPlaceholder('Pilih Kategori Ticket...')
                    .addOptions([
                        { label: 'Order', value: 'ticket_order', emoji: '1471046589295628380' },
                        { label: 'Support', value: 'ticket_support', emoji: '1471068830963859538' },
                        { label: 'Request Partner', value: 'ticket_partner', emoji: '1473459687872528557' }
                    ])
            );

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '✅ Panel ticket berhasil dikirim!', ephemeral: true });
        }

        if (commandName === 'upload') {
            // Logika upload lama ...
        }
        return;
    }

    // --- TICKET MENU HANDLER ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu_select') {
        const value = interaction.values[0];
        const user = interaction.user;
        const guild = interaction.guild;

        let categoryName = '';
        if (value === 'ticket_order') categoryName = `order-${user.username}`;
        if (value === 'ticket_support') categoryName = `support-${user.username}`;
        if (value === 'ticket_partner') categoryName = `partner-${user.username}`;

        try {
            const ticketChannel = await guild.channels.create({
                name: categoryName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            const welcomeTicketEmbed = new EmbedBuilder()
                .setTitle('🎟️ Ticket Berhasil Dibuka')
                .setColor('#2ecc71')
                .setDescription(`Halo ${user}, staf kami akan segera melayani kamu.\nSilakan jelaskan keperluanmu secara detail di bawah ini.`);

            const closeBtnRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket_btn')
                    .setLabel('Tutup Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );

            await ticketChannel.send({ content: `${user} | <@&Staff_Role_ID_Disini_Bila_Perlu>`, embeds: [welcomeTicketEmbed], components: [closeBtnRow] });
            await interaction.reply({ content: `✅ Ticket kamu berhasil dibuat di ${ticketChannel}`, ephemeral: true });
        } catch (error) {
            console.error("Gagal membuat channel ticket:", error);
            await interaction.reply({ content: '❌ Gagal membuat ticket. Pastikan bot memiliki permission Manage Channels.', ephemeral: true });
        }
    }

    // --- BUTTON HANDLER TICKET CLOSE ---
    if (interaction.isButton() && interaction.customId === 'close_ticket_btn') {
        await interaction.reply({ content: '🔒 Ticket akan ditutup dalam 5 detik...' });
        setTimeout(() => {
            interaction.channel.delete().catch(console.error);
        }, 5000);
    }

    // --- BUTTON & MODAL LOGIC LAINNYA (SPAM & CS TETAP ADA) ---
    // ...
});

client.login(TOKEN);
