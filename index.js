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

// =======================
// ⚙️ INITIALIZATION
// =======================

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ TOKEN / CLIENT_ID belum di-set di Environment Variables!');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember
    ]
});

const rest = new REST({ version: '10' }).setToken(TOKEN);

// =======================
// 🔒 CONFIGURATION
// =======================

const scannerChannelId = '1492337144021385336';
const welcomeChannelId = '1464775422913941568';

const staffRoleId = '1466470849266848009';
const autoRoleId = '1464778755372486717';

const allowedExtensions = [
    '.lua',
    '.txt',
    '.zip',
    '.7z'
];

const WELCOME_BG_URL =
    'https://cdn.discordapp.com/attachments/1464926536045170872/1530300153322278922/how-to-make-gif-for-discord-4.gif';

// =======================
// 🧠 MEMORY
// =======================

const csSessions = new Map();
const welcomeConfigs = new Map();

// =======================
// 🔍 SECURITY SCANNER
// =======================

const severityWeight = {
    1: 8,
    2: 18,
    3: 30,
    4: 50,
    5: 100
};

const detectionPatterns = [
    {
        regex: /discord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9\/_\-]+/i,
        desc: 'Link Discord Webhook',
        sev: 5
    },
    {
        regex: /api\.telegram\.org\/bot/i,
        desc: 'Link API Telegram Bot',
        sev: 5
    },
    {
        regex: /\b(password|username|webhook|telegram)\b/i,
        desc: 'Kata Kunci Pencurian Data',
        sev: 5
    },
    {
        regex: /\bsampGetPlayer(?:Nickname|Name)\b/i,
        desc: 'Fungsi Pencurian Nama Player',
        sev: 5
    },
    {
        regex: /\b(?:os\.execute|exec|io\.popen)\b/i,
        desc: 'Eksekusi Command OS',
        sev: 4
    },
    {
        regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i,
        desc: 'Eksekusi Kode Dinamis',
        sev: 4
    },
    {
        regex: /moonsec|protected with moonsec/i,
        desc: 'MoonSec Protection / Obfuscator',
        sev: 3
    },
    {
        regex: /luaobfuscator|obfuscate|anti[-_ ]debug/i,
        desc: 'Obfuscation / Anti-Debug',
        sev: 3
    },
    {
        regex: /require\s*\(\s*['"]socket['"]\s*\)/i,
        desc: 'Koneksi Jaringan Socket',
        sev: 3
    },
    {
        regex: /(?:[A-Za-z0-9+\/]{100,}={0,2})/,
        desc: 'Base64 Encoded Blob',
        sev: 3
    },
    {
        regex: /loadstring/i,
        desc: 'Loadstring Keyword',
        sev: 1
    }
];

function analyzeContent(text) {
    const matches = [];
    const extractedData = [];
    let rawScore = 0;

    const webhookRegex =
        /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/gi;

    const teleRegex =
        /([0-9]{8,10}:[a-zA-Z0-9_-]{35})/gi;

    const foundWebhooks = text.match(webhookRegex);

    if (foundWebhooks) {
        extractedData.push(...foundWebhooks);
    }

    const foundTeleTokens = text.match(teleRegex);

    if (foundTeleTokens) {
        foundTeleTokens.forEach(token => {
            extractedData.push(`Telegram Token: ${token}`);
        });
    }

    for (const pattern of detectionPatterns) {
        pattern.regex.lastIndex = 0;

        if (pattern.regex.test(text)) {
            matches.push(
                `• ${pattern.desc} (level ${pattern.sev})`
            );

            rawScore += severityWeight[pattern.sev];
        }
    }

    const percent = Math.min(100, rawScore);

    let status = '🟢 Aman';
    let color = 0x00ff00;

    if (percent >= 80) {
        status = '🔴 Berbahaya';
        color = 0xff0000;
    } else if (percent >= 50) {
        status = '🟠 Risiko Tinggi';
        color = 0xff8800;
    } else if (percent >= 20) {
        status = '🟡 Mencurigakan';
        color = 0xffcc00;
    }

    if (matches.length === 0) {
        matches.push(
            'Tidak ditemukan pola mencurigakan.'
        );
    }

    return {
        percent,
        status,
        color,
        detail: matches.join('\n'),
        extractedData
    };
}

// =======================
// 📦 PAYLOADS
// =======================

const payloads = {

    help: () => ({
        embeds: [
            new EmbedBuilder()
                .setColor('#00d2ff')
                .setTitle('🌟 TAMA COMMUNITY')
                .setDescription(
                    'Pusat bantuan dan daftar fitur bot.'
                )
                .addFields(
                    {
                        name: '🎮 Roleplay',
                        value:
                            '`/cs` — Membuat Character Story.',
                        inline: false
                    },
                    {
                        name: '🛡️ Security',
                        value:
                            'File Scanner — Memeriksa file yang dikirim ke channel scanner.',
                        inline: false
                    },
                    {
                        name: '📊 Informasi',
                        value:
                            '`/status` — Status bot.\n' +
                            '`/serverinfo` — Informasi server.\n' +
                            '`/userinfo` — Informasi member.\n' +
                            '`/avatar` — Melihat avatar member.',
                        inline: false
                    },
                    {
                        name: '🔒 Staff',
                        value:
                            '`/ban` — Ban member.\n' +
                            '`/kick` — Kick member.\n' +
                            '`/timeout` — Timeout member.\n' +
                            '`/clear` — Hapus pesan.\n' +
                            '`/clearall` — Hapus hingga 100 pesan.\n' +
                            '`/welcome` — Atur welcome.\n' +
                            '`/announce` — Kirim pengumuman.\n' +
                            '`/role` — Kelola role member.\n' +
                            '`/upload` — Rilis script.',
                        inline: false
                    }
                )
                .setFooter({
                    text: 'TAMA COMMUNITY'
                })
                .setTimestamp()
        ]
    }),

    status: () => ({
        embeds: [
            new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('📊 STATUS BOT')
                .addFields(
                    {
                        name: '📡 Ping',
                        value: `\`${client.ws.ping}ms\``,
                        inline: true
                    },
                    {
                        name: '🤖 Bot',
                        value: '`🟢 Online`',
                        inline: true
                    },
                    {
                        name: '🛡️ Security',
                        value: '`🟢 Aktif`',
                        inline: true
                    }
                )
                .setFooter({
                    text: 'TAMA COMMUNITY • System Status'
                })
                .setTimestamp()
        ]
    }),

    cs: () => ({
        embeds: [
            new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('📝 CHARACTER STORY')
                .setDescription(
                    'Buat karakter roleplay dengan mengisi informasi yang tersedia.'
                )
                .setFooter({
                    text: 'TAMA COMMUNITY'
                })
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('start_cs')
                    .setLabel('Buat Character Story')
                    .setEmoji('📝')
                    .setStyle(ButtonStyle.Primary)
            )
        ]
    })
};

// =======================
// 📜 SLASH COMMANDS
// =======================

const commands = [

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Tampilkan bantuan bot'),

    new SlashCommandBuilder()
        .setName('cs')
        .setDescription('Buat Character Story'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Cek status bot'),

    // FITUR 1
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Lihat informasi server'),

    // FITUR 2
    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Lihat informasi member')
        .addUserOption(opt =>
            opt
                .setName('target')
                .setDescription('Member yang ingin dilihat')
                .setRequired(false)
        ),

    // FITUR 3
    new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Lihat avatar member')
        .addUserOption(opt =>
            opt
                .setName('target')
                .setDescription('Member yang ingin dilihat')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Atur welcome otomatis')
        .addStringOption(opt =>
            opt
                .setName('status')
                .setDescription('Pilih status')
                .setRequired(true)
                .addChoices(
                    {
                        name: 'On',
                        value: 'on'
                    },
                    {
                        name: 'Off',
                        value: 'off'
                    }
                )
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban member — Staff')
        .addUserOption(opt =>
            opt
                .setName('target')
                .setDescription('Member yang akan diban')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('alasan')
                .setDescription('Alasan ban')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick member — Staff')
        .addUserOption(opt =>
            opt
                .setName('target')
                .setDescription('Member yang akan dikick')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('alasan')
                .setDescription('Alasan kick')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout member — Staff')
        .addUserOption(opt =>
            opt
                .setName('target')
                .setDescription('Member yang akan di-timeout')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('durasi')
                .setDescription('Durasi dalam menit')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('alasan')
                .setDescription('Alasan timeout')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Hapus pesan — Staff')
        .addIntegerOption(opt =>
            opt
                .setName('jumlah')
                .setDescription('Jumlah pesan 1-100')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('clearall')
        .setDescription('Hapus hingga 100 pesan — Staff'),

    // FITUR 4
    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Kirim pengumuman — Staff')
        .addChannelOption(opt =>
            opt
                .setName('channel')
                .setDescription('Channel tujuan')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('judul')
                .setDescription('Judul pengumuman')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('pesan')
                .setDescription('Isi pengumuman')
                .setRequired(true)
        ),

    // FITUR 5
    new SlashCommandBuilder()
        .setName('role')
        .setDescription('Kelola role member — Staff')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Berikan role')
                .addUserOption(opt =>
                    opt
                        .setName('target')
                        .setDescription('Member')
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Hapus role')
                .addUserOption(opt =>
                    opt
                        .setName('target')
                        .setDescription('Member')
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        ),

    // UPLOAD — TIDAK DIUBAH
    new SlashCommandBuilder()
        .setName('upload')
        .setDescription('Upload script/mod ke channel (Khusus Staff)')
        .addChannelOption(opt =>
            opt
                .setName('channel')
                .setDescription('Pilih channel tujuan')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('judul')
                .setDescription('Judul Script')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('cmd')
                .setDescription('Command game')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('deskripsi')
                .setDescription('Deskripsi script')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('credit')
                .setDescription('Credit pembuat')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('download')
                .setDescription('Link download')
                .setRequired(true)
        )
        .addAttachmentOption(opt =>
            opt
                .setName('gambar')
                .setDescription('Upload gambar (optional)')
                .setRequired(false)
        )

].map(cmd => cmd.toJSON());

// =======================
// 🚀 READY
// =======================

client.once('ready', async () => {

    console.log(
        `🔥 TAMA COMMUNITY BOT aktif sebagai ${client.user.tag}`
    );

    try {

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands
            }
        );

        console.log(
            '✅ Slash Commands berhasil diregister!'
        );

    } catch (err) {

        console.error(
            '❌ Gagal register Slash Commands:',
            err
        );
    }
});

// =======================
// 👋 MEMBER JOIN
// =======================

client.on('guildMemberAdd', async member => {

    // AUTO ROLE
    try {

        const role =
            member.guild.roles.cache.get(
                autoRoleId
            );

        if (role) {

            await member.roles.add(role);

            console.log(
                `✅ Auto-role diberikan kepada ${member.user.tag}`
            );

        }

    } catch (err) {

        console.error(
            '❌ Gagal memberikan auto-role:',
            err
        );
    }

    // WELCOME
    const config =
        welcomeConfigs.get(
            member.guild.id
        );

    if (
        config &&
        config.enabled === false
    ) {
        return;
    }

    const channel =
        member.guild.channels.cache.get(
            welcomeChannelId
        );

    if (!channel) return;

    const embed =
        new EmbedBuilder()
            .setColor('#00d2ff')
            .setTitle(
                '👋 Selamat Datang!'
            )
            .setDescription(
                `Halo ${member}, selamat datang di **TAMA COMMUNITY**!\n\n` +
                'Silakan baca peraturan server dan nikmati komunitas kami.'
            )
            .setThumbnail(
                member.user.displayAvatarURL({
                    dynamic: true,
                    size: 512
                })
            )
            .setImage(
                WELCOME_BG_URL
            )
            .setFooter({
                text:
                    `Member #${member.guild.memberCount} • TAMA COMMUNITY`
            })
            .setTimestamp();

    await channel.send({
        content: `Hai ${member}!`,
        embeds: [embed]
    });
});

// =======================
// 💬 MESSAGE CREATE
// =======================

client.on('messageCreate', async message => {

    if (message.author.bot) return;

    const content =
        message.content
            .toLowerCase()
            .trim();

    if (content === '!help') {
        return message.reply(
            payloads.help()
        );
    }

    if (content === '!cs') {
        return message.channel.send(
            payloads.cs()
        );
    }

    // FILE SCANNER
    if (
        message.channel.id === scannerChannelId &&
        message.attachments.size > 0
    ) {

        const attachment =
            message.attachments.first();

        const fileName =
            attachment.name.toLowerCase();

        const isAllowed =
            allowedExtensions.some(
                ext =>
                    fileName.endsWith(ext)
            );

        if (!isAllowed) {

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            '⚠️ Format File Tidak Didukung'
                        )
                        .setColor(0xff0000)
                        .setDescription(
                            'File yang diperbolehkan: `.lua`, `.txt`, `.zip`, `.7z`'
                        )
                        .setFooter({
                            text: 'TAMA COMMUNITY'
                        })
                        .setTimestamp()
                ]
            });
        }

        try {

            const response =
                await axios.get(
                    attachment.url,
                    {
                        responseType:
                            'arraybuffer'
                    }
                );

            const contentFile =
                Buffer.from(
                    response.data
                ).toString('utf8');

            const result =
                analyzeContent(
                    contentFile
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        '🛡️ Hasil Pemeriksaan File'
                    )
                    .setColor(
                        result.color
                    )
                    .addFields(
                        {
                            name: '👤 Pengirim',
                            value:
                                `${message.author}`
                        },
                        {
                            name: '📄 Nama File',
                            value:
                                attachment.name
                        },
                        {
                            name: '📦 Ukuran',
                            value:
                                `${(attachment.size / 1024).toFixed(2)} KB`
                        },
                        {
                            name: '📊 Status',
                            value:
                                result.status
                        },
                        {
                            name: '⚠️ Tingkat Risiko',
                            value:
                                `${result.percent}%`
                        },
                        {
                            name: '🔎 Hasil Deteksi',
                            value:
                                result.detail.substring(
                                    0,
                                    1024
                                )
                        }
                    )
                    .setFooter({
                        text:
                            'TAMA COMMUNITY • Security Scanner'
                    })
                    .setTimestamp();

            await message.reply({
                embeds: [embed]
            });

            if (
                result.extractedData &&
                result.extractedData.length > 0
            ) {

                const uniqueData =
                    [
                        ...new Set(
                            result.extractedData
                        )
                    ]
                        .join('\n')
                        .substring(
                            0,
                            1900
                        );

                await message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                0xff0000
                            )
                            .setTitle(
                                '🚨 Indikator Mencurigakan Ditemukan'
                            )
                            .setDescription(
                                `\`\`\`txt\n${uniqueData}\n\`\`\`\n` +
                                '⚠️ Jangan menggunakan atau menyebarkan data yang terdeteksi.'
                            )
                            .setFooter({
                                text:
                                    'TAMA COMMUNITY • Security'
                            })
                            .setTimestamp()
                    ]
                });
            }

        } catch (error) {

            console.error(
                '❌ Scanner Error:',
                error
            );

            return message.reply(
                '❌ Gagal membaca file.'
            );
        }
    }
});

// =======================
// 🎛️ INTERACTION HANDLER
// =======================

client.on('interactionCreate', async interaction => {

    // =======================
    // SLASH COMMAND
    // =======================

    if (interaction.isChatInputCommand()) {

        const {
            commandName
        } = interaction;

        const isStaff =
            interaction.member &&
            interaction.member.roles.cache.has(
                staffRoleId
            );

        // BASIC
        if (commandName === 'help') {
            return interaction.reply(
                payloads.help()
            );
        }

        if (commandName === 'cs') {
            return interaction.reply(
                payloads.cs()
            );
        }

        if (commandName === 'status') {
            return interaction.reply(
                payloads.status()
            );
        }

        // =======================
        // FITUR 1 — SERVER INFO
        // =======================

        if (commandName === 'serverinfo') {

            const guild =
                interaction.guild;

            const owner =
                await guild.fetchOwner();

            const embed =
                new EmbedBuilder()
                    .setColor('#00d2ff')
                    .setTitle(
                        '🌐 INFORMASI SERVER'
                    )
                    .setThumbnail(
                        guild.iconURL({
                            dynamic: true,
                            size: 512
                        })
                    )
                    .addFields(
                        {
                            name: '🏠 Nama Server',
                            value:
                                guild.name,
                            inline: true
                        },
                        {
                            name: '👑 Owner',
                            value:
                                `${owner.user.tag}`,
                            inline: true
                        },
                        {
                            name: '👥 Member',
                            value:
                                `${guild.memberCount}`,
                            inline: true
                        },
                        {
                            name: '💬 Channel',
                            value:
                                `${guild.channels.cache.size}`,
                            inline: true
                        },
                        {
                            name: '🎭 Role',
                            value:
                                `${guild.roles.cache.size}`,
                            inline: true
                        },
                        {
                            name: '📅 Dibuat',
                            value:
                                `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                            inline: false
                        }
                    )
                    .setFooter({
                        text:
                            'TAMA COMMUNITY'
                    })
                    .setTimestamp();

            return interaction.reply({
                embeds: [embed]
            });
        }

        // =======================
        // FITUR 2 — USER INFO
        // =======================

        if (commandName === 'userinfo') {

            const target =
                interaction.options.getMember(
                    'target'
                ) ||
                interaction.member;

            const user =
                target.user;

            const roles =
                target.roles.cache
                    .filter(
                        role =>
                            role.id !==
                            interaction.guild.id
                    )
                    .map(
                        role =>
                            `${role}`
                    )
                    .slice(0, 10)
                    .join(', ') ||
                'Tidak ada';

            const embed =
                new EmbedBuilder()
                    .setColor('#00d2ff')
                    .setTitle(
                        '👤 INFORMASI MEMBER'
                    )
                    .setThumbnail(
                        user.displayAvatarURL({
                            dynamic: true,
                            size: 512
                        })
                    )
                    .addFields(
                        {
                            name: '👤 Username',
                            value:
                                user.tag,
                            inline: true
                        },
                        {
                            name: '🆔 User ID',
                            value:
                                user.id,
                            inline: true
                        },
                        {
                            name: '📅 Akun Dibuat',
                            value:
                                `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`,
                            inline: true
                        },
                        {
                            name: '📥 Bergabung',
                            value:
                                target.joinedTimestamp
                                    ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:D>`
                                    : 'Tidak diketahui',
                            inline: true
                        },
                        {
                            name: '🎭 Role',
                            value:
                                roles,
                            inline: false
                        }
                    )
                    .setFooter({
                        text:
                            'TAMA COMMUNITY'
                    })
                    .setTimestamp();

            return interaction.reply({
                embeds: [embed]
            });
        }

        // =======================
        // FITUR 3 — AVATAR
        // =======================

        if (commandName === 'avatar') {

            const target =
                interaction.options.getUser(
                    'target'
                ) ||
                interaction.user;

            const avatar =
                target.displayAvatarURL({
                    extension: 'png',
                    size: 4096
                });

            const embed =
                new EmbedBuilder()
                    .setColor('#00d2ff')
                    .setTitle(
                        `🖼️ AVATAR — ${target.username}`
                    )
                    .setImage(avatar)
                    .setDescription(
                        `[Buka Avatar](${avatar})`
                    )
                    .setFooter({
                        text:
                            'TAMA COMMUNITY'
                    })
                    .setTimestamp();

            return interaction.reply({
                embeds: [embed]
            });
        }

        // =======================
        // STAFF CHECK
        // =======================

        const staffCommands = [
            'welcome',
            'ban',
            'kick',
            'timeout',
            'clear',
            'clearall',
            'announce',
            'role',
            'upload'
        ];

        if (
            staffCommands.includes(
                commandName
            ) &&
            !isStaff
        ) {
            return interaction.reply({
                content:
                    '❌ Akses ditolak! Kamu tidak memiliki izin Staff.',
                ephemeral: true
            });
        }

        // =======================
        // WELCOME
        // =======================

        if (commandName === 'welcome') {

            const status =
                interaction.options.getString(
                    'status'
                );

            const enabled =
                status === 'on';

            welcomeConfigs.set(
                interaction.guild.id,
                {
                    enabled
                }
            );

            return interaction.reply({
                content:
                    enabled
                        ? '✅ Welcome otomatis berhasil diaktifkan.'
                        : '✅ Welcome otomatis berhasil dinonaktifkan.',
                ephemeral: true
            });
        }

        // =======================
        // BAN
        // =======================

        if (commandName === 'ban') {

            const target =
                interaction.options.getMember(
                    'target'
                );

            const reason =
                interaction.options.getString(
                    'alasan'
                );

            if (!target) {
                return interaction.reply({
                    content:
                        '❌ Member tidak ditemukan.',
                    ephemeral: true
                });
            }

            await target.ban({
                reason
            });

            return interaction.reply(
                `🔨 **${target.user.tag}** berhasil dibanned.\nAlasan: *${reason}*`
            );
        }

        // =======================
        // KICK
        // =======================

        if (commandName === 'kick') {

            const target =
                interaction.options.getMember(
                    'target'
                );

            const reason =
                interaction.options.getString(
                    'alasan'
                );

            if (!target) {
                return interaction.reply({
                    content:
                        '❌ Member tidak ditemukan.',
                    ephemeral: true
                });
            }

            await target.kick(
                reason
            );

            return interaction.reply(
                `👢 **${target.user.tag}** berhasil dikick.\nAlasan: *${reason}*`
            );
        }

        // =======================
        // TIMEOUT
        // =======================

        if (commandName === 'timeout') {

            const target =
                interaction.options.getMember(
                    'target'
                );

            const durasi =
                interaction.options.getInteger(
                    'durasi'
                );

            const reason =
                interaction.options.getString(
                    'alasan'
                );

            if (!target) {
                return interaction.reply({
                    content:
                        '❌ Member tidak ditemukan.',
                    ephemeral: true
                });
            }

            if (
                durasi < 1 ||
                durasi > 40320
            ) {
                return interaction.reply({
                    content:
                        '❌ Durasi harus antara 1–40320 menit.',
                    ephemeral: true
                });
            }

            await target.timeout(
                durasi * 60 * 1000,
                reason
            );

            return interaction.reply(
                `⏱️ **${target.user.tag}** mendapatkan timeout selama ${durasi} menit.\nAlasan: *${reason}*`
            );
        }

        // =======================
        // CLEAR
        // =======================

        if (commandName === 'clear') {

            const jumlah =
                interaction.options.getInteger(
                    'jumlah'
                );

            if (
                jumlah < 1 ||
                jumlah > 100
            ) {
                return interaction.reply({
                    content:
                        '❌ Jumlah pesan harus antara 1–100.',
                    ephemeral: true
                });
            }

            await interaction.channel.bulkDelete(
                jumlah,
                true
            );

            return interaction.reply({
                content:
                    `🧹 Berhasil menghapus ${jumlah} pesan.`,
                ephemeral: true
            });
        }

        // =======================
        // CLEAR ALL
        // =======================

        if (commandName === 'clearall') {

            await interaction.channel.bulkDelete(
                100,
                true
            );

            return interaction.reply({
                content:
                    '🧹 Berhasil menghapus hingga 100 pesan.',
                ephemeral: true
            });
        }

        // =======================
        // FITUR 4 — ANNOUNCE
        // =======================

        if (commandName === 'announce') {

            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            const judul =
                interaction.options.getString(
                    'judul'
                );

            const pesan =
                interaction.options.getString(
                    'pesan'
                );

            const embed =
                new EmbedBuilder()
                    .setColor('#00d2ff')
                    .setTitle(
                        `📢 ${judul}`
                    )
                    .setDescription(
                        pesan
                    )
                    .setFooter({
                        text:
                            `TAMA COMMUNITY • ${interaction.user.tag}`
                    })
                    .setTimestamp();

            await channel.send({
                embeds: [embed]
            });

            return interaction.reply({
                content:
                    `✅ Pengumuman berhasil dikirim ke ${channel}.`,
                ephemeral: true
            });
        }

        // =======================
        // FITUR 5 — ROLE
        // =======================

        if (commandName === 'role') {

            const subcommand =
                interaction.options.getSubcommand();

            const target =
                interaction.options.getMember(
                    'target'
                );

            const role =
                interaction.options.getRole(
                    'role'
                );

            if (!target || !role) {
                return interaction.reply({
                    content:
                        '❌ Member atau role tidak ditemukan.',
                    ephemeral: true
                });
            }

            // Cegah role lebih tinggi dari bot
            const botMember =
                interaction.guild.members.me;

            if (
                botMember &&
                role.position >=
                    botMember.roles.highest.position
            ) {
                return interaction.reply({
                    content:
                        '❌ Bot tidak dapat mengelola role tersebut karena posisinya terlalu tinggi.',
                    ephemeral: true
                });
            }

            if (
                subcommand === 'add'
            ) {

                await target.roles.add(
                    role
                );

                return interaction.reply({
                    content:
                        `✅ Role ${role} berhasil diberikan kepada ${target}.`,
                    ephemeral: true
                });
            }

            if (
                subcommand === 'remove'
            ) {

                await target.roles.remove(
                    role
                );

                return interaction.reply({
                    content:
                        `✅ Role ${role} berhasil dihapus dari ${target}.`,
                    ephemeral: true
                });
            }
        }

        // =======================
        // UPLOAD
        // =======================

        if (commandName === 'upload') {

            try {

                const channel =
                    interaction.options.getChannel(
                        'channel'
                    );

                const embed =
                    new EmbedBuilder()
                        .setColor('#ffffff')
                        .setTitle(
                            `**${interaction.options.getString('judul')}**`
                        )
                        .addFields(
                            {
                                name: 'Command',
                                value:
                                    `\`${interaction.options.getString('cmd')}\``
                            },
                            {
                                name: 'Deskripsi',
                                value:
                                    interaction.options.getString('deskripsi')
                            },
                            {
                                name: 'Credit',
                                value:
                                    interaction.options.getString('credit')
                            },
                            {
                                name: 'Download',
                                value:
                                    `[klik untuk download](${interaction.options.getString('download')})`
                            }
                        )
                        .setFooter({
                            text:
                                `@tatang comunity | ${new Date().toLocaleDateString('id-ID')}`
                        });

                const img =
                    interaction.options.getAttachment(
                        'gambar'
                    );

                if (img) {
                    embed.setImage(
                        img.url
                    );
                }

                await channel.send({
                    embeds: [embed]
                });

                return interaction.reply({
                    content:
                        `✅ Berhasil dikirim ke ${channel}`,
                    ephemeral: true
                });

            } catch (err) {

                console.error(
                    '❌ ERROR Upload:',
                    err
                );

                return interaction.reply({
                    content:
                        '❌ Terjadi error saat upload!',
                    ephemeral: true
                });
            }
        }

        return;
    }

    // =======================
    // CHARACTER STORY
    // =======================

    if (
        interaction.isButton() &&
        interaction.customId === 'start_cs'
    ) {

        const selectMenu =
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'select_server'
                    )
                    .setPlaceholder(
                        'Pilih server tujuan...'
                    )
                    .addOptions(
                        {
                            label: 'SSRP',
                            value: 'SSRP'
                        },
                        {
                            label: 'Virtual RP',
                            value: 'Virtual RP'
                        },
                        {
                            label: 'AARP',
                            value: 'AARP'
                        },
                        {
                            label: 'GCRP',
                            value: 'GCRP'
                        },
                        {
                            label: 'TEN ROLEPLAY',
                            value: 'TEN ROLEPLAY'
                        },
                        {
                            label: 'CPRP',
                            value: 'CPRP'
                        },
                        {
                            label: 'Relative RP',
                            value: 'Relative RP'
                        },
                        {
                            label: 'JGRP',
                            value: 'JGRP'
                        },
                        {
                            label: 'FMRP',
                            value: 'FMRP'
                        }
                    )
            );

        return interaction.reply({
            content:
                'Pilih server tujuan:',
            components: [selectMenu],
            ephemeral: true
        });
    }

    if (
        interaction.isStringSelectMenu() &&
        interaction.customId === 'select_server'
    ) {

        csSessions.set(
            interaction.user.id,
            {
                server:
                    interaction.values[0]
            }
        );

        const buttons =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'side_good'
                    )
                    .setLabel(
                        'Goodside'
                    )
                    .setEmoji('😇')
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'side_bad'
                    )
                    .setLabel(
                        'Badside'
                    )
                    .setEmoji('😈')
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

        return interaction.reply({
            content:
                'Pilih alur karakter:',
            components: [buttons],
            ephemeral: true
        });
    }

    if (
        interaction.isButton() &&
        (
            interaction.customId ===
                'side_good' ||
            interaction.customId ===
                'side_bad'
        )
    ) {

        const side =
            interaction.customId ===
                'side_good'
                ? 'Good Side'
                : 'Bad Side';

        const session =
            csSessions.get(
                interaction.user.id
            ) || {
                server: 'Unknown'
            };

        session.side =
            side;

        csSessions.set(
            interaction.user.id,
            session
        );

        const modal =
            new ModalBuilder()
                .setCustomId(
                    'modal_step_1'
                )
                .setTitle(
                    'Detail Karakter'
                );

        modal.addComponents(

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_nama'
                    )
                    .setLabel(
                        'Nama Lengkap (IC)'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            ),

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_level'
                    )
                    .setLabel(
                        'Level Karakter'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            ),

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_gender'
                    )
                    .setLabel(
                        'Jenis Kelamin'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            ),

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_dob'
                    )
                    .setLabel(
                        'Tanggal Lahir'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            ),

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_city'
                    )
                    .setLabel(
                        'Kota Asal'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            )
        );

        return interaction.showModal(
            modal
        );
    }

    if (
        interaction.isModalSubmit() &&
        interaction.customId ===
            'modal_step_1'
    ) {

        const session =
            csSessions.get(
                interaction.user.id
            );

        if (!session) {
            return interaction.reply({
                content:
                    '❌ Sesi Character Story telah berakhir.',
                ephemeral: true
            });
        }

        session.data = {
            nama:
                interaction.fields.getTextInputValue(
                    'in_nama'
                ),
            level:
                interaction.fields.getTextInputValue(
                    'in_level'
                ),
            gender:
                interaction.fields.getTextInputValue(
                    'in_gender'
                ),
            dob:
                interaction.fields.getTextInputValue(
                    'in_dob'
                ),
            city:
                interaction.fields.getTextInputValue(
                    'in_city'
                )
        };

        const button =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'to_step_2'
                    )
                    .setLabel(
                        'Lanjutkan'
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    )
            );

        return interaction.reply({
            content:
                '✅ Informasi karakter berhasil disimpan.',
            components: [button],
            ephemeral: true
        });
    }

    if (
        interaction.isButton() &&
        interaction.customId ===
            'to_step_2'
    ) {

        const session =
            csSessions.get(
                interaction.user.id
            );

        if (!session) {
            return interaction.reply({
                content:
                    '❌ Sesi telah berakhir.',
                ephemeral: true
            });
        }

        const modal =
            new ModalBuilder()
                .setCustomId(
                    'modal_step_2'
                )
                .setTitle(
                    'Detail Cerita'
                );

        modal.addComponents(

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_bakat'
                    )
                    .setLabel(
                        'Bakat Dominan'
                    )
                    .setStyle(
                        TextInputStyle.Paragraph
                    )
                    .setRequired(true)
            ),

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_kultur'
                    )
                    .setLabel(
                        'Kultur / Latar'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(false)
            ),

            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(
                        'in_ekstra'
                    )
                    .setLabel(
                        'Detail Tambahan'
                    )
                    .setStyle(
                        TextInputStyle.Paragraph
                    )
                    .setRequired(false)
            )
        );

        return interaction.showModal(
            modal
        );
    }

    if (
        interaction.isModalSubmit() &&
        interaction.customId ===
            'modal_step_2'
    ) {

        const session =
            csSessions.get(
                interaction.user.id
            );

        if (!session) {
            return interaction.reply({
                content:
                    '❌ Sesi Character Story telah berakhir.',
                ephemeral: true
            });
        }

        const bakat =
            interaction.fields.getTextInputValue(
                'in_bakat'
            );

        const kultur =
            interaction.fields.getTextInputValue(
                'in_kultur'
            ) ||
            'Tidak disebutkan';

        const ekstra =
            interaction.fields.getTextInputValue(
                'in_ekstra'
            ) ||
            'Tidak ada';

        const data =
            session.data;

        const story =
            `**${data.nama}** adalah seorang ${data.gender.toLowerCase()} ` +
            `yang lahir pada ${data.dob} di ${data.city}. ` +
            `Ia memiliki bakat dominan berupa ${bakat} dan memilih jalan ${session.side}. ` +
            `Dengan level ${data.level}, ia mulai membangun kehidupannya di dunia ${session.server}.\n\n` +

            `Latar belakang ${kultur} membentuk kepribadian dan cara berpikirnya. ` +
            `${data.nama} berusaha menghadapi berbagai tantangan serta membangun hubungan ` +
            `dengan orang-orang di sekitarnya. Detail tambahan: ${ekstra}.\n\n` +

            `Di dunia roleplay, ${data.nama} akan menjalani kehidupan sesuai dengan ` +
            `latar belakang dan pilihan yang telah dibuat. Setiap keputusan akan membentuk ` +
            `perjalanan karakter tersebut.`;

        const finalEmbed =
            new EmbedBuilder()
                .setColor(
                    session.side ===
                        'Good Side'
                        ? '#2ecc71'
                        : '#e74c3c'
                )
                .setTitle(
                    `📄 Character Story: ${data.nama}`
                )
                .setDescription(
                    story.substring(
                        0,
                        4000
                    )
                )
                .addFields(
                    {
                        name: '🌐 Server',
                        value:
                            session.server,
                        inline: true
                    },
                    {
                        name: '🎭 Sisi',
                        value:
                            session.side,
                        inline: true
                    },
                    {
                        name: '📈 Level',
                        value:
                            data.level,
                        inline: true
                    }
                )
                .setFooter({
                    text:
                        'Created by TAMA COMMUNITY'
                })
                .setTimestamp();

        await interaction.reply({
            content:
                `🎉 <@${interaction.user.id}> Character Story berhasil dibuat!`,
            embeds: [finalEmbed]
        });

        csSessions.delete(
            interaction.user.id
        );
    }
});

// =======================
// 🔌 LOGIN
// =======================

client.login(TOKEN);
