const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');

const app = express();
app.get('/', (req, res) => res.send('Bot is running...'));
app.listen(3000, () => console.log('Web server running'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ================= ANALYZE FUNCTION =================
function analyze(content) {

  // ✅ Whitelist WeAreDevs
  const weAreDevsPattern =
    /--\[\[\s*v\d+\.\d+\.\d+\s+https:\/\/wearedevs\.net\/obfuscator\s*\]\]/i;

  if (weAreDevsPattern.test(content)) {
    return {
      risk: 0,
      status: "Aman",
      color: 0x2ecc71,
      detail: "Tidak ditemukan pola mencurigakan dalam file"
    };
  }

  // 🔴 Discord Webhook VALID
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

  // 🔴 Telegram Bot VALID
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

  // 🟡 Default Mencurigakan ringan (opsional)
  if (content.length > 200000) {
    return {
      risk: 50,
      status: "Mencurigakan",
      color: 0xf1c40f,
      detail: "Ukuran file cukup besar, periksa manual disarankan"
    };
  }

  // 🟢 Aman Default
  return {
    risk: 0,
    status: "Aman",
    color: 0x2ecc71,
    detail: "Tidak ditemukan pola mencurigakan dalam file"
  };
}
// ====================================================

client.on('messageCreate', async (message) => {

  if (message.author.bot) return;
  if (!message.attachments.size) return;

  const attachment = message.attachments.first();
  const fileName = attachment.name;
  const fileSize = (attachment.size / 1024).toFixed(2);

  try {
    const response = await axios.get(attachment.url);
    const content = response.data.toString();

    const result = analyze(content);

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Hasil Analisis Keamanan')
      .setColor(result.color)
      .addFields(
        { name: '👤 Pengguna', value: `${message.author}`, inline: false },
        { name: '📄 Nama File', value: fileName, inline: false },
        { name: '📦 Ukuran File', value: `${fileSize} KB`, inline: false },
        { name: '📊 Status', value: result.status, inline: false },
        { name: '⚠️ Tingkat Risiko', value: `${result.risk}%`, inline: false },
        { name: '🔎 Detail Deteksi', value: result.detail, inline: false }
      )
      .setFooter({ text: 'Tatang Bot • Advanced Security Scanner' })
      .setTimestamp();

    message.reply({ embeds: [embed] });

  } catch (error) {
    console.error(error);
    message.reply("❌ Gagal memproses file.");
  }

});

client.login(process.env.TOKEN);
