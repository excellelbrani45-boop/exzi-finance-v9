const crypto = require("crypto");
const { append, read, update } = require("./sheets");
const { addTransaction, getWalletBalance, getWalletBalances } = require("./transactions");
const { normalizeWallet, normalizeCategory } = require("../utils/constants");
const { today, month, nowJakarta } = require("../utils/time");

const PEOPLE = ["EXCELL", "ZIZI"];
const SHARED_OWNER = "BERSAMA";
const KAS_CATEGORY = "Bersama";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function positive(v) {
  return num(v) > 0;
}

function splitBy50(total) {
  const first = Math.floor(total / 2);
  return { EXCELL: first, ZIZI: total - first };
}

function splitByPercent(total, excellPercent) {
  const p = Number(excellPercent);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error("INVALID_PERCENT");
  const excell = Math.round(total * p / 100);
  return { EXCELL: excell, ZIZI: total - excell };
}

function validateSplit(total, shares) {
  if (!positive(total)) throw new Error("INVALID_TOTAL");
  const ex = num(shares?.EXCELL);
  const zi = num(shares?.ZIZI);
  if (ex < 0 || zi < 0 || ex + zi !== num(total)) throw new Error("SPLIT_NOT_EQUAL_TOTAL");
  return { EXCELL: ex, ZIZI: zi };
}

async function readRows(sheet) {
  const rows = await read(sheet);
  return Array.isArray(rows) ? rows : [];
}

async function getBills() {
  const rows = await readRows("BERSAMA_BILLS");
  return rows.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    id: String(r[0] || ""),
    date: String(r[1] || "").slice(0, 10),
    description: r[2] || "-",
    category: normalizeCategory(r[3]) || "Lainnya",
    total: num(r[4]),
    payer: String(r[5] || "").toUpperCase(),
    wallet: String(r[6] || "UTAMA").toUpperCase(),
    status: String(r[7] || "AKTIF").toUpperCase(),
    excellShare: num(r[8]),
    ziziShare: num(r[9]),
    note: r[10] || ""
  }));
}

async function getSplits() {
  const rows = await readRows("BERSAMA_SPLITS");
  return rows.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    id: String(r[0] || ""),
    billId: String(r[1] || ""),
    owner: String(r[2] || "").toUpperCase(),
    shareAmount: num(r[3]),
    paidBy: String(r[4] || "").toUpperCase(),
    owesTo: String(r[5] || "").toUpperCase(),
    paidAmount: num(r[6]),
    remaining: num(r[7]),
    status: String(r[8] || "AKTIF").toUpperCase(),
    settledAt: r[9] || ""
  }));
}

async function createSharedBill({ description, category, total, payer, wallet, shares, note = "" }) {
  const cleanPayer = String(payer || "").toUpperCase();
  const cleanWallet = normalizeWallet(wallet);
  const cleanCategory = normalizeCategory(category) || "Lainnya";
  const value = num(total);

  if (!PEOPLE.includes(cleanPayer)) throw new Error("INVALID_PAYER");
  if (!cleanWallet) throw new Error("INVALID_WALLET");
  const split = validateSplit(value, shares);

  const currentBalance = await getWalletBalance(cleanPayer, cleanWallet);
  if (currentBalance < value) throw new Error("TOGETHER_PAYER_INSUFFICIENT");

  const billId = crypto.randomUUID();
  const marker = `[BERSAMA_BILL:${billId}]`;
  const tx = await addTransaction({
    owner: cleanPayer,
    type: "PENGELUARAN",
    amount: value,
    category: cleanCategory,
    wallet: cleanWallet,
    note: `${marker} ${String(description || "Pengeluaran bersama").trim().slice(0, 300)}`
  });

  await append("BERSAMA_BILLS", [
    billId,
    today(),
    String(description || "Pengeluaran bersama").trim().slice(0, 200),
    cleanCategory,
    value,
    cleanPayer,
    cleanWallet,
    "AKTIF",
    split.EXCELL,
    split.ZIZI,
    String(note || "").trim().slice(0, 500)
  ]);

  for (const owner of PEOPLE) {
    const share = split[owner];
    const isPayer = owner === cleanPayer;
    const remaining = isPayer ? 0 : share;
    const status = remaining === 0 ? "LUNAS" : "AKTIF";
    await append("BERSAMA_SPLITS", [
      crypto.randomUUID(),
      billId,
      owner,
      share,
      cleanPayer,
      isPayer ? "" : cleanPayer,
      isPayer ? share : 0,
      remaining,
      status,
      isPayer ? nowJakarta() : ""
    ]);
  }

  return {
    billId,
    txId: tx[0],
    payer: cleanPayer,
    wallet: cleanWallet,
    total: value,
    split
  };
}

async function getNetBalances() {
  const splits = await getSplits();
  let excellOwesZizi = 0;
  let ziziOwesExcell = 0;

  for (const s of splits) {
    if (s.status === "LUNAS" || s.remaining <= 0) continue;
    if (s.owner === "EXCELL" && s.owesTo === "ZIZI") excellOwesZizi += s.remaining;
    if (s.owner === "ZIZI" && s.owesTo === "EXCELL") ziziOwesExcell += s.remaining;
  }

  const net = excellOwesZizi - ziziOwesExcell;
  return {
    excellOwesZizi,
    ziziOwesExcell,
    direction: net > 0 ? "EXCELL_TO_ZIZI" : net < 0 ? "ZIZI_TO_EXCELL" : "BALANCED",
    amount: Math.abs(net)
  };
}

async function markBillStatuses() {
  const bills = await getBills();
  const splits = await getSplits();
  const grouped = new Map();

  for (const s of splits) {
    if (!grouped.has(s.billId)) grouped.set(s.billId, []);
    grouped.get(s.billId).push(s);
  }

  for (const bill of bills) {
    const list = grouped.get(bill.id) || [];
    const allClosed = list.length > 0 && list.every(s => s.remaining <= 0 || s.status === "LUNAS");
    const next = allClosed ? "LUNAS" : "AKTIF";
    if (bill.status !== next) {
      // BERSAMA_BILLS: H = STATUS.
      await update(`BERSAMA_BILLS!H${bill.rowNumber}`, [[next]]);
    }
  }
}

async function settle({ fromOwner, toOwner, amount, walletFrom, walletTo, note = "" }) {
  const from = String(fromOwner || "").toUpperCase();
  const to = String(toOwner || "").toUpperCase();
  const value = num(amount);

  if (!PEOPLE.includes(from) || !PEOPLE.includes(to) || from === to) throw new Error("INVALID_SETTLEMENT_PEOPLE");
  if (!positive(value)) throw new Error("INVALID_SETTLEMENT_AMOUNT");

  const net = await getNetBalances();
  if (net.direction === "BALANCED") throw new Error("NOTHING_TO_SETTLE");

  const expectedFrom = net.direction === "EXCELL_TO_ZIZI" ? "EXCELL" : "ZIZI";
  const expectedTo = expectedFrom === "EXCELL" ? "ZIZI" : "EXCELL";
  if (from !== expectedFrom || to !== expectedTo) throw new Error("WRONG_SETTLEMENT_DIRECTION");
  if (value > net.amount) throw new Error("SETTLEMENT_TOO_HIGH");

  const wf = normalizeWallet(walletFrom);
  const wt = normalizeWallet(walletTo);
  if (!wf || !wt) throw new Error("INVALID_WALLET");

  const sourceBalance = await getWalletBalance(from, wf);
  if (sourceBalance < value) throw new Error("SETTLEMENT_INSUFFICIENT");

  const settlementId = crypto.randomUUID();
  const outMarker = `TRANSFER_OUT|SETTLEMENT:${settlementId}|TO:${to}`;
  const inMarker = `TRANSFER_IN|SETTLEMENT:${settlementId}|FROM:${from}`;

  const out = await addTransaction({
    owner: from,
    type: "TRANSFER",
    amount: value,
    category: KAS_CATEGORY,
    wallet: wf,
    note: `${outMarker} ${note}`.trim()
  });
  const incoming = await addTransaction({
    owner: to,
    type: "TRANSFER",
    amount: value,
    category: KAS_CATEGORY,
    wallet: wt,
    note: `${inMarker} ${note}`.trim()
  });

  await append("BERSAMA_SETTLEMENTS", [
    settlementId,
    today(),
    from,
    to,
    value,
    wf,
    wt,
    out[0],
    incoming[0],
    String(note || "").trim().slice(0, 500)
  ]);

  let left = value;
  const splits = await getSplits();
  for (const s of splits) {
    if (left <= 0) break;
    if (s.owner !== from || s.owesTo !== to || s.remaining <= 0 || s.status === "LUNAS") continue;
    const pay = Math.min(left, s.remaining);
    const nextPaid = s.paidAmount + pay;
    const nextRemaining = s.remaining - pay;
    const nextStatus = nextRemaining <= 0 ? "LUNAS" : "SEBAGIAN";
    await update(`BERSAMA_SPLITS!G${s.rowNumber}:J${s.rowNumber}`, [[
      nextPaid,
      nextRemaining,
      nextStatus,
      nextRemaining <= 0 ? nowJakarta() : ""
    ]]);
    left -= pay;
  }

  await markBillStatuses();
  return {
    settlementId,
    from,
    to,
    amount: value,
    walletFrom: wf,
    walletTo: wt,
    remainingNet: Math.max(0, net.amount - value)
  };
}

async function kasTransfer({ direction, owner, amount, walletOwner, walletKas, note = "" }) {
  const cleanOwner = String(owner || "").toUpperCase();
  const value = num(amount);
  const wo = normalizeWallet(walletOwner);
  const wk = normalizeWallet(walletKas);

  if (!PEOPLE.includes(cleanOwner)) throw new Error("INVALID_OWNER");
  if (!positive(value)) throw new Error("INVALID_KAS_AMOUNT");
  if (!wo || !wk) throw new Error("INVALID_WALLET");

  const id = crypto.randomUUID();
  if (direction === "SETOR") {
    const sourceBalance = await getWalletBalance(cleanOwner, wo);
    if (sourceBalance < value) throw new Error("KAS_OWNER_INSUFFICIENT");

    const out = await addTransaction({
      owner: cleanOwner,
      type: "TRANSFER",
      amount: value,
      category: KAS_CATEGORY,
      wallet: wo,
      note: `TRANSFER_OUT|KAS:${id}|TO:BERSAMA ${note}`.trim()
    });
    const incoming = await addTransaction({
      owner: SHARED_OWNER,
      type: "TRANSFER",
      amount: value,
      category: KAS_CATEGORY,
      wallet: wk,
      note: `TRANSFER_IN|KAS:${id}|FROM:${cleanOwner} ${note}`.trim()
    });

    await append("BERSAMA_KAS", [id, today(), cleanOwner, "SETOR", value, wo, wk, out[0], incoming[0], String(note || "").trim().slice(0, 500)]);
  } else if (direction === "TARIK") {
    const currentKas = await getWalletBalance(SHARED_OWNER, wk);
    if (currentKas < value) throw new Error("KAS_INSUFFICIENT");

    const out = await addTransaction({
      owner: SHARED_OWNER,
      type: "TRANSFER",
      amount: value,
      category: KAS_CATEGORY,
      wallet: wk,
      note: `TRANSFER_OUT|KAS:${id}|TO:${cleanOwner} ${note}`.trim()
    });
    const incoming = await addTransaction({
      owner: cleanOwner,
      type: "TRANSFER",
      amount: value,
      category: KAS_CATEGORY,
      wallet: wo,
      note: `TRANSFER_IN|KAS:${id}|FROM:BERSAMA ${note}`.trim()
    });

    await append("BERSAMA_KAS", [id, today(), cleanOwner, "TARIK", value, wo, wk, out[0], incoming[0], String(note || "").trim().slice(0, 500)]);
  } else {
    throw new Error("INVALID_KAS_DIRECTION");
  }

  return { id, direction, owner: cleanOwner, amount: value, walletOwner: wo, walletKas: wk };
}

async function getKasBalances() {
  return getWalletBalances(SHARED_OWNER);
}

async function getTogetherHistory(limit = 12) {
  const [bills, settlementsRows, kasRows] = await Promise.all([
    getBills(),
    readRows("BERSAMA_SETTLEMENTS"),
    readRows("BERSAMA_KAS")
  ]);

  const settlements = settlementsRows.slice(1).map(r => ({
    kind: "SETTLE",
    date: String(r[1] || "").slice(0, 10),
    text: `✅ ${String(r[2] || "").toUpperCase()} → ${String(r[3] || "").toUpperCase()} • ${num(r[4])}`
  }));

  const kas = kasRows.slice(1).map(r => ({
    kind: "KAS",
    date: String(r[1] || "").slice(0, 10),
    text: `🏦 ${String(r[3] || "").toUpperCase()} • ${String(r[2] || "").toUpperCase()} • ${num(r[4])}`
  }));

  const billEvents = bills.map(b => ({
    kind: "BILL",
    date: b.date,
    text: `🧾 ${b.description} • ${b.payer} • ${num(b.total)}`
  }));

  return [...billEvents, ...settlements, ...kas]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, limit);
}

async function getMonthlyReport() {
  const currentMonth = month();
  const [bills, splits, settlementsRows, kasRows, net, kasBalances] = await Promise.all([
    getBills(),
    getSplits(),
    readRows("BERSAMA_SETTLEMENTS"),
    readRows("BERSAMA_KAS"),
    getNetBalances(),
    getKasBalances()
  ]);

  const currentBills = bills.filter(b => b.date.startsWith(currentMonth));
  const total = currentBills.reduce((s, b) => s + b.total, 0);
  const paidBy = {
    EXCELL: currentBills.filter(b => b.payer === "EXCELL").reduce((s, b) => s + b.total, 0),
    ZIZI: currentBills.filter(b => b.payer === "ZIZI").reduce((s, b) => s + b.total, 0)
  };
  const shareBy = {
    EXCELL: currentBills.reduce((s, b) => s + b.excellShare, 0),
    ZIZI: currentBills.reduce((s, b) => s + b.ziziShare, 0)
  };
  const settlements = settlementsRows.slice(1)
    .filter(r => String(r[1] || "").slice(0, 7) === currentMonth)
    .reduce((s, r) => s + num(r[4]), 0);
  const kasSetor = kasRows.slice(1)
    .filter(r => String(r[1] || "").slice(0, 7) === currentMonth && String(r[3] || "").toUpperCase() === "SETOR")
    .reduce((s, r) => s + num(r[4]), 0);
  const kasTarik = kasRows.slice(1)
    .filter(r => String(r[1] || "").slice(0, 7) === currentMonth && String(r[3] || "").toUpperCase() === "TARIK")
    .reduce((s, r) => s + num(r[4]), 0);
  const outstanding = splits.filter(s => s.remaining > 0 && s.status !== "LUNAS").reduce((s, r) => s + r.remaining, 0);
  const activeBills = bills.filter(b => b.status !== "LUNAS");

  return {
    month: currentMonth,
    billCount: currentBills.length,
    total,
    paidBy,
    shareBy,
    settlements,
    outstanding,
    activeBills: activeBills.length,
    kasSetor,
    kasTarik,
    kasBalances,
    net
  };
}

module.exports = {
  PEOPLE,
  SHARED_OWNER,
  splitBy50,
  splitByPercent,
  createSharedBill,
  getNetBalances,
  settle,
  kasTransfer,
  getKasBalances,
  getTogetherHistory,
  getMonthlyReport,
  markBillStatuses,
};
