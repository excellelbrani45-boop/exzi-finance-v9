const crypto = require("crypto");
const { read, append, update } = require("../services/sheets");
const { getWalletBalances, getWalletOpeningBalances } = require("../services/transactions");
const { cleanAmount, money } = require("../utils/money");
const { WALLETS } = require("../utils/constants");
const { requireOwner } = require("../utils/auth");
const { begin, get, clear } = require("../utils/session");

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function walletKeyboard() {
  const rows = [];
  for (let i = 0; i < WALLETS.length; i += 2) {
    rows.push(WALLETS.slice(i, i + 2).map(wallet => ({
      text: wallet,
      callback_data: `wallet_opening_${wallet}`
    })));
  }
  rows.push([{ text: "❌ Batal", callback_data: "wallet_cancel" }]);
  return kb(rows);
}

function formatBalanceLine(wallet, balance, opening) {
  const extra = opening ? ` (awal ${money(opening)})` : "";
  return `${wallet}: ${money(balance)}${extra}`;
}

async function showWallet(bot, msg) {
  const owner = requireOwner(msg.from.id);
  const [balances, opening] = await Promise.all([
    getWalletBalances(owner),
    getWalletOpeningBalances(owner)
  ]);
  const lines = Object.keys(balances).map(wallet =>
    formatBalanceLine(wallet, balances[wallet], opening[wallet])
  );

  return bot.sendMessage(
    msg.chat.id,
    `💳 WALLET ${owner}\n\n${lines.join("\n")}\n\nSaldo = saldo awal + pemasukan − pengeluaran ± transfer.`,
    kb([
      [{ text: "⚙️ Atur Saldo Awal", callback_data: "wallet_opening" }],
      [{ text: "↩️ Menu", callback_data: "menu" }]
    ])
  );
}

async function saveOpening(owner, wallet, amount) {
  const rows = await read("WALLET");
  const normalized = String(wallet).toUpperCase();
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (
      String(r[1] || "").toUpperCase() === owner &&
      String(r[2] || "").toUpperCase() === normalized
    ) {
      await update(`WALLET!D${i + 1}:E${i + 1}`, [[amount, r[4] || ""]]);
      return { updated: true, row: i + 1 };
    }
  }

  await append("WALLET", [
    crypto.randomUUID(),
    owner,
    normalized,
    amount,
    "Saldo awal"
  ]);
  return { updated: false };
}

function setupWalletHandlers(bot) {
  bot.onText(/^\/wallet(?:@\w+)?$/, async msg => {
    try {
      await showWallet(bot, msg);
    } catch (e) {
      console.error("WALLET:", e);
      await bot.sendMessage(msg.chat.id, e.message === "UNAUTHORIZED_USER" ? "❌ Akses ditolak." : "❌ Gagal membaca wallet.");
    }
  });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;
    const d = q.data;
    if (!(d === "wallet_opening" || d.startsWith("wallet_opening_") || d === "wallet_cancel")) return;
    await bot.answerCallbackQuery(q.id).catch(() => {});
    const id = String(q.message.chat.id);

    try {
      const owner = requireOwner(q.from.id);
      if (d === "wallet_cancel") {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Dibatalkan.");
      }
      if (d === "wallet_opening") {
        begin(id, "wallet_opening", { step: "wallet", data: { owner } });
        return bot.sendMessage(q.message.chat.id, "Pilih wallet yang ingin diberi saldo awal:", walletKeyboard());
      }
      const wallet = d.slice("wallet_opening_".length);
      if (!WALLETS.includes(wallet)) return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");
      const s = get(id);
      if (!s || s.kind !== "wallet_opening") return bot.sendMessage(q.message.chat.id, "⚠️ Sesi wallet tidak ditemukan.");
      s.data.wallet = wallet;
      s.step = "amount";
      return bot.sendMessage(q.message.chat.id, `💳 ${wallet}\nMasukkan saldo awal (boleh 0). Contoh: 500k`);
    } catch (e) {
      console.error("WALLET CALLBACK:", e);
      return bot.sendMessage(q.message.chat.id, "❌ Gagal memproses wallet.");
    }
  });

  bot.on("message", async msg => {
    if (!msg.text || msg.text.startsWith("/")) return;
    const id = String(msg.chat.id);
    const s = get(id);
    if (!s || s.kind !== "wallet_opening" || s.step !== "amount") return;

    try {
      const raw = msg.text.trim();
      const amount = raw === "0" ? 0 : cleanAmount(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        return bot.sendMessage(msg.chat.id, "❌ Saldo awal tidak valid. Contoh: 500000");
      }
      const owner = requireOwner(msg.from.id);
      const wallet = s.data.wallet;
      await saveOpening(owner, wallet, Math.round(amount));
      clear(id);
      const balances = await getWalletBalances(owner);
      return bot.sendMessage(
        msg.chat.id,
        `✅ SALDO AWAL TERSIMPAN\n\n👤 ${owner}\n💳 ${wallet}\n💰 Saldo awal: ${money(amount)}\n📊 Saldo sekarang: ${money(balances[wallet] || 0)}`,
        kb([[{ text: "💳 Lihat Wallet", callback_data: "wallet_refresh" }], [{ text: "↩️ Menu", callback_data: "menu" }]])
      );
    } catch (e) {
      console.error("WALLET INPUT:", e);
      clear(id);
      return bot.sendMessage(msg.chat.id, "❌ Gagal menyimpan saldo awal.");
    }
  });

  bot.on("callback_query", async q => {
    if (!q.data || q.data !== "wallet_refresh") return;
    await bot.answerCallbackQuery(q.id).catch(() => {});
    try {
      await showWallet(bot, { chat: q.message.chat, from: q.from });
    } catch (e) {
      await bot.sendMessage(q.message.chat.id, "❌ Gagal membaca wallet.");
    }
  });
}

module.exports = { setupWalletHandlers, showWallet };
