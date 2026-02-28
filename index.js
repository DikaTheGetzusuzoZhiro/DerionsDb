const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder 
} = require('discord.js');

const express = require('express');
const axios = require('axios');

// ================= WEB SERVER (Railway Keep Alive) =================
const app = express();
app.get('/', (req, res) => res.send('Bot is running...'));
app.listen(3000, () => console.log('Web server running'));

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

// ================= READY EVENT (FIXED) =================
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
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

  // 🟢 Default Aman
  return {
    risk: 0,
    status: "Aman",
    color: 0x2ecc71,
    detail: "Tidak ditemukan pola mencurigakan dalam file"
  };
}
// =====================================================


// ================= MESSAGE EVENT =================
client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  // ================= SCAN CHANNEL =================
  if (message.channel.id === SCAN_CHANNEL_ID) {

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

    } catch (err) {
      console.error(err);
      message.reply("❌ Gagal memproses file.");
    }
  }

  // ================= AI CHANNEL =================
  if (message.channel.id === AI_CHANNEL_ID) {

    if (!message.content) return;

    const embed = new EmbedBuilder()
      .setTitle('🤖 AI Response')
      .setColor(0x3498db)
      .setDescription("AI Mode aktif.\n\nKamu bisa integrasikan OpenAI API di sini.")
      .setFooter({ text: 'Tatang AI System' })
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

});
// ==================================================

client.login(process.env.TOKEN);
