const { addTransfer } = require("../services/transfers");
const { cleanAmount, money, extractAmount } = require("../utils/money");
const { WALLETS } = require("../utils/constants");
const { requireOwner } = require("../utils/auth");
const { begin, get, clear } = require("../utils/session");

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function walletKeyboard() {
  const rows = [];
  for (let i = 0; i < WALLETS.length; i += 2) {
    rows.push(WALLETS.slice(i, i + 2).map(w => ({
      text: w,
      callback_data: `transfer_wallet_${w}`
    })));
  }
  rows.push([{ text: "❌ Batal", callback_data: "transfer_cancel" }]);
  return kb(rows);
}

async function startTransfer(bot, msg, presetAmount = 0) {
  const owner = requireOwner(msg.from.id);
  begin(String(msg.chat.id), "transfer", {
    owner,
    step: "from",
    data: presetAmount > 0 ? { amount: Math.round(presetAmount) } : {}
  });
  return bot.sendMessage(
    msg.chat.id,
    presetAmount > 0
      ? `🔄 TRANSFER ${money(presetAmount)}\n\nPilih wallet asal:`
      : "🔄 TRANSFER ANTAR WALLET\n\nPilih wallet asal:",
    walletKeyboard()
  );
}

function confirmation(session) {
  return kb([
    [{ text: "✅ Konfirmasi Transfer", callback_data: "transfer_confirm" }],
    [{ text: "❌ Batal", callback_data: "transfer_cancel" }]
  ]);
}

async function setupTransferHandlers(bot) {
  bot.onText(/^\/transfer(?:@\w+)?$/, m => {
    startTransfer(bot, m).catch(e => bot.sendMessage(m.chat.id, e.message === "UNAUTHORIZED_USER" ? "❌ Akses ditolak." : "❌ Gagal memulai transfer."));
  });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;
    const d = q.data;
    if (!(d === "transfer_cancel" || d === "transfer_confirm" || d.startsWith("transfer_wallet_"))) return;

    await bot.answerCallbackQuery(q.id).catch(() => {});
    const id = String(q.message.chat.id);

    try {
      const owner = requireOwner(q.from.id);
      const s = get(id);

      if (d === "transfer_cancel") {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Transfer dibatalkan.");
      }
      if (!s || s.kind !== "transfer" || s.owner !== owner) {
        return bot.sendMessage(q.message.chat.id, "⚠️ Sesi transfer tidak ditemukan atau bukan milik akun kamu.");
      }

      if (d.startsWith("transfer_wallet_")) {
        const w = d.slice("transfer_wallet_".length);
        if (!WALLETS.includes(w)) return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");

        if (s.step === "from") {
          s.data.fromWallet = w;
          s.step = s.data.amount ? "to" : "to";
          return bot.sendMessage(q.message.chat.id, `Dari: ${w}\n\nPilih wallet tujuan:`, walletKeyboard());
        }

        if (s.step === "to") {
          if (w === s.data.fromWallet) return bot.sendMessage(q.message.chat.id, "❌ Wallet tujuan harus berbeda.");
          s.data.toWallet = w;
          if (s.data.amount) {
            return bot.sendMessage(
              q.message.chat.id,
              `📋 KONFIRMASI TRANSFER\n\n${s.data.fromWallet} → ${s.data.toWallet}\n💰 ${money(s.data.amount)}`,
              confirmation(s)
            );
          }
          s.step = "amount";
          return bot.sendMessage(q.message.chat.id, "Masukkan nominal transfer. Contoh: 100k");
        }
      }

      if (d === "transfer_confirm") {
        if (s.step !== "to" || !s.data.fromWallet || !s.data.toWallet || !s.data.amount) {
          return bot.sendMessage(q.message.chat.id, "⚠️ Data transfer belum lengkap.");
        }
        const amount = Number(s.data.amount) || 0;
        if (amount <= 0) return bot.sendMessage(q.message.chat.id, "❌ Nominal transfer tidak valid.");
        const data = { ...s.data };
        s.processing = true;
        try {
          await addTransfer({ owner, ...data, amount });
          clear(id);
          return bot.sendMessage(q.message.chat.id, `✅ TRANSFER BERHASIL\n\n${data.fromWallet} → ${data.toWallet}\n💰 ${money(amount)}`);
        } catch (e) {
          s.processing = false;
          throw e;
        }
      }
    } catch (e) {
      console.error("TRANSFER CALLBACK:", e);
      return bot.sendMessage(q.message.chat.id, e.message === "TRANSFER_INSUFFICIENT" ? "❌ Saldo wallet asal tidak cukup." : "❌ Transfer gagal disimpan.");
    }
  });

  bot.on("message", async m => {
    if (!m.text || m.text.startsWith("/")) return;
    const id = String(m.chat.id);
    const s = get(id);
    if (!s || s.kind !== "transfer" || s.step !== "amount") return;
    if (s.processing) return;

    try {
      const owner = requireOwner(m.from.id);
      if (s.owner !== owner) {
        clear(id);
        return bot.sendMessage(m.chat.id, "❌ Sesi transfer bukan milik akun kamu.");
      }
      const amount = cleanAmount(m.text.trim());
      if (!amount) return bot.sendMessage(m.chat.id, "❌ Nominal tidak valid.");
      s.data.amount = amount;
      s.step = "to";
      return bot.sendMessage(
        m.chat.id,
        `📋 KONFIRMASI TRANSFER\n\n${s.data.fromWallet} → ${s.data.toWallet}\n💰 ${money(amount)}`,
        confirmation(s)
      );
    } catch (e) {
      console.error("TRANSFER INPUT:", e);
      return bot.sendMessage(m.chat.id, e.message === "UNAUTHORIZED_USER" ? "❌ Akses ditolak." : "❌ Gagal memproses transfer.");
    }
  });
}

module.exports = { setupTransferHandlers, startTransfer };
