const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');
const path = require('path');

// ================= EXPRESS SERVER =================
const app = express();
app.get('/', (req, res) => res.send('Bot is running...'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Web server running on port ${PORT}`);
});

// ================= DISCORD CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const SCAN_CHANNEL_ID = "1477131305765572618";
const AI_CHANNEL_ID   = "1475164217115021475";

const allowedExtensions = [
  ".lua",
  ".zip",
  ".txt",
  ".7z",
  ".exe",
  ".rar"
];

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= SMART ANALYZE FUNCTION =================
function analyze(content) {

  let riskScore = 0;
  let details = [];

  // ✅ Whitelist WeAreDevs
  const weAreDevsPattern =
    /--\[\[\s*v\d+\.\d+\.\d+\s+https:\/\/wearedevs\.net\/obfuscator\s*\]\]/i;

  if (weAreDevsPattern.test(content)) {
    return {
      risk: 0,
      status: "Aman",
      color: 0x2ecc71,
      detail: "Obfuscator WeAreDevs terdeteksi (Whitelist Aman)"
    };
  }

  // 🔴 Webhook Discord
  const discordWebhook =
    /https?:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g;

  if (discordWebhook.test(content)) {
    return {
      risk: 95,
      status: "Bahaya",
      color: 0xe74c3c,
      detail: "Webhook Discord VALID terdeteksi"
    };
  }

  // 🔴 Telegram Bot
  const telegramBot =
    /https?:\/\/api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+/g;

  if (telegramBot.test(content)) {
    return {
      risk: 95,
      status: "Bahaya",
      color: 0xe74c3c,
      detail: "Bot Telegram VALID terdeteksi"
    };
  }

  // 🟡 Keylogger / Remote Suspicious Patterns
  const suspiciousPatterns = [
    { pattern: /onClientKey/i, name: "onClientKey event" },
    { pattern: /getKeyState/i, name: "getKeyState usage" },
    { pattern: /addEventHandler\s*\(\s*["']onClient/i, name: "Client Event Handler" },
    { pattern: /triggerServerEvent/i, name: "triggerServerEvent" },
    { pattern: /fetchRemote/i, name: "fetchRemote request" },
    { pattern: /performHttpRequest/i, name: "HTTP request function" },
    { pattern: /socket\.http/i, name: "socket.http usage" }
  ];

  suspiciousPatterns.forEach(item => {
    if (item.pattern.test(content)) {
      riskScore += 10;
      details.push(item.name);
    }
  });

  if (riskScore >= 20) {
    return {
      risk: Math.min(riskScore, 85),
      status: "Mencurigakan",
      color: 0xf1c40f,
      detail: "Pola mencurigakan: " + details.join(", ")
    };
  }

  return {
    risk: 0,
    status: "Aman",
    color: 0x2ecc71,
    detail: "Tidak ditemukan pola mencurigakan"
  };
}

// ================= MESSAGE EVENT =================
client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  // ================= SCAN CHANNEL =================
  if (message.channel.id === SCAN_CHANNEL_ID) {

    if (!message.attachments.size) return;

    const attachment = message.attachments.first();
    const fileName = attachment.name;
    const fileExt = path.extname(fileName).toLowerCase();

    // ❌ File tidak diizinkan
    if (!allowedExtensions.includes(fileExt)) {

      const warningEmbed = new EmbedBuilder()
        .setTitle("⚠️ File Tidak Diizinkan")
        .setColor(0xf1c40f)
        .setDescription(
          `Ekstensi **${fileExt}** tidak diperbolehkan.\n\n` +
          `File yang diizinkan:\n${allowedExtensions.join(", ")}`
        )
        .setTimestamp();

      return message.reply({ embeds: [warningEmbed] });
    }

    try {

      const response = await axios.get(attachment.url, {
        responseType: 'arraybuffer'
      });

      const content = Buffer.from(response.data).toString('utf8');
      const result = analyze(content);

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Hasil Analisis Keamanan')
        .setColor(result.color)
        .addFields(
          { name: '👤 Pengguna', value: `${message.author}`, inline: false },
          { name: '📄 Nama File', value: fileName, inline: false },
          { name: '📊 Status', value: result.status, inline: false },
          { name: '⚠️ Tingkat Risiko', value: `${result.risk}%`, inline: false },
          { name: '🔎 Detail Deteksi', value: result.detail, inline: false }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await message.reply("❌ Gagal memproses file.");
    }
  }

  // ================= AI CHANNEL =================
  if (message.channel.id === AI_CHANNEL_ID) {

    if (!message.content) return;

    const embed = new EmbedBuilder()
      .setTitle('🤖 AI Response')
      .setColor(0x3498db)
      .setDescription("AI Mode aktif.")
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }

});

client.login(process.env.TOKEN);
