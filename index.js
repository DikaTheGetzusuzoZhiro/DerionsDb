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

/* ===============================
   AI FUNCTION
================================ */
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

    return response.data.response || "AI error 😈";
  } catch {
    return "AI lagi tumbang 😭";
  }
}

/* ===============================
   BERSIHKAN KOMENTAR LUA
================================ */
function removeLuaComments(content) {
  return content
    .replace(/--.*$/gm, "")
    .replace(/--\[\[[\s\S]*?\]\]/g, "");
}

/* ===============================
   DETEKSI NUMERIC OBF (AMAN)
================================ */
function isNumericObf(content) {
  const matches = content.match(/\\\d{2,3}/g);
  return matches && matches.length > 50;
}

/* ===============================
   ANALISIS FILE
================================ */
function analyze(content) {

  const clean = removeLuaComments(content);

  // ✅ WHITELIST WEAREDEVS OBFUSCATOR
  const weAreDevsPattern =
    /v\d+\.\d+\.\d+\s+https:\/\/wearedevs\.net\/obfuscator/gi;

  if (weAreDevsPattern.test(clean)) {
    return {
      risk: 0,
      status: "Aman",
      color: 0x2ecc71,
      detail: "Obfuscated by WeAreDevs (whitelisted)"
    };
  }

  // 🔴 DISCORD WEBHOOK VALID
  const discordWebhook =
    /https?:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g;

  if (discordWebhook.test(clean)) {
    return {
      risk: 95,
      status: "Bahaya",
      color: 0xe74c3c,
      detail: "Webhook Discord VALID terdeteksi!"
    };
  }

  // 🔴 TELEGRAM BOT VALID
  const telegramBot =
    /https?:\/\/api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+/g;

  if (telegramBot.test(clean)) {
    return {
      risk: 95,
      status: "Bahaya",
      color: 0xe74c3c,
      detail: "Bot Telegram VALID terdeteksi!"
    };
  }

  // 🟡 Kombinasi mencurigakan
  const hasHttp = clean.includes("http");
  const hasExec =
    clean.includes("os.execute") ||
    clean.includes("loadstring") ||
    clean.includes("PerformHttpRequest");

  if (hasHttp && hasExec) {
    return {
      risk: 55,
      status: "Mencurigakan",
      color: 0xf1c40f,
      detail: "Kombinasi network + eksekusi terdeteksi"
    };
  }

  // 🟢 Numeric obf dianggap aman
  if (isNumericObf(clean)) {
    return {
      risk: 0,
      status: "Aman",
      color: 0x2ecc71,
      detail: "Numeric obfuscation terdeteksi (normal protection)"
    };
  }

  // 🟢 Default Aman
  return {
    risk: 0,
    status: "Aman",
    color: 0x2ecc71,
    detail: "Tidak ditemukan pola mencurigakan"
  };
}

/* ===============================
   EVENT MESSAGE
================================ */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== AI CHANNEL =====
  if (message.channel.id === AI_CHANNEL) {
    await message.channel.sendTyping();
    const reply = await askAI(message.content);
    return message.reply(reply);
  }

  // ===== SCAN CHANNEL =====
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
      const response = await axios.get(attachment.url, {
        responseType: "arraybuffer"
      });

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
      console.log("ERROR:", err.message);
      message.reply("❌ Gagal memproses file.");
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
});

client.once("ready", () => {
  console.log(`Bot online sebagai ${client.user.tag}`);
});

client.login(TOKEN);
