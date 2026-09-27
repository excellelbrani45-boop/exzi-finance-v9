const crypto = require("crypto");
const { append, read, update } = require("../services/sheets");
const { addTransaction, getWalletBalance } = require("../services/transactions");
const { cleanAmount, money } = require("../utils/money");
const { requireOwner } = require("../utils/auth");
const { today } = require("../utils/time");
const { WALLETS } = require("../utils/constants");
const { begin, get, clear } = require("../utils/session");

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function isPiutang(type) {
  return String(type || "").toUpperCase() === "PIUTANG";
}

function debtTransactionType(type) {
  return isPiutang(type) ? "PEMASUKAN" : "PENGELUARAN";
}

function debtCategory(type) {
  return isPiutang(type) ? "Lainnya" : "Tagihan";
}

function walletKeyboard(prefix = "debt_wallet_") {
  return kb([
    [
      { text: "CASH", callback_data: `${prefix}CASH` },
      { text: "BANK", callback_data: `${prefix}BANK` }
    ],
    [
      { text: "GOPAY", callback_data: `${prefix}GOPAY` },
      { text: "OVO", callback_data: `${prefix}OVO` }
    ],
    [
      { text: "DANA", callback_data: `${prefix}DANA` },
      { text: "SHOPEEPAY", callback_data: `${prefix}SHOPEEPAY` }
    ],
    [
      { text: "LAINNYA", callback_data: `${prefix}LAINNYA` },
      { text: "UTAMA", callback_data: `${prefix}UTAMA` }
    ],
    [{ text: "❌ Batal", callback_data: "debt_cancel" }]
  ]);
}

function menu(bot, id) {
  return bot.sendMessage(
    id,
    "💳 UTANG / PIUTANG",
    kb([
      [
        { text: "➕ Tambah", callback_data: "debt_add" },
        { text: "📋 Aktif", callback_data: "debt_list" }
      ],
      [{ text: "↩️ Menu", callback_data: "menu" }]
    ])
  );
}

function paymentActionText(type) {
  return isPiutang(type) ? "Penerimaan piutang" : "Pembayaran utang";
}

async function findPaymentTransaction(paymentId) {
  if (!paymentId) return null;
  const rows = await read("TRANSAKSI");
  if (!rows || rows.length <= 1) return null;
  const marker = `[PAYMENT:${paymentId}]`;
  for (const row of rows.slice(1)) {
    if (String(row[7] || "").includes(marker)) return row;
  }
  return null;
}

async function findPaymentLog(paymentId) {
  if (!paymentId) return null;
  const rows = await read("UTANG_PEMBAYARAN");
  if (!rows || rows.length <= 1) return null;
  for (const row of rows.slice(1)) {
    if (String(row[8] || "") === String(paymentId)) return row;
  }
  return null;
}

async function getRecordedPaymentTotal(debtId) {
  const rows = await read("TRANSAKSI");
  if (!rows || rows.length <= 1) return 0;
  const prefix = `[UTANG:${debtId}][PAYMENT:`;
  let total = 0;
  for (const row of rows.slice(1)) {
    if (String(row[7] || "").includes(prefix)) total += Number(row[4]) || 0;
  }
  return total;
}

async function getDebtRow(sheetRow) {
  const rows = await read("UTANG");
  const idx = Number(sheetRow) - 1;
  if (!Number.isInteger(idx) || idx <= 0 || idx >= rows.length) return null;
  return rows[idx] || null;
}

async function ensureCallerCanAccessDebt(sheetRow, telegramId) {
  const owner = requireOwner(telegramId);
  const row = await getDebtRow(sheetRow);
  if (!row) throw new Error("DEBT_NOT_FOUND");
  const rowOwner = String(row[2] || "").toUpperCase();
  if (rowOwner !== owner) throw new Error("DEBT_FORBIDDEN");
  return { owner, row };
}

async function setupDebtHandlers(bot) {
  bot.onText(/^\/(utang|piutang)(?:@\w+)?$/, m => {
    try {
      requireOwner(m.from.id);
      return menu(bot, m.chat.id);
    } catch (e) {
      return bot.sendMessage(m.chat.id, "❌ Akses ditolak.");
    }
  });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;

    const d = q.data;
    const id = String(q.message.chat.id);
    if (!(d === "debt" || d.startsWith("debt_"))) return;

    await bot.answerCallbackQuery(q.id).catch(() => {});

    try {
      const caller = requireOwner(q.from.id);

      if (d === "debt") {
        return menu(bot, q.message.chat.id);
      }

      if (d === "debt_add") {
        begin(id, "debt", { step: "pihak", data: { owner: caller } });
        return bot.sendMessage(
          q.message.chat.id,
          `👤 Pemilik: ${caller}\n\nNama pihak? Contoh: Shopee / Teman / Bank`
        );
      }

      if (d === "debt_cancel") {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Dibatalkan.");
      }

      if (d === "debt_list") {
        return list(bot, q.message.chat.id, caller);
      }

      if (d.startsWith("debt_pay_")) {
        const row = d.slice("debt_pay_".length);
        await ensureCallerCanAccessDebt(row, q.from.id);
        begin(id, "debt", {
          step: "payment_amount",
          row,
          data: { paymentId: crypto.randomUUID() }
        });
        return confirmPay(bot, q.message.chat.id, row);
      }

      const s = get(id);
      if (!s || s.kind !== "debt") {
        return bot.sendMessage(q.message.chat.id, "⚠️ Sesi utang tidak ditemukan.");
      }

      // Semua session debt terikat ke caller yang memulainya.
      if (s.data?.owner && s.data.owner !== caller) {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Sesi utang bukan milik akun kamu.");
      }

      if (d.startsWith("debt_retry_wallet_")) {
        const row = d.slice("debt_retry_wallet_".length);
        if (String(s.row) !== String(row)) return bot.sendMessage(q.message.chat.id, "⚠️ Sesi pembayaran sudah tidak berlaku.");
        await ensureCallerCanAccessDebt(row, q.from.id);
        s.step = "payment_wallet";
        return bot.sendMessage(q.message.chat.id, "💳 Pilih wallet lain:", walletKeyboard());
      }

      if (d.startsWith("debt_type_")) {
        const jenis = d.slice("debt_type_".length).toUpperCase();
        if (!["PINJAMAN", "PAYLATER", "CICILAN", "PIUTANG"].includes(jenis)) {
          return bot.sendMessage(q.message.chat.id, "❌ Jenis utang tidak valid.");
        }
        s.data.jenis = jenis;
        s.step = "amount";
        return bot.sendMessage(q.message.chat.id, "Nominal utang/piutang? Contoh: 500k");
      }

      if (d.startsWith("debt_wallet_") && !d.startsWith("debt_wallet_confirm_")) {
        const wallet = d.slice("debt_wallet_".length);
        if (!WALLETS.includes(wallet)) {
          return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");
        }

        s.data.wallet = wallet;
        s.step = "payment_confirm";
        return paymentConfirmation(bot, q.message.chat.id, s.row, s.data);
      }

      if (d.startsWith("debt_confirm_payment_")) {
        const row = d.slice("debt_confirm_payment_".length);
        if (String(s.row) !== String(row)) {
          return bot.sendMessage(q.message.chat.id, "⚠️ Sesi pembayaran sudah tidak berlaku.");
        }
        await ensureCallerCanAccessDebt(row, q.from.id);

        const paymentId = s.data.paymentId;
        const amount = Number(s.data.amount) || 0;
        const wallet = s.data.wallet;
        clear(id);
        return pay(bot, q.message.chat.id, row, amount, wallet, paymentId, caller);
      }
    } catch (error) {
      console.error("DEBT CALLBACK:", error);
      const messages = {
        UNAUTHORIZED_USER: "Akses ditolak.",
        DEBT_FORBIDDEN: "Kamu hanya bisa mengelola utang milik akun kamu.",
        DEBT_NOT_FOUND: "Data utang tidak ditemukan."
      };
      return bot.sendMessage(q.message.chat.id, `❌ ${messages[error.message] || "Gagal memproses utang/piutang."}`);
    }
  });

  bot.on("message", async m => {
    if (!m.text || m.text.startsWith("/")) return;

    const id = String(m.chat.id);
    const s = get(id);
    if (!s || s.kind !== "debt") return;

    const t = m.text.trim();

    try {
      const caller = requireOwner(m.from.id);
      if (s.data?.owner && s.data.owner !== caller) {
        clear(id);
        return bot.sendMessage(m.chat.id, "❌ Sesi utang bukan milik akun kamu.");
      }

      if (s.step === "pihak") {
        if (!t) return bot.sendMessage(m.chat.id, "❌ Nama pihak tidak boleh kosong.");
        s.data.pihak = t.slice(0, 100);
        s.step = "jenis";
        return bot.sendMessage(
          m.chat.id,
          "Jenis:",
          kb([
            [
              { text: "Pinjaman", callback_data: "debt_type_PINJAMAN" },
              { text: "PayLater", callback_data: "debt_type_PAYLATER" }
            ],
            [
              { text: "Cicilan", callback_data: "debt_type_CICILAN" },
              { text: "Piutang", callback_data: "debt_type_PIUTANG" }
            ],
            [{ text: "❌ Batal", callback_data: "debt_cancel" }]
          ])
        );
      }

      if (s.step === "amount") {
        const amount = cleanAmount(t);
        if (!amount) return bot.sendMessage(m.chat.id, "❌ Nominal tidak valid.");
        s.data.nominal = amount;
        s.step = "due";
        return bot.sendMessage(m.chat.id, "Jatuh tempo YYYY-MM-DD (atau -):");
      }

      if (s.step === "due") {
        if (t !== "-" && !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
          return bot.sendMessage(m.chat.id, "❌ Format tanggal salah.");
        }
        s.data.due = t === "-" ? "" : t;
        s.step = "note";
        return bot.sendMessage(m.chat.id, "Keterangan (atau -):");
      }

      if (s.step === "note") {
        s.data.note = t === "-" ? "" : t.slice(0, 500);
        const d = s.data;

        await append("UTANG", [
          crypto.randomUUID(),
          today(),
          d.owner,
          d.pihak,
          d.jenis,
          d.nominal,
          d.due,
          "AKTIF",
          d.note,
          0
        ]);

        clear(id);
        return bot.sendMessage(
          m.chat.id,
          `✅ UTANG/PIUTANG TERCATAT\n\n` +
          `👤 ${d.owner}\n` +
          `🏷️ ${d.pihak}\n` +
          `📌 ${d.jenis}\n` +
          `💰 ${money(d.nominal)}\n` +
          `📅 Jatuh tempo: ${d.due || "-"}\n` +
          `💳 Terbayar: ${money(0)}`
        );
      }

      if (s.step === "payment_amount") {
        const amount = cleanAmount(t);
        await ensureCallerCanAccessDebt(s.row, m.from.id);
        const rows = await read("UTANG");
        const idx = Number(s.row) - 1;
        const row = rows[idx];

        if (!row) {
          clear(id);
          return bot.sendMessage(m.chat.id, "❌ Data utang tidak ditemukan.");
        }

        const total = Number(row[5]) || 0;
        const paid = Number(row[9]) || 0;
        const remaining = Math.max(0, total - paid);

        if (!amount || amount > remaining) {
          return bot.sendMessage(m.chat.id, `❌ Nominal pembayaran tidak valid.\nSisa: ${money(remaining)}`);
        }

        s.data.amount = amount;
        s.data.paymentId = s.data.paymentId || crypto.randomUUID();
        s.step = "payment_wallet";
        return bot.sendMessage(
          m.chat.id,
          `${paymentActionText(row[4])}: ${money(amount)}\n\nPilih wallet yang digunakan:`,
          walletKeyboard()
        );
      }
    } catch (error) {
      console.error("DEBT TEXT:", error);
      clear(id);
      return bot.sendMessage(m.chat.id, "❌ Gagal memproses utang/piutang.");
    }
  });
}

async function list(bot, chatId, owner) {
  const rows = await read("UTANG");
  if (!rows || rows.length <= 1) {
    return bot.sendMessage(chatId, "💳 Belum ada utang/piutang.");
  }

  const active = rows
    .slice(1)
    .map((row, i) => ({ row: i + 2, data: row }))
    .filter(item => {
      const r = item.data;
      const rowOwner = String(r[2] || "").toUpperCase();
      const status = String(r[7] || "").toUpperCase();
      return rowOwner === owner && ["AKTIF", "SEBAGIAN", "BELUM LUNAS"].includes(status);
    });

  if (!active.length) {
    return bot.sendMessage(chatId, "💳 Tidak ada utang/piutang aktif.");
  }

  const text = active.map((item, i) => {
    const r = item.data;
    const total = Number(r[5]) || 0;
    const paid = Number(r[9]) || 0;
    const remaining = Math.max(0, total - paid);
    const action = isPiutang(r[4]) ? "Masuk" : "Keluar";
    return (
      `${i + 1}. ${r[3] || "-"}\n` +
      `   ${r[2] || "-"} • ${r[4] || "-"}\n` +
      `   💰 Sisa ${money(remaining)} / ${money(total)}\n` +
      `   📅 ${r[6] || "-"}\n` +
      `   💸 Arus kas: ${action}\n` +
      `   Status: ${r[7] || "AKTIF"}`
    );
  }).join("\n\n");

  const buttons = active.map(item => {
    const r = item.data;
    const total = Number(r[5]) || 0;
    const paid = Number(r[9]) || 0;
    const remaining = Math.max(0, total - paid);
    const label = isPiutang(r[4]) ? "Terima" : "Bayar";
    return [{ text: `${label} ${money(remaining)}`, callback_data: `debt_pay_${item.row}` }];
  });

  buttons.push([{ text: "↩️ Menu", callback_data: "menu" }]);
  return bot.sendMessage(chatId, `💳 UTANG / PIUTANG AKTIF\n\n${text}`, kb(buttons));
}

async function confirmPay(bot, chatId, sheetRow) {
  const row = await getDebtRow(sheetRow);
  if (!row) return bot.sendMessage(chatId, "❌ Data tidak ditemukan.");

  const total = Number(row[5]) || 0;
  const paid = Number(row[9]) || 0;
  const remaining = Math.max(0, total - paid);
  if (remaining <= 0 || String(row[7] || "").toUpperCase() === "LUNAS") {
    return bot.sendMessage(chatId, "✅ Data ini sudah lunas.");
  }

  return bot.sendMessage(
    chatId,
    `${paymentActionText(row[4])}: ${row[3] || "-"}\n` +
    `Total: ${money(total)}\n` +
    `Terbayar: ${money(paid)}\n` +
    `Sisa: ${money(remaining)}\n\n` +
    `Masukkan nominal. Contoh: 100k`
  );
}

async function paymentConfirmation(bot, chatId, sheetRow, data) {
  const row = await getDebtRow(sheetRow);
  if (!row) {
    clear(chatId);
    return bot.sendMessage(chatId, "❌ Data tidak ditemukan.");
  }

  const total = Number(row[5]) || 0;
  const paid = Number(row[9]) || 0;
  const remaining = Math.max(0, total - paid);
  const amount = Number(data.amount) || 0;
  const projected = Math.max(0, remaining - amount);
  const type = debtTransactionType(row[4]);
  const currentWallet = await getWalletBalance(row[2], data.wallet);

  if (amount <= 0 || amount > remaining) {
    return bot.sendMessage(chatId, `❌ Nominal pembayaran tidak valid. Sisa: ${money(remaining)}`);
  }
  if (type === "PENGELUARAN" && currentWallet < amount) {
    return bot.sendMessage(
      chatId,
      `❌ Saldo ${data.wallet} tidak cukup.\nSaldo sekarang: ${money(currentWallet)}\nDibutuhkan: ${money(amount)}`,
      kb([[{ text: "↩️ Pilih Wallet Lain", callback_data: `debt_retry_wallet_${sheetRow}` }], [{ text: "❌ Batal", callback_data: "debt_cancel" }]])
    );
  }

  const projectedWallet = currentWallet + (type === "PEMASUKAN" ? amount : -amount);
  const status = projected === 0 ? "LUNAS" : "SEBAGIAN";

  return bot.sendMessage(
    chatId,
    `📋 KONFIRMASI ${paymentActionText(row[4]).toUpperCase()}\n\n` +
    `👤 ${row[2] || "-"}\n` +
    `🏷️ ${row[3] || "-"}\n` +
    `📌 ${row[4] || "-"}\n` +
    `${type === "PEMASUKAN" ? "📥" : "📤"} ${money(amount)}\n` +
    `💳 Wallet: ${data.wallet}\n` +
    `💰 Saldo wallet: ${money(currentWallet)} → ${money(projectedWallet)}\n` +
    `📊 Sisa utang/piutang: ${money(projected)}\n` +
    `✅ Status setelah transaksi: ${status}`,
    kb([
      [{ text: "✅ Konfirmasi", callback_data: `debt_confirm_payment_${sheetRow}` }],
      [{ text: "❌ Batal", callback_data: "debt_cancel" }]
    ])
  );
}

async function pay(bot, chatId, sheetRow, amount, wallet, paymentId, caller) {
  const access = await ensureCallerCanAccessDebt(sheetRow, caller);
  const row = access.row;
  const debtId = String(row[0] || "");
  const owner = String(row[2] || "").toUpperCase();
  const jenis = String(row[4] || "").toUpperCase();
  const total = Number(row[5]) || 0;
  const paid = Number(row[9]) || 0;
  const remaining = Math.max(0, total - paid);

  if (!WALLETS.includes(wallet)) {
    return bot.sendMessage(chatId, "❌ Wallet tidak valid.");
  }
  if (amount <= 0 || amount > remaining) {
    return bot.sendMessage(chatId, `❌ Nominal pembayaran harus > 0 dan tidak boleh melebihi sisa ${money(remaining)}.`);
  }

  const existingLog = await findPaymentLog(paymentId);
  const existingPayment = await findPaymentTransaction(paymentId);
  if (existingLog) {
    return bot.sendMessage(chatId, `✅ Pembayaran ini sudah tercatat sebelumnya.\n\nSisa saat ini: ${money(remaining)}`);
  }

  const txType = debtTransactionType(jenis);
  if (txType === "PENGELUARAN") {
    const currentBalance = await getWalletBalance(owner, wallet);
    if (currentBalance < amount && !existingPayment) {
      return bot.sendMessage(chatId, `❌ Saldo ${wallet} tidak cukup. Saldo sekarang ${money(currentBalance)}.`);
    }
  }

  let txId = existingPayment ? String(existingPayment[0] || "") : "";
  if (!existingPayment) {
    const category = debtCategory(jenis);
    const marker = `[UTANG:${debtId}][PAYMENT:${paymentId}]`;
    const tx = await addTransaction({
      owner,
      type: txType,
      amount,
      category,
      wallet,
      note: `${marker} ${paymentActionText(jenis)} ${row[3] || "-"}`
    });
    txId = tx[0];
  }

  const recordedPaymentTotal = await getRecordedPaymentTotal(debtId);
  const nextPaid = Math.min(total, Math.max(paid, recordedPaymentTotal));
  const nextStatus = nextPaid >= total ? "LUNAS" : "SEBAGIAN";

  await append("UTANG_PEMBAYARAN", [
    crypto.randomUUID(),
    debtId,
    today(),
    owner,
    jenis,
    amount,
    wallet,
    txId,
    paymentId
  ]);

  await update(`UTANG!H${sheetRow}:J${sheetRow}`, [[nextStatus, row[8] || "", nextPaid]]);

  const cashEffect = txType === "PEMASUKAN" ? "bertambah" : "berkurang";
  return bot.sendMessage(
    chatId,
    `✅ ${paymentActionText(jenis).toUpperCase()} TERCATAT\n\n` +
    `👤 ${owner}\n` +
    `🏷️ ${row[3] || "-"}\n` +
    `📌 ${row[4] || "-"}\n` +
    `💰 ${money(amount)} via ${wallet}\n` +
    `📊 Terbayar: ${money(nextPaid)} / ${money(total)}\n` +
    `💵 Sisa: ${money(Math.max(0, total - nextPaid))}\n` +
    `📈 Status: ${nextStatus}\n\n` +
    `Saldo wallet ${cashEffect} otomatis ${money(amount)}.`
  );
}

module.exports = {
  setupDebtHandlers,
  startDebt: menu
};
