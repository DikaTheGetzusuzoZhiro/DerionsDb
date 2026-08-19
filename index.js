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

// =======================
// ⚙️ INITIALIZATION & ENV
// =======================

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

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

const rest = new REST({ version: '10' }).setToken(TOKEN);

// =======================
// 🔒 CONFIGURATION
// =======================

const scannerChannelId = "1492337144021385336";
const welcomeChannelId = "1464775422913941568";
const staffRoleId = "1466470849266848009";
const autoRoleId = "1464778755372486717"; // Role otomatis saat join

const allowedExtensions = [".lua", ".txt", ".zip", ".7z"];

const WELCOME_BG_URL = "https://cdn.discordapp.com/attachments/1464926536045170872/1530300153322278922/how-to-make-gif-for-discord-4.gif?ex=6a651294&is=6a63c114&hm=3ee98a6905a0e3a5c9fcf5b92bc83a832fc9e916878ab27b2d647f4dc97393b6&";

const severityWeight = { 1: 8, 2: 18, 3: 30, 4: 50, 5: 100 };
const detectionPatterns = [
  { regex: /discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/i, desc: "Link Discord Webhook", sev: 5 },
  { regex: /api.telegram.org\/bot/i, desc: "Link API Telegram Bot", sev: 5 },
  { regex: /\b(password|username|webhook|telegram)\b/i, desc: "Kata Kunci Pencurian Data", sev: 5 },
  { regex: /\bsampGetPlayer(?:Nickname|Name)\b/i, desc: "Fungsi Pencurian Nama Player", sev: 5 },
  { regex: /\b(?:os\.execute|exec|io\.popen)\b/i, desc: "Eksekusi Command OS", sev: 4 },
  { regex: /\b(?:loadstring|loadfile|dofile|load)\b\s*\(/i, desc: "Eksekusi Kode Dinamis", sev: 4 },
  { regex: /moonsec|protected with moonsec/i, desc: "MoonSec protection (Obfuscator)", sev: 3 },
  { regex: /luaobfuscator|obfuscate|anti[- ]debug/i, desc: "Obfuscation / Anti-Debug", sev: 3 },
  { regex: /require\s*\(\s*['"]socket['"]\s*\)/i, desc: "Koneksi Jaringan Socket", sev: 3 },
  { regex: /(?:[A-Za-z0-9+/]{100,}={0,2})/, desc: "Base64 Encoded Blob", sev: 3 },
  { regex: /loadstring/i, desc: "Loadstring Keyword", sev: 1 }
];

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
        { name: '🎮 Utilitas', value: '!panelspam atau /panelspam - Panel spam target keylogger.', inline: false },
        { name: '🤖 Fitur Otomatis', value: '📁 Cek Keylogger - Kirim file ke channel scanner.\n📢 Anti Link Discord - Otomatis hapus link Discord.', inline: false },
        { name: '🔒 Khusus Staff', value: '/upload - Rilis script.\n/ban, /kick, /timeout, /clear, /clearall - Moderasi server.\n/status - Cek ping & sistem.\n/welcome - Nyalakan/matikan welcome.', inline: false }
      )
      .setFooter({ text: 'Tama Community System', iconURL: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' })
      .setTimestamp()]
  }),
  status: (client) => ({
    embeds: [new EmbedBuilder()
      .setColor('#2ecc71')
      .setTitle('📊 Metrik & Status Operasional Server')
      .addFields(
        { name: '📡 Ping:', value: `${client ? client.ws.ping : 0}ms 🟢`, inline: true },
        { name: '🤖 Core:', value: '🟢 Online', inline: true }
      )
      .setFooter({ text: 'Tama Community System' })
      .setTimestamp()]
  }),
  panelspam: () => ({
    embeds: [new EmbedBuilder()
      .setTitle('💣 Panel Spam Target Keylogger')
      .setColor('#e74c3c')
      .setDescription('Panel Spam Webhook & Telegram\nFitur untuk membanjiri target pembuat keylogger.')
      .setFooter({ text: 'Created By TAMA COMMUNITY' })],
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
  })
};

// =======================
// 📜 SLASH COMMANDS REGISTRATION
// =======================

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Tampilkan menu bantuan bot'),
  new SlashCommandBuilder().setName('panelspam').setDescription('Tampilkan panel spam target keylogger'),
  new SlashCommandBuilder().setName('status').setDescription('Cek status bot'),
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

  // SCANNER CHANNEL
  if (message.channel.id === scannerChannelId && message.attachments.size > 0) {
    const attachment = message.attachments.first();
    const fileName = attachment.name.toLowerCase();
    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isAllowed) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle("⚠️ Format File Tidak Didukung")
          .setColor(0xff0000)
          .setDescription("Hanya: .lua, .txt, .zip, .7z")
          .setTimestamp()]
      });
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
        .setFooter({ text: "Deteksi by TAMA COMMUNITY" })
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
    if (commandName === 'status') return interaction.reply(payloads.status(client));

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
          .setFooter({ text: `@Tama Community | ${new Date().toLocaleDateString('id-ID')}` });
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
      const modal = new ModalBuilder()
        .setCustomId('modal_set_webhook')
        .setTitle('Set Target Webhook');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('in_webhook_url')
            .setLabel('Link Webhook Discord')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('in_webhook_msg')
            .setLabel('Pesan Spam')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue('WEBHOOK INI TELAH DIHANCURKAN OLEH TAMA COMMUNITY ANTI KEYLOGGER!')
        )
      );
      return interaction.showModal(modal);
    }

    if (interaction.customId === 'spam_set_tele') {
      const modal = new ModalBuilder()
        .setCustomId('modal_set_tele')
        .setTitle('Set Target Telegram');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('in_tele_token')
            .setLabel('Bot Token Target')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('in_tele_chatid')
            .setLabel('Chat ID Target')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('in_tele_msg')
            .setLabel('Pesan Spam')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue('BOT INI TELAH DIHANCURKAN OLEH TAMA COMMUNITY ANTI KEYLOGGER!')
        )
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
      spamConfigs.set(interaction.user.id, {
        type: 'webhook',
        url: interaction.fields.getTextInputValue('in_webhook_url'),
        msg: interaction.fields.getTextInputValue('in_webhook_msg')
      });
      return interaction.reply({ content: '✅ Target Webhook disetel!', ephemeral: true });
    }
    if (interaction.customId === 'modal_set_tele') {
      spamConfigs.set(interaction.user.id, {
        type: 'telegram',
        token: interaction.fields.getTextInputValue('in_tele_token'),
        chatId: interaction.fields.getTextInputValue('in_tele_chatid'),
        msg: interaction.fields.getTextInputValue('in_tele_msg')
      });
      return interaction.reply({ content: '✅ Target Telegram disetel!', ephemeral: true });
    }
  }
});

client.login(TOKEN);
