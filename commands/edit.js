const { read, update } = require("../services/sheets");
const { requireOwner } = require("../utils/auth");
const { cleanAmount, money } = require("../utils/money");
const { CATEGORIES, WALLETS } = require("../utils/constants");
const { nowJakarta } = require("../utils/time");
const { begin, get, clear } = require("../utils/session");

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function monthFromDate(date) {
  return String(date).slice(0, 7);
}

function isLinkedTransaction(row) {
  const type = String(row[3] || "").toUpperCase();
  const note = String(row[7] || "");
  return type === "TRANSFER" || /\[BERSAMA_BILL:|\[UTANG:|\[TAGIHAN:|\[PAYMENT:|SETTLEMENT:|KAS:/.test(note);
}

async function findOwnTransaction(txId, telegramId) {
  const owner = requireOwner(telegramId);
  const rows = await read("TRANSAKSI");
  if (!rows || rows.length <= 1) return null;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (String(row[0] || "") !== String(txId)) continue;
    if (String(row[2] || "").toUpperCase() !== owner) return null;
    return { rowNumber: i + 1, row };
  }

  return null;
}

function fieldKeyboard() {
  return kb([
    [
      { text: "📅 Tanggal", callback_data: "edit_field_date" },
      { text: "💰 Nominal", callback_data: "edit_field_amount" }
    ],
    [
      { text: "📥/📤 Tipe", callback_data: "edit_field_type" },
      { text: "🏷️ Kategori", callback_data: "edit_field_category" }
    ],
    [
      { text: "💳 Wallet", callback_data: "edit_field_wallet" },
      { text: "📝 Keterangan", callback_data: "edit_field_note" }
    ],
    [
      { text: "✅ Simpan perubahan", callback_data: "edit_save" },
      { text: "🗑️ Hapus", callback_data: "edit_delete" }
    ],
    [{ text: "❌ Batal", callback_data: "edit_cancel" }]
  ]);
}

function typeKeyboard() {
  return kb([
    [
      { text: "📥 PEMASUKAN", callback_data: "edit_type_PEMASUKAN" },
      { text: "📤 PENGELUARAN", callback_data: "edit_type_PENGELUARAN" }
    ],
    [{ text: "↩️ Kembali", callback_data: "edit_back" }]
  ]);
}

function categoryKeyboard() {
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, CATEGORIES.length); j += 1) {
      const c = CATEGORIES[j];
      row.push({ text: c, callback_data: `edit_cat_${c}` });
    }
    buttons.push(row);
  }
  buttons.push([{ text: "↩️ Kembali", callback_data: "edit_back" }]);
  return kb(buttons);
}

function walletKeyboard() {
  const buttons = [];
  for (let i = 0; i < WALLETS.length; i += 2) {
    buttons.push(WALLETS.slice(i, i + 2).map(w => ({
      text: w,
      callback_data: `edit_wallet_${w}`
    })));
  }
  buttons.push([{ text: "↩️ Kembali", callback_data: "edit_back" }]);
  return kb(buttons);
}

function renderPreview(data) {
  return (
    `✏️ EDIT TRANSAKSI\n\n` +
    `📅 ${data.date}\n` +
    `👤 ${data.owner}\n` +
    `${data.type === "PEMASUKAN" ? "📥" : "📤"} ${data.type}\n` +
    `💰 ${money(data.amount)}\n` +
    `🏷️ ${data.category}\n` +
    `💳 ${data.wallet}\n` +
    `📝 ${data.note || "-"}\n\n` +
    `Pilih bagian yang mau diubah:`
  );
}

async function showEdit(bot, chatId, transactionId, telegramId) {
  const found = await findOwnTransaction(transactionId, telegramId);
  if (!found) return bot.sendMessage(chatId, "❌ Transaksi tidak ditemukan atau bukan milik kamu.");

  const row = found.row;
  const type = String(row[3] || "").toUpperCase();

  if (isLinkedTransaction(row)) {
    return bot.sendMessage(
      chatId,
      "🔒 Transaksi terhubung ke fitur khusus (transfer, utang, tagihan, atau BERSAMA) tidak diedit dari menu transaksi biasa agar saldo dan relasinya tetap sinkron. Gunakan menu asal transaksinya."
    );
  }

  begin(String(chatId), "edit_transaction", {
    step: "field",
    rowNumber: found.rowNumber,
    transactionId,
    data: {
      date: String(row[1] || "").slice(0, 10),
      owner: String(row[2] || "").toUpperCase(),
      type,
      amount: Number(row[4]) || 0,
      category: row[5] || "Lainnya",
      wallet: String(row[6] || "UTAMA").toUpperCase(),
      note: row[7] || ""
    }
  });

  return bot.sendMessage(chatId, renderPreview(get(String(chatId)).data), fieldKeyboard());
}

async function setupEditTransactionHandlers(bot) {
  bot.onText(/^\/(edit|edittransaksi)(?:@\w+)?$/, async msg => {
    try {
      requireOwner(msg.from.id);
      const rows = await read("TRANSAKSI");
      const owner = requireOwner(msg.from.id);
      const items = (rows || [])
        .slice(1)
        .map((row, i) => ({ rowNumber: i + 2, row }))
        .filter(item => String(item.row[2] || "").toUpperCase() === owner)
        .slice(-12)
        .reverse();

      if (!items.length) return bot.sendMessage(msg.chat.id, "📜 Belum ada transaksi untuk diedit.");

      const buttons = items.map(item => {
        const r = item.row;
        const id = String(r[0] || "");
        const type = String(r[3] || "").toUpperCase();
        return [{
          text: `${type === "PEMASUKAN" ? "📥" : type === "PENGELUARAN" ? "📤" : "🔄"} ${String(r[1] || "").slice(0, 10)} • ${money(r[4])}`,
          callback_data: `edit_tx_${id}`
        }];
      });
      buttons.push([{ text: "↩️ Menu", callback_data: "menu" }]);
      return bot.sendMessage(msg.chat.id, "✏️ PILIH TRANSAKSI YANG MAU DIEDIT:", kb(buttons));
    } catch (e) {
      return bot.sendMessage(msg.chat.id, "❌ Akses ditolak.");
    }
  });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;
    const d = q.data;
    if (!d.startsWith("edit_")) return;

    await bot.answerCallbackQuery(q.id).catch(() => {});
    const chatId = String(q.message.chat.id);

    try {
      if (d === "edit_cancel") {
        clear(chatId);
        return bot.sendMessage(q.message.chat.id, "❌ Edit dibatalkan.");
      }

      if (d.startsWith("edit_tx_")) {
        const txId = d.slice("edit_tx_".length);
        return showEdit(bot, q.message.chat.id, txId, q.from.id);
      }

      const s = get(chatId);
      if (!s || s.kind !== "edit_transaction") {
        return bot.sendMessage(q.message.chat.id, "⚠️ Sesi edit tidak ditemukan.");
      }

      if (d === "edit_back") {
        s.step = "field";
        return bot.sendMessage(q.message.chat.id, renderPreview(s.data), fieldKeyboard());
      }

      if (d === "edit_field_date") {
        s.step = "date";
        return bot.sendMessage(q.message.chat.id, `📅 Tanggal sekarang: ${s.data.date}\nKetik tanggal baru YYYY-MM-DD:`);
      }

      if (d === "edit_field_amount") {
        s.step = "amount";
        return bot.sendMessage(q.message.chat.id, `💰 Nominal sekarang: ${money(s.data.amount)}\nKetik nominal baru:`);
      }

      if (d === "edit_field_note") {
        s.step = "note";
        return bot.sendMessage(q.message.chat.id, "📝 Keterangan baru (ketik - untuk kosong):");
      }

      if (d === "edit_field_type") {
        return bot.sendMessage(q.message.chat.id, "Pilih tipe baru:", typeKeyboard());
      }

      if (d.startsWith("edit_type_")) {
        s.data.type = d.slice("edit_type_".length);
        return bot.sendMessage(q.message.chat.id, renderPreview(s.data), fieldKeyboard());
      }

      if (d === "edit_field_category") {
        return bot.sendMessage(q.message.chat.id, "Pilih kategori baru:", categoryKeyboard());
      }

      if (d.startsWith("edit_cat_")) {
        const cat = d.slice("edit_cat_".length);
        if (!CATEGORIES.includes(cat)) return bot.sendMessage(q.message.chat.id, "❌ Kategori tidak valid.");
        s.data.category = cat;
        return bot.sendMessage(q.message.chat.id, renderPreview(s.data), fieldKeyboard());
      }

      if (d === "edit_field_wallet") {
        return bot.sendMessage(q.message.chat.id, "Pilih wallet baru:", walletKeyboard());
      }

      if (d.startsWith("edit_wallet_")) {
        const wallet = d.slice("edit_wallet_".length);
        if (!WALLETS.includes(wallet)) return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");
        s.data.wallet = wallet;
        return bot.sendMessage(q.message.chat.id, renderPreview(s.data), fieldKeyboard());
      }

      if (d === "edit_delete") {
        const found = await findOwnTransaction(s.transactionId, q.from.id);
        if (!found) { clear(chatId); return bot.sendMessage(q.message.chat.id, "❌ Transaksi tidak ditemukan."); }
        if (isLinkedTransaction(found.row)) return bot.sendMessage(q.message.chat.id, "🔒 Transaksi terhubung tidak boleh dihapus dari sini.");
        s.step = "delete_confirm";
        return bot.sendMessage(q.message.chat.id, `⚠️ Hapus transaksi ini?\n\n${renderPreview(s.data)}`, kb([[{ text: "🗑️ Ya, Hapus", callback_data: "edit_confirm_delete" }],[{ text: "↩️ Batal", callback_data: "edit_back" }]]));
      }

      if (d === "edit_confirm_delete") {
        const found = await findOwnTransaction(s.transactionId, q.from.id);
        if (!found || found.rowNumber !== s.rowNumber) { clear(chatId); return bot.sendMessage(q.message.chat.id, "❌ Transaksi sudah berubah atau tidak ditemukan."); }
        if (isLinkedTransaction(found.row)) { clear(chatId); return bot.sendMessage(q.message.chat.id, "🔒 Transaksi terhubung tidak boleh dihapus."); }
        const cols = Array.from({ length: 10 }, () => "");
        await update(`TRANSAKSI!A${s.rowNumber}:J${s.rowNumber}`, [cols]);
        clear(chatId);
        return bot.sendMessage(q.message.chat.id, "✅ TRANSAKSI BERHASIL DIHAPUS.\n\nSaldo, laporan, dan grafik akan otomatis menghitung ulang dari data yang tersisa.");
      }

      if (d === "edit_save") {
        const found = await findOwnTransaction(s.transactionId, q.from.id);
        if (!found || found.rowNumber !== s.rowNumber) {
          clear(chatId);
          return bot.sendMessage(q.message.chat.id, "❌ Transaksi sudah berubah atau tidak ditemukan.");
        }

        if (isLinkedTransaction(found.row)) {
          clear(chatId);
          return bot.sendMessage(q.message.chat.id, "🔒 Transaksi terhubung tidak boleh diedit dari sini.");
        }

        const dta = s.data;
        if (!isValidDate(dta.date)) return bot.sendMessage(q.message.chat.id, "❌ Tanggal tidak valid.");
        if (!Number.isFinite(dta.amount) || dta.amount <= 0) return bot.sendMessage(q.message.chat.id, "❌ Nominal tidak valid.");

        const timestamp = nowJakarta();
        const month = monthFromDate(dta.date);
        const values = [[
          dta.date,
          dta.owner,
          dta.type,
          Math.round(dta.amount),
          dta.category,
          dta.wallet,
          String(dta.note || "").trim().slice(0, 500),
          `=IF(B${s.rowNumber}="","",TEXT(B${s.rowNumber},"yyyy-mm"))`,
          timestamp
        ]];

        await update(`TRANSAKSI!B${s.rowNumber}:J${s.rowNumber}`, values);
        clear(chatId);

        return bot.sendMessage(
          q.message.chat.id,
          `✅ TRANSAKSI BERHASIL DIUPDATE\n\n` +
          `📅 Tanggal: ${dta.date}\n` +
          `👤 ${dta.owner}\n` +
          `${dta.type === "PEMASUKAN" ? "📥" : "📤"} ${dta.type}\n` +
          `💰 ${money(dta.amount)}\n` +
          `🏷️ ${dta.category}\n` +
          `💳 ${dta.wallet}\n` +
          `📊 BULAN otomatis: ${month}\n\n` +
          `Saldo, laporan, dan grafik akan mengikuti tanggal/bulan baru.`
        );
      }
    } catch (e) {
      console.error("EDIT TRANSACTION:", e);
      return bot.sendMessage(q.message.chat.id, "❌ Gagal memproses edit transaksi.");
    }
  });

  bot.on("message", async m => {
    if (!m.text || m.text.startsWith("/")) return;
    const chatId = String(m.chat.id);
    const s = get(chatId);
    if (!s || s.kind !== "edit_transaction") return;

    try {
      if (s.step === "date") {
        const value = m.text.trim();
        if (!isValidDate(value)) return bot.sendMessage(m.chat.id, "❌ Tanggal tidak valid. Gunakan YYYY-MM-DD.");
        s.data.date = value;
        s.step = "field";
        return bot.sendMessage(m.chat.id, renderPreview(s.data), fieldKeyboard());
      }

      if (s.step === "amount") {
        const value = cleanAmount(m.text.trim());
        if (!value) return bot.sendMessage(m.chat.id, "❌ Nominal tidak valid.");
        s.data.amount = value;
        s.step = "field";
        return bot.sendMessage(m.chat.id, renderPreview(s.data), fieldKeyboard());
      }

      if (s.step === "note") {
        s.data.note = m.text.trim() === "-" ? "" : m.text.trim();
        s.step = "field";
        return bot.sendMessage(m.chat.id, renderPreview(s.data), fieldKeyboard());
      }
    } catch (e) {
      console.error("EDIT TEXT:", e);
      clear(chatId);
      return bot.sendMessage(m.chat.id, "❌ Gagal memproses edit.");
    }
  });
}

module.exports = { setupEditTransactionHandlers };
