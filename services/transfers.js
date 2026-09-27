const crypto = require("crypto");
const { append } = require("./sheets");
const { normalizeOwner, normalizeWallet } = require("../utils/constants");
const { getWalletBalance } = require("./transactions");
const { today, nowJakarta } = require("../utils/time");

async function addTransfer({ owner, fromWallet, toWallet, amount, note = "" }) {
  const o = normalizeOwner(owner);
  const from = normalizeWallet(fromWallet);
  const to = normalizeWallet(toWallet);
  const a = Number(amount);

  if (!o || !from || !to || from === to || !Number.isFinite(a) || a <= 0) {
    throw new Error("TRANSFER_VALIDATION_FAILED");
  }

  const value = Math.round(a);
  const sourceBalance = await getWalletBalance(o, from);
  if (sourceBalance < value) throw new Error("TRANSFER_INSUFFICIENT");

  const id = crypto.randomUUID();
  const d = today();
  const ts = nowJakarta();
  const safeNote = String(note || "").trim().slice(0, 300);
  const base = [id, d, o, "TRANSFER", value, "Transfer"];

  await append("TRANSAKSI", [
    ...base,
    from,
    `TRANSFER_OUT|${id}|${to}|${safeNote}`,
    d.slice(0, 7),
    ts
  ]);
  await append("TRANSAKSI", [
    ...base,
    to,
    `TRANSFER_IN|${id}|${from}|${safeNote}`,
    d.slice(0, 7),
    ts
  ]);

  return id;
}

module.exports = { addTransfer };
