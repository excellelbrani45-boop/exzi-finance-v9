const crypto = require("crypto");
const { append, read, update } = require("./sheets");
const {
  normalizeOwner,
  normalizeWallet,
  normalizeType,
  normalizeCategory
} = require("../utils/constants");
const { nowJakarta, today, month } = require("../utils/time");

const WALLETS = ["CASH", "BANK", "GOPAY", "OVO", "DANA", "SHOPEEPAY", "LAINNYA", "UTAMA"];

function valid(x) {
  const owner = normalizeOwner(x.owner);
  const type = normalizeType(x.type);
  const wallet = normalizeWallet(x.wallet || "UTAMA");
  const category = normalizeCategory(x.category || "Lainnya") || "Lainnya";
  const amount = Number(x.amount);

  if (!owner || !type || !wallet || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("TRANSACTION_VALIDATION_FAILED");
  }

  return {
    owner,
    type,
    wallet,
    category,
    amount: Math.round(amount),
    note: String(x.note || "").trim().slice(0, 500)
  };
}

async function addTransaction(x) {
  const v = valid(x);
  const d = x.date || today();
  const ts = x.timestamp || nowJakarta();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    throw new Error("INVALID_TRANSACTION_DATE");
  }
  const [dy, dm, dd] = String(d).split("-").map(Number);
  const dateCheck = new Date(Date.UTC(dy, dm - 1, dd));
  if (dateCheck.getUTCFullYear() !== dy || dateCheck.getUTCMonth() !== dm - 1 || dateCheck.getUTCDate() !== dd) {
    throw new Error("INVALID_TRANSACTION_DATE");
  }

  const txId = crypto.randomUUID();
  const row = [
    txId,
    d,
    v.owner,
    v.type,
    v.amount,
    v.category,
    v.wallet,
    v.note,
    "",
    ts
  ];

  const result = await append("TRANSAKSI", row);
  const updatedRange = result?.data?.updates?.updatedRange || "";
  const m = String(updatedRange).match(/!A(\d+):/);
  const rowNumber = m ? Number(m[1]) : null;
  if (rowNumber) {
    const monthFormula = `=IF(B${rowNumber}=\"\",\"\",IFERROR(TEXT(B${rowNumber},\"yyyy-mm\"),LEFT(B${rowNumber},7)))`;
    try {
      await update(`TRANSAKSI!I${rowNumber}`, [[monthFormula]]);
      row[8] = monthFormula;
    } catch (error) {
      await update(`TRANSAKSI!I${rowNumber}`, [[String(d).slice(0, 7)]]);
      row[8] = String(d).slice(0, 7);
    }
  } else {
    row[8] = String(d).slice(0, 7);
  }
  return row;
}

async function getRows(owner) {
  const a = await read("TRANSAKSI");
  if (!Array.isArray(a) || a.length < 2) return [];

  return a.slice(1)
    .map(r => ({
      id: r[0] || "",
      date: String(r[1] || "").slice(0, 10),
      owner: String(r[2] || "").toUpperCase(),
      type: String(r[3] || "").toUpperCase(),
      amount: Number(r[4]) || 0,
      category: r[5] || "Lainnya",
      wallet: String(r[6] || "UTAMA").toUpperCase(),
      note: r[7] || "",
      month: String(r[8] || ""),
      timestamp: r[9] || ""
    }))
    .filter(x => !owner || x.owner === owner);
}

async function getWalletOpeningBalances(owner) {
  const a = await read("WALLET");
  const out = Object.fromEntries(WALLETS.map(x => [x, 0]));
  if (!Array.isArray(a) || a.length < 2) return out;

  for (const r of a.slice(1)) {
    if (String(r[1] || "").toUpperCase() !== owner) continue;
    const wallet = normalizeWallet(r[2]);
    if (!wallet) continue;
    out[wallet] += Number(r[3]) || 0;
  }
  return out;
}

function summaryOf(rows) {
  const income = rows
    .filter(x => x.type === "PEMASUKAN")
    .reduce((a, b) => a + b.amount, 0);
  const expense = rows
    .filter(x => x.type === "PENGELUARAN")
    .reduce((a, b) => a + b.amount, 0);
  return { income, expense, balance: income - expense };
}

async function getBalance(owner) {
  const [rows, opening, wallets] = await Promise.all([
    getRows(owner),
    getWalletOpeningBalances(owner),
    getWalletBalances(owner)
  ]);
  const s = summaryOf(rows);
  const openingBalance = Object.values(opening).reduce((a, b) => a + b, 0);
  const balance = Object.values(wallets).reduce((a, b) => a + (Number(b) || 0), 0);
  return {
    income: s.income,
    expense: s.expense,
    openingBalance,
    balance
  };
}

async function summary(owner) {
  const rows = (await getRows(owner)).filter(x => x.date.startsWith(month()));
  return summaryOf(rows);
}

async function getRecentTransactions(owner, n = 10) {
  return (await getRows(owner)).slice(-n).reverse();
}

async function getWalletBalances(owner) {
  const [rows, opening] = await Promise.all([
    getRows(owner),
    getWalletOpeningBalances(owner)
  ]);
  const out = { ...opening };

  for (const x of rows) {
    const w = out[x.wallet] === undefined ? "LAINNYA" : x.wallet;
    if (x.type === "PEMASUKAN") {
      out[w] += x.amount;
    } else if (x.type === "PENGELUARAN") {
      out[w] -= x.amount;
    } else if (x.type === "TRANSFER") {
      const note = String(x.note || "");
      if (note.startsWith("TRANSFER_OUT|")) out[w] -= x.amount;
      else if (note.startsWith("TRANSFER_IN|")) out[w] += x.amount;
    }
  }

  return out;
}

async function getWalletBalance(owner, wallet) {
  const w = normalizeWallet(wallet);
  if (!w) throw new Error("INVALID_WALLET");
  return (await getWalletBalances(owner))[w];
}

module.exports = {
  addTransaction,
  getRows,
  getBalance,
  summary,
  getRecentTransactions,
  getWalletBalances,
  getWalletBalance,
  getWalletOpeningBalances,
  summaryOf
};
