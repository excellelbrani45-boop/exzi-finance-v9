const crypto = require("crypto");
const { read, append, update } = require("../services/sheets");
const { money, cleanAmount } = require("../utils/money");
const { requireOwner } = require("../utils/auth");
const { begin, get, clear } = require("../utils/session");
const { today, nowJakarta } = require("../utils/time");
const { WALLETS } = require("../utils/constants");
const { addTransaction, getWalletBalance } = require("../services/transactions");

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function nextRecurringDate(date, recurring) {
  if (!validDate(date)) return "";
  const [y, m, day] = date.split("-").map(Number);
  const r = String(recurring || "").trim().toUpperCase();
  if (r === "HARIAN" || r === "MINGGUAN") {
    const d = new Date(Date.UTC(y, m - 1, day));
    d.setUTCDate(d.getUTCDate() + (r === "HARIAN" ? 1 : 7));
    return d.toISOString().slice(0, 10);
  }
  if (r === "BULANAN") {
    const nextYear = m === 12 ? y + 1 : y;
    const nextMonth = m === 12 ? 1 : m + 1;
    const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    const clamped = Math.min(day, lastDay);
    return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
  }
  if (r === "TAHUNAN") {
    const nextYear = y + 1;
    const lastDay = new Date(Date.UTC(nextYear, m, 0)).getUTCDate();
    const clamped = Math.min(day, lastDay);
    return `${nextYear}-${String(m).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
  }
  return "";
}

function ownerFilter(rows, owner, index = 1) {
  return rows.slice(1).filter(r => String(r[index] || "").toUpperCase() === owner);
}

async function getTargets(owner) {
  const rows = await read("TARGET");
  return rows.slice(1)
    .map((r, i) => ({ row: i + 2, data: r }))
    .filter(item => String(item.data[1] || "").toUpperCase() === owner)
    .map(item => {
      const r = item.data;
      return {
        row: item.row,
        id: String(r[0] || ""),
        owner: String(r[1] || "").toUpperCase(),
        name: r[2] || "Target",
        goal: Number(r[3]) || 0,
        saved: Number(r[4]) || 0,
        deadline: r[5] || "",
        status: String(r[6] || "AKTIF").toUpperCase(),
        note: r[7] || ""
      };
    });
}

async function getBills(owner) {
  const rows = await read("TAGIHAN");
  return rows.slice(1)
    .map((r, i) => ({ row: i + 2, data: r }))
    .filter(item => String(item.data[1] || "").toUpperCase() === owner)
    .map(item => {
      const r = item.data;
      return {
        row: item.row,
        id: String(r[0] || ""),
        owner: String(r[1] || "").toUpperCase(),
        name: r[2] || "Tagihan",
        amount: Number(r[3]) || 0,
        due: r[4] || "",
        status: String(r[5] || "AKTIF").toUpperCase(),
        recurring: String(r[6] || "").toUpperCase(),
        note: r[7] || "",
        paid: Number(r[8]) || 0
      };
    });
}

async function showTargetMenu(bot, chatId) {
  return bot.sendMessage(chatId, "🎯 TARGET TABUNGAN\n\nPilih aksi:", kb([
    [{ text: "➕ Tambah Target", callback_data: "target_add" }, { text: "📋 Lihat Target", callback_data: "target_list" }],
    [{ text: "💰 Setor ke Target", callback_data: "target_deposit" }],
    [{ text: "↩️ Menu", callback_data: "menu" }]
  ]));
}

async function showTagihanMenu(bot, chatId) {
  return bot.sendMessage(chatId, "🧾 TAGIHAN", kb([
    [{ text: "➕ Tambah Tagihan", callback_data: "bill_add" }, { text: "📋 Aktif", callback_data: "bill_list" }],
    [{ text: "↩️ Menu", callback_data: "menu" }]
  ]));
}

async function targetList(bot, msg) {
  const owner = requireOwner(msg.from.id);
  const targets = await getTargets(owner);
  if (!targets.length) {
    return bot.sendMessage(msg.chat.id, "🎯 Belum ada target.", kb([[{ text: "➕ Tambah Target", callback_data: "target_add" }], [{ text: "↩️ Menu", callback_data: "menu" }]]));
  }

  const text = targets.map((x, i) => {
    const pct = x.goal ? Math.min(100, (x.saved / x.goal) * 100) : 0;
    return `${i + 1}. ${x.name}\n   💰 ${money(x.saved)} / ${money(x.goal)} (${pct.toFixed(1)}%)\n   📅 Deadline: ${x.deadline || "-"}\n   📌 Status: ${x.status}`;
  }).join("\n\n");

  const buttons = targets.slice(0, 8).map(x => [{ text: `💰 Setor ke ${x.name}`, callback_data: `target_deposit_${x.row}` }]);
  buttons.push([{ text: "➕ Tambah Target", callback_data: "target_add" }, { text: "↩️ Kembali", callback_data: "menu_target" }]);
  return bot.sendMessage(msg.chat.id, `🎯 TARGET ${owner}\n\n${text}`, kb(buttons));
}

async function billList(bot, msg) {
  const owner = requireOwner(msg.from.id);
  const bills = await getBills(owner);
  const active = bills.filter(x => ["AKTIF", "SEBAGIAN", "BELUM LUNAS"].includes(x.status));
  if (!active.length) {
    return bot.sendMessage(msg.chat.id, "🧾 Tidak ada tagihan aktif.", kb([[{ text: "➕ Tambah Tagihan", callback_data: "bill_add" }], [{ text: "↩️ Menu", callback_data: "menu" }]]));
  }

  const text = active.map((x, i) => {
    const remain = Math.max(0, x.amount - x.paid);
    return `${i + 1}. ${x.name}\n   💰 Sisa ${money(remain)} / ${money(x.amount)}\n   📅 Jatuh tempo: ${x.due || "-"}\n   📌 ${x.status}${x.recurring ? `\n   🔁 ${x.recurring}` : ""}`;
  }).join("\n\n");
  const buttons = active.slice(0, 8).map(x => [{ text: `💸 Bayar ${x.name} • ${money(Math.max(0, x.amount - x.paid))}`, callback_data: `bill_pay_${x.row}` }]);
  buttons.push([{ text: "↩️ Kembali", callback_data: "menu_tagihan" }]);
  return bot.sendMessage(msg.chat.id, `🧾 TAGIHAN AKTIF — ${owner}\n\n${text}`, kb(buttons));
}

async function createTarget(bot, msg) {
  begin(String(msg.chat.id), "finance_target", { step: "data" });
  return bot.sendMessage(msg.chat.id, "Format target:\nnama target | nominal target | deadline\nContoh:\nDana Darurat | 3000000 | 2027-03-01\n\nKetik / batal untuk membatalkan.");
}

async function createBill(bot, msg) {
  begin(String(msg.chat.id), "finance_bill", { step: "data" });
  return bot.sendMessage(msg.chat.id, "Format tagihan:\nnama | nominal | jatuh tempo | recurring\nContoh:\nInternet | 300k | 2026-10-10 | BULANAN\n\nRecurring: HARIAN / MINGGUAN / BULANAN / TAHUNAN / kosong.");
}

async function targetDepositStart(bot, chatId, rowNumber, owner) {
  const targets = await getTargets(owner);
  const target = targets.find(x => x.row === Number(rowNumber));
  if (!target) return bot.sendMessage(chatId, "❌ Target tidak ditemukan.");
  const remaining = Math.max(0, target.goal - target.saved);
  if (remaining <= 0 || target.status === "LUNAS") return bot.sendMessage(chatId, "✅ Target ini sudah tercapai.");
  begin(String(chatId), "target_deposit", { step: "amount", data: { owner, row: target.row, id: target.id, max: remaining, name: target.name, goal: target.goal, saved: target.saved } });
  return bot.sendMessage(chatId, `💰 SETOR TARGET\n\n🎯 ${target.name}\nTerkumpul: ${money(target.saved)} / ${money(target.goal)}\nSisa: ${money(remaining)}\n\nMasukkan nominal setoran:`);
}

async function saveTargetDeposit(chatId, session, note) {
  const rows = await read("TARGET");
  const row = rows[session.data.row - 1];
  if (!row || String(row[0] || "") !== session.data.id) throw new Error("TARGET_CHANGED");
  const current = Number(row[4]) || 0;
  const amount = Number(session.data.amount) || 0;
  const next = Math.min(Number(row[3]) || 0, current + amount);
  const status = next >= (Number(row[3]) || 0) ? "LUNAS" : "AKTIF";
  await append("TARGET_SETORAN", [crypto.randomUUID(), session.data.id, today(), session.data.owner, amount, note || ""]);
  await update(`TARGET!E${session.data.row}:G${session.data.row}`, [[next, row[5] || "", status]]);
  return { next, status, target: row[2] || session.data.name, goal: Number(row[3]) || 0 };
}

async function startBillPayment(bot, chatId, rowNumber, owner) {
  const bills = await getBills(owner);
  const bill = bills.find(x => x.row === Number(rowNumber));
  if (!bill) return bot.sendMessage(chatId, "❌ Tagihan tidak ditemukan.");
  const remaining = Math.max(0, bill.amount - bill.paid);
  if (remaining <= 0) return bot.sendMessage(chatId, "✅ Tagihan ini sudah lunas.");
  begin(String(chatId), "bill_payment", { step: "amount", data: { owner, row: bill.row, id: bill.id, name: bill.name, total: bill.amount, paid: bill.paid, max: remaining, recurring: bill.recurring } });
  return bot.sendMessage(chatId, `💸 BAYAR TAGIHAN\n\n🧾 ${bill.name}\nTotal: ${money(bill.amount)}\nTerbayar: ${money(bill.paid)}\nSisa: ${money(remaining)}\n\nMasukkan nominal pembayaran:`);
}

async function findBillPayment(paymentId) {
  const rows = await read("TAGIHAN_PEMBAYARAN");
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][7] || "") === String(paymentId)) return rows[i];
  }
  return null;
}

async function findBillPaymentTransaction(paymentId) {
  if (!paymentId) return null;
  const rows = await read("TRANSAKSI");
  const marker = `[PAYMENT:${paymentId}]`;
  for (const row of rows.slice(1)) {
    if (String(row[7] || "").includes(marker)) return row;
  }
  return null;
}

async function getRecordedBillPaymentTotal(billId) {
  const rows = await read("TRANSAKSI");
  const prefix = `[TAGIHAN:${billId}][PAYMENT:`;
  let total = 0;
  for (const row of rows.slice(1)) {
    if (String(row[7] || "").includes(prefix)) total += Number(row[4]) || 0;
  }
  return total;
}

async function hasRecurringNext(owner, name, due) {
  const rows = await read("TAGIHAN");
  const targetName = String(name || "").trim();
  const targetDue = String(due || "").slice(0, 10);
  return rows.slice(1).some(r =>
    String(r[1] || "").toUpperCase() === String(owner).toUpperCase() &&
    String(r[2] || "").trim() === targetName &&
    String(r[4] || "").slice(0, 10) === targetDue
  );
}

async function confirmBillPayment(bot, chatId, session) {
  const rows = await read("TAGIHAN");
  const row = rows[session.data.row - 1];
  if (!row || String(row[0] || "") !== session.data.id) {
    clear(chatId);
    return bot.sendMessage(chatId, "❌ Tagihan sudah berubah atau tidak ditemukan.");
  }
  const total = Number(row[3]) || 0;
  const paid = Number(row[8]) || 0;
  const remaining = Math.max(0, total - paid);
  const amount = Number(session.data.amount) || 0;
  if (!amount || amount > remaining) return bot.sendMessage(chatId, `❌ Nominal tidak valid. Sisa ${money(remaining)}.`);
  const current = await getWalletBalance(session.data.owner, session.data.wallet);
  if (current < amount) {
    return bot.sendMessage(chatId, `❌ Saldo ${session.data.wallet} tidak cukup.\nSaldo sekarang: ${money(current)}\nDibutuhkan: ${money(amount)}`);
  }
  const projected = current - amount;
  session.data.projectedBalance = projected;
  return bot.sendMessage(chatId, `📋 KONFIRMASI TAGIHAN\n\n🧾 ${row[2] || "Tagihan"}\n💰 Bayar ${money(amount)}\n💳 Wallet ${session.data.wallet}\nSaldo wallet: ${money(current)} → ${money(projected)}\n📊 Sisa tagihan: ${money(remaining - amount)}\n📌 Status: ${remaining - amount <= 0 ? "LUNAS" : "SEBAGIAN"}`, kb([
    [{ text: "✅ Bayar Sekarang", callback_data: `bill_confirm_pay_${session.data.row}` }],
    [{ text: "❌ Batal", callback_data: "bill_cancel" }]
  ]));
}

async function payBill(bot, chatId, session) {
  const rows = await read("TAGIHAN");
  const row = rows[session.data.row - 1];
  if (!row || String(row[0] || "") !== session.data.id) throw new Error("BILL_CHANGED");

  const total = Number(row[3]) || 0;
  const paid = Number(row[8]) || 0;
  const remaining = Math.max(0, total - paid);
  const amount = Number(session.data.amount) || 0;
  if (amount <= 0 || amount > remaining) throw new Error("INVALID_BILL_PAYMENT");

  const paymentId = session.data.paymentId || crypto.randomUUID();
  session.data.paymentId = paymentId;
  const existingLog = await findBillPayment(paymentId);
  const existingTransaction = await findBillPaymentTransaction(paymentId);

  if (existingLog) {
    return bot.sendMessage(chatId, `✅ Pembayaran ini sudah tercatat sebelumnya.\n\n🧾 ${row[2] || "Tagihan"}`);
  }

  let txId = existingTransaction ? String(existingTransaction[0] || "") : "";
  if (!existingTransaction) {
    const currentBalance = await getWalletBalance(session.data.owner, session.data.wallet);
    if (currentBalance < amount) throw new Error("BILL_INSUFFICIENT");

    const tx = await addTransaction({
      owner: session.data.owner,
      type: "PENGELUARAN",
      amount,
      category: "Tagihan",
      wallet: session.data.wallet,
      note: `[TAGIHAN:${session.data.id}][PAYMENT:${paymentId}] ${row[2] || "Tagihan"}`
    });
    txId = tx[0];
  }

  await append("TAGIHAN_PEMBAYARAN", [
    crypto.randomUUID(),
    session.data.id,
    today(),
    session.data.owner,
    amount,
    session.data.wallet,
    txId,
    paymentId
  ]);

  const recorded = await getRecordedBillPaymentTotal(session.data.id);
  const nextPaid = Math.min(total, Math.max(paid, recorded));
  const nextStatus = nextPaid >= total ? "LUNAS" : "SEBAGIAN";
  await update(`TAGIHAN!F${session.data.row}:I${session.data.row}`, [[nextStatus, row[6] || "", row[7] || "", nextPaid]]);

  let recurringMessage = "";
  if (nextStatus === "LUNAS" && String(row[6] || "").trim()) {
    const nextDue = nextRecurringDate(String(row[4] || "").slice(0, 10), row[6]);
    if (nextDue && !(await hasRecurringNext(session.data.owner, row[2], nextDue))) {
      await append("TAGIHAN", [crypto.randomUUID(), session.data.owner, row[2] || "Tagihan", total, nextDue, "AKTIF", row[6], row[7] || "", 0]);
      recurringMessage = `\n🔁 Tagihan berikutnya dibuat: ${nextDue}`;
    }
  }

  return bot.sendMessage(
    chatId,
    `✅ TAGIHAN TERBAYAR\n\n` +
    `🧾 ${row[2] || "Tagihan"}\n` +
    `💸 ${money(amount)} via ${session.data.wallet}\n` +
    `📊 Terbayar: ${money(nextPaid)} / ${money(total)}\n` +
    `📌 Status: ${nextStatus}${recurringMessage}\n\n` +
    `📤 Pengeluaran otomatis tercatat di TRANSAKSI.`
  );
}

function setupFinanceHandlers(bot) {
  bot.onText(/^\/target(?:@\w+)?$/, m => targetList(bot, m).catch(e => bot.sendMessage(m.chat.id, "❌ Gagal membaca target.")));
  bot.onText(/^\/tagihan(?:@\w+)?$/, m => billList(bot, m).catch(e => bot.sendMessage(m.chat.id, "❌ Gagal membaca tagihan.")));
  bot.onText(/^\/tambah_target(?:@\w+)?$/, async m => { try { requireOwner(m.from.id); await createTarget(bot, m); } catch { await bot.sendMessage(m.chat.id, "❌ Akses ditolak."); } });
  bot.onText(/^\/tambah_tagihan(?:@\w+)?$/, async m => { try { requireOwner(m.from.id); await createBill(bot, m); } catch { await bot.sendMessage(m.chat.id, "❌ Akses ditolak."); } });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;
    const d = q.data;
    if (!(d === "menu_target" || d.startsWith("target_") || d === "menu_tagihan" || d.startsWith("bill_"))) return;
    await bot.answerCallbackQuery(q.id).catch(() => {});
    const id = String(q.message.chat.id);
    try {
      const owner = requireOwner(q.from.id);
      if (d === "menu_target") return showTargetMenu(bot, q.message.chat.id);
      if (d === "target_list") return targetList(bot, { chat: q.message.chat, from: q.from });
      if (d === "target_add") return createTarget(bot, { chat: q.message.chat, from: q.from });
      if (d === "target_deposit") {
        const targets = await getTargets(owner);
        if (!targets.length) return bot.sendMessage(q.message.chat.id, "🎯 Belum ada target.");
        return bot.sendMessage(q.message.chat.id, "Pilih target yang mau disetor:", kb(targets.slice(0, 8).map(x => [{ text: `${x.name} • ${money(Math.max(0, x.goal - x.saved))}`, callback_data: `target_deposit_${x.row}` }])));
      }
      if (d.startsWith("target_deposit_")) return targetDepositStart(bot, q.message.chat.id, d.slice(15), owner);
      if (d === "menu_tagihan") return showTagihanMenu(bot, q.message.chat.id);
      if (d === "bill_list") return billList(bot, { chat: q.message.chat, from: q.from });
      if (d === "bill_add") return createBill(bot, { chat: q.message.chat, from: q.from });
      if (d.startsWith("bill_pay_")) return startBillPayment(bot, q.message.chat.id, d.slice(9), owner);
      if (d === "bill_cancel") { clear(id); return bot.sendMessage(q.message.chat.id, "❌ Pembayaran tagihan dibatalkan."); }

      const s = get(id);
      if (!s) return bot.sendMessage(q.message.chat.id, "⚠️ Sesi tidak ditemukan.");
      if (s.kind === "bill_payment" && d.startsWith("bill_wallet_")) {
        const wallet = d.slice("bill_wallet_".length);
        if (!WALLETS.includes(wallet)) return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");
        s.data.wallet = wallet;
        s.step = "confirm";
        return confirmBillPayment(bot, q.message.chat.id, s);
      }
      if (s.kind === "bill_payment" && d.startsWith("bill_confirm_pay_")) {
        if (Number(d.slice("bill_confirm_pay_".length)) !== Number(s.data.row)) return bot.sendMessage(q.message.chat.id, "⚠️ Sesi pembayaran tidak cocok.");
        if (s.processing) return bot.sendMessage(q.message.chat.id, "⏳ Pembayaran sedang diproses.");
        s.processing = true;
        s.data.paymentId = s.data.paymentId || crypto.randomUUID();
        try {
          const result = await payBill(bot, q.message.chat.id, s);
          clear(id);
          return result;
        } catch (e) {
          s.processing = false;
          throw e;
        }
      }
    } catch (e) {
      console.error("FINANCE CALLBACK:", e);
      const message = e.message === "UNAUTHORIZED_USER" ? "Akses ditolak."
        : e.message === "BILL_INSUFFICIENT" ? "Saldo wallet tidak cukup untuk membayar tagihan."
        : e.message === "BILL_CHANGED" ? "Data tagihan sudah berubah. Buka daftar tagihan lalu ulangi."
        : "Gagal memproses fitur.";
      return bot.sendMessage(q.message.chat.id, `❌ ${message}`);
    }
  });

  bot.on("message", async m => {
    if (!m.text || m.text.startsWith("/")) return;
    const id = String(m.chat.id);
    const s = get(id);
    if (!s) return;
    try {
      if (s.kind === "finance_target" && s.step === "data") {
        const parts = m.text.split("|").map(x => x.trim());
        if (parts.length < 3) return bot.sendMessage(m.chat.id, "❌ Format: nama | nominal | deadline");
        const owner = requireOwner(m.from.id);
        const amount = cleanAmount(parts[1]);
        if (!amount) return bot.sendMessage(m.chat.id, "❌ Nominal target tidak valid.");
        if (!validDate(parts[2])) return bot.sendMessage(m.chat.id, "❌ Deadline tidak valid. Gunakan YYYY-MM-DD.");
        await append("TARGET", [crypto.randomUUID(), owner, parts[0], amount, 0, parts[2], "AKTIF", ""]);
        clear(id);
        return bot.sendMessage(m.chat.id, `✅ TARGET DIBUAT\n\n🎯 ${parts[0]}\n💰 ${money(amount)}\n📅 ${parts[2]}`);
      }

      if (s.kind === "target_deposit") {
        if (s.step === "amount") {
          const amount = cleanAmount(m.text);
          if (!amount || amount > s.data.max) return bot.sendMessage(m.chat.id, `❌ Nominal tidak valid. Maksimal ${money(s.data.max)}.`);
          s.data.amount = amount;
          s.step = "note";
          return bot.sendMessage(m.chat.id, "📝 Keterangan setoran (atau -):");
        }
        if (s.step === "note") {
          const note = m.text.trim() === "-" ? "" : m.text.trim();
          const result = await saveTargetDeposit(id, s, note);
          clear(id);
          return bot.sendMessage(m.chat.id, `✅ SETORAN TARGET TERCATAT\n\n🎯 ${result.target}\n💰 +${money(s.data.amount)}\n📊 ${money(result.next)} / ${money(result.goal)}\n📌 Status: ${result.status}\n\nℹ️ Setoran target mengubah progress target, bukan pemasukan/pengeluaran karena uangnya tidak dianggap keluar dari wallet.`);
        }
      }

      if (s.kind === "finance_bill" && s.step === "data") {
        const parts = m.text.split("|").map(x => x.trim());
        if (parts.length < 3) return bot.sendMessage(m.chat.id, "❌ Format: nama | nominal | jatuh tempo | recurring");
        const owner = requireOwner(m.from.id);
        const amount = cleanAmount(parts[1]);
        if (!amount) return bot.sendMessage(m.chat.id, "❌ Nominal tagihan tidak valid.");
        if (!validDate(parts[2])) return bot.sendMessage(m.chat.id, "❌ Jatuh tempo tidak valid. Gunakan YYYY-MM-DD.");
        const recurring = String(parts[3] || "").toUpperCase();
        if (recurring && !["HARIAN", "MINGGUAN", "BULANAN", "TAHUNAN"].includes(recurring)) return bot.sendMessage(m.chat.id, "❌ Recurring harus HARIAN/MINGGUAN/BULANAN/TAHUNAN atau kosong.");
        await append("TAGIHAN", [crypto.randomUUID(), owner, parts[0], amount, parts[2], "AKTIF", recurring, "", 0]);
        clear(id);
        return bot.sendMessage(m.chat.id, `✅ TAGIHAN DIBUAT\n\n🧾 ${parts[0]}\n💰 ${money(amount)}\n📅 ${parts[2]}\n🔁 ${recurring || "-"}`);
      }

      if (s.kind === "bill_payment") {
        if (s.step === "amount") {
          const amount = cleanAmount(m.text);
          if (!amount || amount > s.data.max) return bot.sendMessage(m.chat.id, `❌ Nominal tidak valid. Maksimal ${money(s.data.max)}.`);
          s.data.amount = amount;
          s.data.paymentId = s.data.paymentId || crypto.randomUUID();
          s.step = "wallet";
          return bot.sendMessage(m.chat.id, "💳 Pilih wallet untuk membayar:", kb([
            ["CASH", "BANK"], ["GOPAY", "OVO"], ["DANA", "SHOPEEPAY"], ["LAINNYA", "UTAMA"]
          ].map(pair => pair.map(w => ({ text: w, callback_data: `bill_wallet_${w}` })).concat([])).concat([[{ text: "❌ Batal", callback_data: "bill_cancel" }]])));
        }
      }
    } catch (e) {
      console.error("FINANCE TEXT:", e);
      clear(id);
      return bot.sendMessage(m.chat.id, "❌ Gagal menyimpan data.");
    }
  });
}

module.exports = { setupFinanceHandlers, targetList, billList, nextRecurringDate, validDate };
