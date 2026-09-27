const { addTransaction } = require("../services/transactions");
const { cleanAmount, money } = require("../utils/money");
const { CATEGORIES, WALLETS } = require("../utils/constants");
const { requireOwner } = require("../utils/auth");
const { begin, get, clear } = require("../utils/session");

function kb(items) {
  return { reply_markup: { inline_keyboard: items } };
}

function startTransaction(bot, msg, type, owner = requireOwner(msg.from.id)) {
  const id = String(msg.chat.id);
  begin(id, "transaction", {
    type,
    step: "amount",
    data: { owner, type }
  });
  return bot.sendMessage(
    msg.chat.id,
    `EXZI FINANCE V9\n\n${type === "PEMASUKAN" ? "📥 PEMASUKAN" : "📤 PENGELUARAN"}\n👤 Pemilik: ${owner}\n\n💰 Masukkan nominal.\nContoh: 25k, 150rb, 1,5jt`,
  );
}

function categoryKeyboard() {
  return kb([
    [{ text: "🍔 Makanan", callback_data: "trx_cat_Makanan" }, { text: "🚗 Transportasi", callback_data: "trx_cat_Transportasi" }],
    [{ text: "🛒 Belanja", callback_data: "trx_cat_Belanja" }, { text: "🏠 Kost", callback_data: "trx_cat_Kost" }],
    [{ text: "📚 Pendidikan", callback_data: "trx_cat_Pendidikan" }, { text: "🎮 Hiburan", callback_data: "trx_cat_Hiburan" }],
    [{ text: "💼 Kerja", callback_data: "trx_cat_Kerja" }, { text: "🧾 Tagihan", callback_data: "trx_cat_Tagihan" }],
    [{ text: "📦 Lainnya", callback_data: "trx_cat_Lainnya" }],
    [{ text: "❌ Batal", callback_data: "trx_cancel" }]
  ]);
}

function walletKeyboard() {
  const rows = [];
  for (let i = 0; i < WALLETS.length; i += 2) {
    rows.push(WALLETS.slice(i, i + 2).map(w => ({ text: w, callback_data: `trx_wallet_${w}` })));
  }
  rows.push([{ text: "❌ Batal", callback_data: "trx_cancel" }]);
  return kb(rows);
}

function setupTransactionHandlers(bot) {
  bot.onText(/^\/(pemasukan|pengeluaran)(?:@\w+)?$/, m => {
    try {
      const owner = requireOwner(m.from.id);
      const type = m.text.toLowerCase().includes("pemasukan") ? "PEMASUKAN" : "PENGELUARAN";
      return start(bot, m, type, owner);
    } catch (e) {
      return bot.sendMessage(m.chat.id, "❌ Akses ditolak.");
    }
  });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;
    const d = q.data;
    const id = String(q.message.chat.id);
    if (d !== "trx_cancel" && !d.startsWith("trx_")) return;
    await bot.answerCallbackQuery(q.id).catch(() => {});

    try {
      const caller = requireOwner(q.from.id);
      if (d === "trx_cancel") {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Transaksi dibatalkan.");
      }
      const s = get(id);
      if (!s || s.kind !== "transaction") return bot.sendMessage(q.message.chat.id, "⚠️ Sesi transaksi tidak ditemukan.");
      if (s.data.owner !== caller) {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Sesi transaksi bukan milik akun kamu.");
      }

      if (d.startsWith("trx_cat_")) {
        const category = d.slice("trx_cat_".length);
        if (!CATEGORIES.includes(category)) return bot.sendMessage(q.message.chat.id, "❌ Kategori tidak valid.");
        s.data.category = category;
        s.step = "wallet";
        return bot.sendMessage(q.message.chat.id, "💳 Pilih wallet:", walletKeyboard());
      }

      if (d.startsWith("trx_wallet_")) {
        const wallet = d.slice("trx_wallet_".length);
        if (!WALLETS.includes(wallet)) return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");
        s.data.wallet = wallet;
        s.step = "note";
        return bot.sendMessage(q.message.chat.id, "📝 Keterangan?\nKetik - jika kosong.");
      }

      if (d === "trx_confirm") {
        if (!s.data.amount || !s.data.category || !s.data.wallet) return bot.sendMessage(q.message.chat.id, "⚠️ Data transaksi belum lengkap.");
        if (s.processing) return bot.sendMessage(q.message.chat.id, "⏳ Transaksi sedang disimpan.");
        s.processing = true;
        const x = { ...s.data };
        try {
          await addTransaction(x);
          clear(id);
          return bot.sendMessage(q.message.chat.id, `✅ TRANSAKSI TERSIMPAN\n\n${x.type}\n👤 ${x.owner}\n💰 ${money(x.amount)}\n📂 ${x.category}\n💳 ${x.wallet}\n📝 ${x.note || "-"}`);
        } catch (e) {
          s.processing = false;
          throw e;
        }
      }
    } catch (e) {
      console.error("TRANSACTION CALLBACK:", e);
      return bot.sendMessage(q.message.chat.id, "❌ Gagal memproses transaksi.");
    }
  });

  bot.on("message", async m => {
    if (!m.text || m.text.startsWith("/")) return;
    const id = String(m.chat.id);
    const s = get(id);
    if (!s || s.kind !== "transaction") return;
    if (s.processing) return;

    try {
      const owner = requireOwner(m.from.id);
      if (s.data.owner !== owner) {
        clear(id);
        return bot.sendMessage(m.chat.id, "❌ Sesi transaksi bukan milik akun kamu.");
      }

      const t = m.text.trim();
      if (s.step === "amount") {
        const amount = cleanAmount(t);
        if (!amount) return bot.sendMessage(m.chat.id, "❌ Nominal tidak valid. Contoh: 25k");
        s.data.amount = amount;
        s.step = "category";
        return bot.sendMessage(m.chat.id, "🏷️ Pilih kategori:", categoryKeyboard());
      }
      if (s.step === "note") {
        s.data.note = t === "-" ? "" : t;
        s.step = "confirm";
        return bot.sendMessage(
          m.chat.id,
          `📋 KONFIRMASI\n\n${s.data.type}\n👤 ${s.data.owner}\n💰 ${money(s.data.amount)}\n📂 ${s.data.category}\n💳 ${s.data.wallet}\n📝 ${s.data.note || "-"}`,
          kb([[{ text: "✅ Simpan", callback_data: "trx_confirm" }, { text: "❌ Batal", callback_data: "trx_cancel" }]])
        );
      }
    } catch (e) {
      console.error("TRANSACTION INPUT:", e);
      clear(id);
      return bot.sendMessage(m.chat.id, "❌ Gagal memproses transaksi.");
    }
  });
}

module.exports = { setupTransactionHandlers, startTransaction };
