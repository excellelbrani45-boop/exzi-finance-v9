const { read, getConfigMap, setConfig } = require("./sheets");
const { today, nowJakarta } = require("../utils/time");

function diffDays(due, base) {
  const a = Date.parse(`${due}T00:00:00Z`);
  const b = Date.parse(`${base}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((a - b) / 86400000);
}

function ownerChatIds(owner) {
  if (owner === "EXCELL" && process.env.EXCELL_TELEGRAM_ID) return [String(process.env.EXCELL_TELEGRAM_ID)];
  if (owner === "ZIZI" && process.env.ZIZI_TELEGRAM_ID) return [String(process.env.ZIZI_TELEGRAM_ID)];
  if (owner === "BERSAMA") {
    return [process.env.EXCELL_TELEGRAM_ID, process.env.ZIZI_TELEGRAM_ID].filter(Boolean).map(String);
  }
  return [];
}

function bucket(days) {
  if (days < 0) return "TERLAMBAT";
  if (days === 0) return "HARI_INI";
  if (days === 1) return "BESOK";
  if (days === 3) return "3_HARI";
  return "";
}

function moneyShort(n) {
  return `Rp${Math.max(0, Number(n) || 0).toLocaleString("id-ID")}`;
}

async function runReminders(bot) {
  const base = today();
  const [tagihanRows, debtRows, config] = await Promise.all([
    read("TAGIHAN"),
    read("UTANG"),
    getConfigMap()
  ]);
  const pendingConfig = [];
  const candidates = [];

  for (const r of tagihanRows.slice(1)) {
    const owner = String(r[1] || "").toUpperCase();
    const due = String(r[4] || "").slice(0, 10);
    const status = String(r[5] || "").toUpperCase();
    const total = Number(r[3]) || 0;
    const paid = Number(r[8]) || 0;
    if (!owner || !due || ["LUNAS", "SELESAI"].includes(status) || total <= paid) continue;
    const days = diffDays(due, base);
    const b = bucket(days);
    if (!b) continue;
    const id = String(r[0] || `${owner}:${r[2] || "Tagihan"}:${due}`);
    const key = `REMINDER|TAGIHAN|${id}|${base}|${b}`;
    if (config.has(key)) continue;
    candidates.push({
      owner,
      key,
      text: `${days < 0 ? "🚨 TAGIHAN TERLAMBAT" : days === 0 ? "🔔 TAGIHAN JATUH TEMPO HARI INI" : days === 1 ? "🔔 TAGIHAN BESOK" : "🔔 TAGIHAN 3 HARI LAGI"}\n\n👤 ${owner}\n🧾 ${r[2] || "Tagihan"}\n💰 Sisa ${moneyShort(total - paid)}\n📅 ${due}`
    });
  }

  for (const r of debtRows.slice(1)) {
    const owner = String(r[2] || "").toUpperCase();
    const due = String(r[6] || "").slice(0, 10);
    const status = String(r[7] || "").toUpperCase();
    const total = Number(r[5]) || 0;
    const paid = Number(r[9]) || 0;
    if (!owner || !due || ["LUNAS", "SELESAI"].includes(status) || total <= paid) continue;
    const days = diffDays(due, base);
    const b = bucket(days);
    if (!b) continue;
    const id = String(r[0] || `${owner}:${r[3] || "Utang"}:${due}`);
    const key = `REMINDER|UTANG|${id}|${base}|${b}`;
    if (config.has(key)) continue;
    const jenis = String(r[4] || "").toUpperCase() === "PIUTANG" ? "Piutang" : "Utang";
    candidates.push({
      owner,
      key,
      text: `${days < 0 ? "🚨 UTANG TERLAMBAT" : days === 0 ? "🔔 UTANG JATUH TEMPO HARI INI" : days === 1 ? "🔔 UTANG BESOK" : "🔔 UTANG 3 HARI LAGI"}\n\n👤 ${owner}\n🏷️ ${r[3] || "Utang"}\n📌 ${jenis}\n💰 Sisa ${moneyShort(total - paid)}\n📅 ${due}`
    });
  }

  let sent = 0;
  for (const item of candidates) {
    const chats = ownerChatIds(item.owner);
    for (const chatId of chats) {
      try {
        await bot.sendMessage(chatId, item.text);
        sent += 1;
      } catch (error) {
        console.error("REMINDER SEND:", error.message);
      }
    }
    if (chats.length) pendingConfig.push(item.key);
  }

  for (const key of pendingConfig) {
    config.set(key, nowJakarta());
    await setConfig(key, nowJakarta());
  }

  return { candidates: candidates.length, sent, date: base };
}

function startReminderScheduler(bot) {
  const run = () => runReminders(bot).catch(error => console.error("REMINDER JOB:", error.message));
  run();
  const timer = setInterval(run, 15 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

module.exports = { runReminders, startReminderScheduler };
