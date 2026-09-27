require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { setup } = require("./services/sheets");
const {
  getBalance,
  getRecentTransactions,
  getWalletBalances,
  summary,
  getRows
} = require("./services/transactions");
const { requireOwner } = require("./utils/auth");
const { money } = require("./utils/money");
const { today, clock, greeting } = require("./utils/time");
const { mainMenu } = require("./commands/menu");
const { setupTransactionHandlers, startTransaction } = require("./commands/transaction");
const { setupTogetherHandlers, menu: togetherMenu } = require("./commands/together");
const { setupQuickHandlers } = require("./commands/quick");
const { setupDebtHandlers } = require("./commands/debt");
const { setupAnalysisHandlers } = require("./commands/analysis");
const { setupFinanceHandlers } = require("./commands/finance");
const { setupTransferHandlers } = require("./commands/transfer");
const { setupEditTransactionHandlers } = require("./commands/edit");
const { setupWalletHandlers } = require("./commands/wallet");
const { startReminderScheduler } = require("./services/reminders");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN belum diisi.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

function ownerLabel(owner) {
  return owner === "ZIZI" ? "💗 ZIZI" : "💙 EXCELL";
}

async function sendMenu(msg) {
  const owner = requireOwner(msg.from.id);
  const s = await getBalance(owner);
  const w = await getWalletBalances(owner);
  const nonzero = Object.entries(w)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${key}: ${money(value)}`)
    .join(" • ") || "Belum ada saldo";

  return bot.sendMessage(
    msg.chat.id,
    `${greeting()} ${msg.from.first_name || ""}\n\n` +
    `💙 EXZI FINANCE V9\n` +
    `📅 ${today()} • ${clock()} WIB\n` +
    `👤 ${ownerLabel(owner)}\n\n` +
    `💰 Saldo ${money(s.balance)}\n` +
    `📥 Pemasukan ${money(s.income)}\n` +
    `📤 Pengeluaran ${money(s.expense)}\n` +
    `💳 ${nonzero}\n\n` +
    `Pilih menu:`,
    mainMenu()
  );
}

async function saldo(msg) {
  const owner = requireOwner(msg.from.id);
  const s = await getBalance(owner);
  const w = await getWalletBalances(owner);
  return bot.sendMessage(
    msg.chat.id,
    `💰 SALDO\n\n👤 ${owner}\n\n` +
    `💵 Total ${money(s.balance)}\n` +
    `📥 ${money(s.income)}\n` +
    `📤 ${money(s.expense)}\n` +
    `🏦 Saldo awal ${money(s.openingBalance || 0)}\n\n` +
    `💳 WALLET\n${Object.entries(w).map(([key, value]) => `${key}: ${money(value)}`).join("\n")}`
  );
}

async function laporan(msg) {
  const owner = requireOwner(msg.from.id);
  const s = await summary(owner);
  const rate = s.income ? ((s.balance / s.income) * 100) : 0;
  return bot.sendMessage(
    msg.chat.id,
    `📊 LAPORAN BULAN INI\n\n👤 ${owner}\n` +
    `📥 Pemasukan ${money(s.income)}\n` +
    `📤 Pengeluaran ${money(s.expense)}\n` +
    `💵 Selisih ${money(s.balance)}\n` +
    `📈 Saving rate ${rate.toFixed(1)}%`
  );
}

async function hariini(msg) {
  const owner = requireOwner(msg.from.id);
  const data = (await getRows(owner)).filter(x => x.date === today());
  if (!data.length) return bot.sendMessage(msg.chat.id, `📅 HARI INI\n\n👤 ${owner}\nBelum ada transaksi.`);

  const income = data.filter(x => x.type === "PEMASUKAN").reduce((s, x) => s + x.amount, 0);
  const expense = data.filter(x => x.type === "PENGELUARAN").reduce((s, x) => s + x.amount, 0);
  return bot.sendMessage(
    msg.chat.id,
    `📅 HARI INI\n\n👤 ${owner}\n\n` +
    data.slice().reverse().map((x, i) => `${i + 1}. ${x.type} • ${x.category}\n💰 ${money(x.amount)} • ${x.wallet}${x.note ? `\n📝 ${x.note}` : ""}`).join("\n\n") +
    `\n\n📥 ${money(income)}\n📤 ${money(expense)}\n💵 Selisih ${money(income - expense)}`
  );
}

async function riwayat(msg) {
  const owner = requireOwner(msg.from.id);
  const data = await getRecentTransactions(owner, 12);
  if (!data.length) return bot.sendMessage(msg.chat.id, "📜 Belum ada transaksi.");
  const buttons = data.map(x => [{ text: `✏️ ${x.date} • ${money(x.amount)}`, callback_data: `edit_tx_${x.id}` }]);
  buttons.push([{ text: "✏️ Pilih & Edit", callback_data: "edit_open" }, { text: "↩️ Menu", callback_data: "menu" }]);
  return bot.sendMessage(
    msg.chat.id,
    "📜 RIWAYAT\n\n" + data.map((x, i) => `${i + 1}. ${x.date} • ${x.type}\n${x.category} — ${money(x.amount)}\n💳 ${x.wallet}${x.note ? `\n📝 ${x.note}` : ""}`).join("\n\n") + "\n\n✏️ Tekan transaksi untuk edit/hapus.",
    { reply_markup: { inline_keyboard: buttons } }
  );
}

function safe(handler) {
  return async msg => {
    try {
      await handler(msg);
    } catch (e) {
      console.error("HANDLER:", e);
      await bot.sendMessage(msg.chat.id, e.message === "UNAUTHORIZED_USER" ? "❌ Akses ditolak." : "❌ Terjadi error saat memproses permintaan.");
    }
  };
}

bot.onText(/^\/(start|menu)(?:@\w+)?$/, safe(sendMenu));
bot.onText(/^\/saldo(?:@\w+)?$/, safe(saldo));
bot.onText(/^\/laporan(?:@\w+)?$/, safe(laporan));
bot.onText(/^\/riwayat(?:@\w+)?$/, safe(riwayat));
bot.onText(/^\/hariini(?:@\w+)?$/, safe(hariini));

bot.onText(/^\/help(?:@\w+)?$/, m => bot.sendMessage(
  m.chat.id,
  `🤖 EXZI FINANCE V9\n\n` +
  `/start /menu /saldo /wallet\n` +
  `/laporan /hariini /riwayat\n` +
  `/pemasukan /pengeluaran /transfer\n` +
  `/analisis /mingguan\n` +
  `/utang /piutang\n` +
  `/tagihan /tambah_tagihan\n` +
  `/target /tambah_target\n` +
  `/bersama\n` +
  `/edit\n\n` +
  `Smart Input:\n` +
  `makan 25k\n` +
  `bensin 50rb\n` +
  `gaji 5jt\n` +
  `transfer 100k`
));

bot.on("callback_query", async q => {
  if (!q.data || !q.message) return;
  const d = q.data;
  try {
    await bot.answerCallbackQuery(q.id).catch(() => {});
    if (d === "menu" || d === "menu_refresh") return sendMenu({ chat: q.message.chat, from: q.from });
    if (d === "menu_saldo") return saldo({ chat: q.message.chat, from: q.from });
    if (d === "menu_laporan") return laporan({ chat: q.message.chat, from: q.from });
    if (d === "menu_riwayat") return riwayat({ chat: q.message.chat, from: q.from });
    if (d === "menu_analysis") return bot.sendMessage(q.message.chat.id, "📈 Gunakan /analisis atau /mingguan.");
    if (d === "menu_transaksi") return bot.sendMessage(q.message.chat.id, "Pilih:", { reply_markup: { inline_keyboard: [[{ text: "📥 Pemasukan", callback_data: "add_income" }, { text: "📤 Pengeluaran", callback_data: "add_expense" }]] } });
    if (d === "add_income") return startTransaction(bot, { chat: q.message.chat, from: q.from }, "PEMASUKAN");
    if (d === "add_expense") return startTransaction(bot, { chat: q.message.chat, from: q.from }, "PENGELUARAN");
  } catch (e) {
    console.error("CALLBACK CORE:", e);
  }
});

setupTransactionHandlers(bot);
setupQuickHandlers(bot);
setupDebtHandlers(bot);
setupAnalysisHandlers(bot);
setupFinanceHandlers(bot);
setupTransferHandlers(bot);
setupEditTransactionHandlers(bot);
setupTogetherHandlers(bot);
setupWalletHandlers(bot);

bot.on("polling_error", e => console.error("POLLING ERROR:", e.message));
bot.on("error", e => console.error("BOT ERROR:", e.message));

(async () => {
  try {
    await setup();
    console.log("✅ Google Sheets siap.");
    console.log("=====================================");
    console.log(" EXZI FINANCE V9 READY — 24/7");
    console.log("=====================================");
    bot.startPolling();
    startReminderScheduler(bot);
  } catch (e) {
    console.error("❌ STARTUP GAGAL:", e);
    process.exitCode = 1;
  }
})();
