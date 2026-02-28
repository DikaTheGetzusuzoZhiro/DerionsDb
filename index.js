require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const AdmZip = require("adm-zip");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

const TOKEN = process.env.DISCORD_TOKEN;
const API_KEY = process.env.API_KEY;

const SCAN_CHANNEL = "1469740150522380299";
const AI_CHANNEL = "1475164217115021475";

/* =========================
   PATTERN DETEKSI
========================= */

const dangerPatterns = [
  "discord.com/api/webhooks",
  "discordapp.com/api/webhooks",
  "api.telegram.org",
  "t.me/",
];

const suspiciousPatterns = [
  "http.request",
  "socket.connect",
  "loadstring",
  "os.execute",
  "PerformHttpRequest",
  "SetClipboard",
  "token",
  "getfenv",
  "setfenv"
];

/* =========================
   AI FUNCTION
========================= */

async function askAI(text) {
  try {
    const response = await axios.post(
      "https://apifreellm.com/api/v1/chat",
      {
        message: "Balas dengan gaya toxic lucu tapi bercanda: " + text
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.response || "AI lagi error 😈";
  } catch (err) {
    console.log("AI ERROR:", err.message);
    return "AI lagi tumbang 😭";
  }
}

/* =========================
   ANALISIS FILE
========================= */

function analyze(content) {
  let risk = 0;
  let status = "Aman";
  let color = 0x2ecc71;
  let detail = "Tidak ditemukan pola mencurigakan";

  if (dangerPatterns.some(p => content.includes(p))) {
    risk = 95;
    status = "Bahaya";
    color = 0xe74c3c;
    detail = "Terdeteksi Webhook Discord / Telegram!";
  } else if (suspiciousPatterns.some(p => content.includes(p))) {
    risk = 45;
    status = "Mencurigakan";
    color = 0xf1c40f;
    detail = "Ditemukan fungsi mencurigakan dalam script";
  }

  return { risk, status, color, detail };
}

/* =========================
   EVENT MESSAGE
========================= */

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  /* ===== AI CHANNEL ===== */
  if (message.channel.id === AI_CHANNEL) {
    await message.channel.sendTyping();
    const reply = await askAI(message.content);
    return message.reply(reply);
  }

  /* ===== SCAN CHANNEL ===== */
  if (message.channel.id !== SCAN_CHANNEL) return;

  if (message.attachments.size === 0) return;

  for (const attachment of message.attachments.values()) {

    const allowed = [".lua", ".zip", ".txt", ".7z"];
    const fileName = attachment.name.toLowerCase();

    if (!allowed.some(ext => fileName.endsWith(ext))) {
      return message.reply("⚠️ Kirim hanya file .lua .zip .txt .7z");
    }

    const filePath = `./${Date.now()}_${attachment.name}`;

    try {
      const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
      fs.writeFileSync(filePath, response.data);

      let content = "";

      if (fileName.endsWith(".zip")) {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();

        for (let entry of entries) {
          if (!entry.isDirectory) {
            content += entry.getData().toString("utf8");
          }
        }
      } else {
        content = fs.readFileSync(filePath, "utf8");
      }

      const result = analyze(content);

      fs.unlinkSync(filePath);

      /* ===== EMBED RESULT ===== */

      const embed = new EmbedBuilder()
        .setColor(result.color)
        .setTitle("🛡️ Hasil Analisis Keamanan")
        .addFields(
          { name: "👤 Pengguna", value: `${message.author}`, inline: false },
          { name: "📄 Nama File", value: attachment.name, inline: true },
          { name: "📦 Ukuran File", value: `${(attachment.size / 1024).toFixed(2)} KB`, inline: true },
          { name: "📊 Status", value: result.status, inline: true },
          { name: "⚠️ Tingkat Risiko", value: `${result.risk}%`, inline: true },
          { name: "🔎 Detail Deteksi", value: result.detail, inline: false }
        )
        .setFooter({ text: "Advanced Security Scanner • Tatang Bot" })
        .setTimestamp();

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.log("SCAN ERROR:", err.message);
      message.reply("❌ Gagal memproses file.");
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
});

client.once("ready", () => {
  console.log(`Bot online sebagai ${client.user.tag}`);
});

client.login(TOKEN);
