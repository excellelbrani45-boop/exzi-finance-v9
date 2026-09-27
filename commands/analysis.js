const { read } = require("../services/sheets");
const { money } = require("../utils/money");
const { month, today, daysAgoDate } = require("../utils/time");
const { requireOwner } = require("../utils/auth");

function parseTransactions(rows, owner) {
  return rows.slice(1)
    .map(x => ({
      id: String(x[0] || ""),
      date: String(x[1] || "").slice(0, 10),
      owner: String(x[2] || "").toUpperCase(),
      type: String(x[3] || "").toUpperCase(),
      amount: Number(x[4]) || 0,
      category: x[5] || "Lainnya",
      wallet: x[6] || "UTAMA",
      note: x[7] || ""
    }))
    .filter(x => x.owner === owner);
}

function calc(data) {
  const income = data.filter(x => x.type === "PEMASUKAN").reduce((s, x) => s + x.amount, 0);
  const expense = data.filter(x => x.type === "PENGELUARAN").reduce((s, x) => s + x.amount, 0);
  const net = income - expense;
  return {
    income,
    expense,
    net,
    savingRate: income ? (net / income) * 100 : 0,
    expenseRate: income ? (expense / income) * 100 : 0
  };
}

function ranking(data, field) {
  const map = new Map();
  for (const x of data.filter(x => x.type === "PENGELUARAN")) {
    const key = String(x[field] || "Lainnya");
    map.set(key, (map.get(key) || 0) + x.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function biggestExpense(data) {
  return data.filter(x => x.type === "PENGELUARAN").sort((a, b) => b.amount - a.amount)[0] || null;
}

function formatTop(items) {
  return items.slice(0, 5).map((x, i) => `${i + 1}. ${x[0]} — ${money(x[1])}`).join("\n") || "Belum ada.";
}

async function extraSnapshot(owner) {
  const [debts, bills, targets] = await Promise.all([
    read("UTANG"),
    read("TAGIHAN"),
    read("TARGET")
  ]);

  const activeDebt = debts.slice(1).filter(r => String(r[2] || "").toUpperCase() === owner && !["LUNAS", "SELESAI"].includes(String(r[7] || "").toUpperCase()));
  const activeBills = bills.slice(1).filter(r => String(r[1] || "").toUpperCase() === owner && !["LUNAS", "SELESAI"].includes(String(r[5] || "").toUpperCase()));
  const activeTargets = targets.slice(1).filter(r => String(r[1] || "").toUpperCase() === owner && String(r[6] || "").toUpperCase() !== "LUNAS");

  const dueItems = [];
  for (const r of activeDebt) {
    if (!r[6]) continue;
    const kind = String(r[4] || "").toUpperCase() === "PIUTANG" ? "Piutang" : "Utang";
    dueItems.push({ due: String(r[6]).slice(0, 10), label: `💳 ${kind}: ${r[3] || kind}`, amount: Math.max(0, (Number(r[5]) || 0) - (Number(r[9]) || 0)) });
  }
  for (const r of activeBills) {
    if (r[4]) dueItems.push({ due: String(r[4]).slice(0, 10), label: `🧾 ${r[2] || "Tagihan"}`, amount: Math.max(0, (Number(r[3]) || 0) - (Number(r[8]) || 0)) });
  }
  dueItems.sort((a, b) => a.due.localeCompare(b.due));

  const targetText = activeTargets.slice(0, 5).map(r => {
    const goal = Number(r[3]) || 0;
    const saved = Number(r[4]) || 0;
    const p = goal ? Math.min(100, saved / goal * 100) : 0;
    return `${r[2] || "Target"}: ${money(saved)} / ${money(goal)} (${p.toFixed(1)}%)`;
  });

  return { dueItems: dueItems.slice(0, 5), targetText };
}

async function analysis(bot, msg, weekly = false) {
  const owner = requireOwner(msg.from.id);
  const rows = await read("TRANSAKSI");
  const all = parseTransactions(rows, owner);
  const currentMonth = month();
  const previousMonth = (() => {
    const d = new Date(`${currentMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const current = weekly
    ? all.filter(x => x.date >= daysAgoDate(6) && x.date <= today())
    : all.filter(x => x.date.startsWith(currentMonth));
  const previous = all.filter(x => x.date.startsWith(previousMonth));
  const c = calc(current);
  const p = calc(previous);
  const topCategories = ranking(current, "category");
  const topWallets = ranking(current, "wallet");
  const biggest = biggestExpense(current);
  const extra = await extraSnapshot(owner);

  const incomeDelta = c.income - p.income;
  const expenseDelta = c.expense - p.expense;
  const delta = value => value >= 0 ? `+${money(value)}` : `-${money(Math.abs(value))}`;
  const lines = [
    `📊 ${weekly ? "LAPORAN 7 HARI" : "ANALISIS BULANAN V9"}`,
    `\n👤 ${owner}`,
    `📅 Periode: ${weekly ? `${daysAgoDate(6)} s/d ${today()}` : currentMonth}`,
    `\n📥 Pemasukan: ${money(c.income)}`,
    `📤 Pengeluaran: ${money(c.expense)}`,
    `💵 Selisih: ${money(c.net)}`,
    `📈 Saving rate: ${c.savingRate.toFixed(1)}%`,
    `📉 Expense rate: ${c.expenseRate.toFixed(1)}%`,
    `📑 Transaksi: ${current.length}`,
    `\n🔥 TOP KATEGORI`,
    formatTop(topCategories),
    `\n💳 TOP WALLET PENGELUARAN`,
    formatTop(topWallets),
    `\n💥 PENGELUARAN TERBESAR`,
    biggest ? `${biggest.category} — ${money(biggest.amount)}\n${biggest.date}${biggest.note ? `\n${biggest.note}` : ""}` : "Belum ada.",
    `\n📊 VS BULAN SEBELUMNYA (${previousMonth})`,
    `Pemasukan: ${delta(incomeDelta)}`,
    `Pengeluaran: ${delta(expenseDelta)}`,
    `Net bulan lalu: ${money(p.net)}`,
    `\n⏰ JATUH TEMPO TERDEKAT`,
    extra.dueItems.length ? extra.dueItems.map(x => `${x.due} • ${x.label} • ${money(x.amount)}`).join("\n") : "Tidak ada.",
    `\n🎯 TARGET AKTIF`,
    extra.targetText.length ? extra.targetText.join("\n") : "Tidak ada."
  ];

  return bot.sendMessage(msg.chat.id, lines.join("\n"));
}

function setupAnalysisHandlers(bot) {
  bot.onText(/^\/analisis(?:@\w+)?$/, m => analysis(bot, m).catch(e => bot.sendMessage(m.chat.id, e.message === "UNAUTHORIZED_USER" ? "❌ Akses ditolak." : "❌ Gagal membuat analisis.")));
  bot.onText(/^\/mingguan(?:@\w+)?$/, m => analysis(bot, m, true).catch(e => bot.sendMessage(m.chat.id, e.message === "UNAUTHORIZED_USER" ? "❌ Akses ditolak." : "❌ Gagal membuat laporan.")));
}

module.exports = { setupAnalysisHandlers };
