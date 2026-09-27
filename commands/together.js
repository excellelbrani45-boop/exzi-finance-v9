const { requireOwner } = require("../utils/auth");
const { cleanAmount, money } = require("../utils/money");
const { WALLETS, CATEGORIES } = require("../utils/constants");
const { begin, get, clear } = require("../utils/session");
const {
  createSharedBill,
  getNetBalances,
  settle,
  kasTransfer,
  getKasBalances,
  getTogetherHistory,
  getMonthlyReport
} = require("../services/together");

function kb(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function walletKb(prefix) {
  const rows = [];
  for (let i = 0; i < WALLETS.length; i += 2) {
    rows.push(WALLETS.slice(i, i + 2).map(w => ({
      text: w,
      callback_data: `${prefix}${w}`
    })));
  }
  rows.push([{ text: "❌ Batal", callback_data: "together_cancel" }]);
  return kb(rows);
}

function menuKeyboard() {
  return kb([
    [
      { text: "➗ Split Bill", callback_data: "together_split" },
      { text: "📊 Saldo Antar Kita", callback_data: "together_balance" }
    ],
    [
      { text: "✅ Settle / Bayar", callback_data: "together_settle" },
      { text: "🏦 Kas Bersama", callback_data: "together_kas" }
    ],
    [
      { text: "📊 Laporan Bulanan", callback_data: "together_report" },
      { text: "📜 Riwayat", callback_data: "together_history" }
    ],
    [{ text: "↩️ Menu Utama", callback_data: "menu" }]
  ]);
}

async function menu(bot, chatId) {
  return bot.sendMessage(
    chatId,
    `💙💗 BERSAMA — KEUANGAN BERDUA\n\n` +
    `Split bill, kas bersama, saldo kewajiban, settlement, dan laporan bulanan EXCELL × ZIZI.\n\n` +
    `Pilih fitur:`,
    menuKeyboard()
  );
}

async function showBalance(bot, chatId) {
  const n = await getNetBalances();
  const text = n.direction === "BALANCED"
    ? "✅ Tidak ada kewajiban antar kalian.\n\nSaldo antar kita: SEIMBANG."
    : n.direction === "EXCELL_TO_ZIZI"
      ? `💸 EXCELL → ZIZI\n${money(n.amount)}\n\nEXCELL masih harus menyelesaikan ${money(n.amount)} ke ZIZI.`
      : `💸 ZIZI → EXCELL\n${money(n.amount)}\n\nZIZI masih harus menyelesaikan ${money(n.amount)} ke EXCELL.`;

  return bot.sendMessage(
    chatId,
    `📊 SALDO ANTAR KITA\n\n${text}`,
    kb([
      [{ text: "✅ Settle", callback_data: "together_settle" }],
      [{ text: "↩️ Kembali", callback_data: "together_menu" }]
    ])
  );
}

async function showKas(bot, chatId) {
  const w = await getKasBalances();
  const lines = Object.entries(w)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}: ${money(v)}`);
  return bot.sendMessage(
    chatId,
    `🏦 KAS BERSAMA\n\n${lines.length ? lines.join("\n") : "Belum ada saldo kas."}\n\nSetor uang ke kas bersama atau tarik kembali.`,
    kb([
      [
        { text: "➕ Setor", callback_data: "together_kas_setor" },
        { text: "➖ Tarik", callback_data: "together_kas_tarik" }
      ],
      [{ text: "↩️ Kembali", callback_data: "together_menu" }]
    ])
  );
}

async function showHistory(bot, chatId) {
  const h = await getTogetherHistory(12);
  if (!h.length) {
    return bot.sendMessage(chatId, "📜 Belum ada aktivitas BERSAMA.", kb([[{ text: "↩️ Kembali", callback_data: "together_menu" }]]));
  }
  return bot.sendMessage(
    chatId,
    "📜 RIWAYAT BERSAMA\n\n" + h.map((x, i) => `${i + 1}. ${x.date}\n${x.text}`).join("\n\n"),
    kb([[{ text: "↩️ Kembali", callback_data: "together_menu" }]])
  );
}

async function showMonthlyReport(bot, chatId) {
  const r = await getMonthlyReport();
  const kasLines = Object.entries(r.kasBalances)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k}: ${money(v)}`)
    .join("\n") || "Belum ada saldo kas.";

  const netText = r.net.direction === "BALANCED"
    ? "✅ Seimbang"
    : r.net.direction === "EXCELL_TO_ZIZI"
      ? `💙 EXCELL → 💗 ZIZI ${money(r.net.amount)}`
      : `💗 ZIZI → 💙 EXCELL ${money(r.net.amount)}`;

  return bot.sendMessage(
    chatId,
    `📊 LAPORAN BERSAMA — ${r.month}\n\n` +
    `🧾 Split bill: ${r.billCount}\n` +
    `💰 Total pengeluaran bersama: ${money(r.total)}\n\n` +
    `💙 EXCELL membayar: ${money(r.paidBy.EXCELL)}\n` +
    `💗 ZIZI membayar: ${money(r.paidBy.ZIZI)}\n\n` +
    `📌 Porsi EXCELL: ${money(r.shareBy.EXCELL)}\n` +
    `📌 Porsi ZIZI: ${money(r.shareBy.ZIZI)}\n\n` +
    `✅ Settlement bulan ini: ${money(r.settlements)}\n` +
    `🤝 Kewajiban aktif saat ini: ${money(r.outstanding)}\n` +
    `🔄 Posisi net: ${netText}\n\n` +
    `🏦 Setor kas bulan ini: ${money(r.kasSetor)}\n` +
    `🏦 Tarik kas bulan ini: ${money(r.kasTarik)}\n` +
    `💳 Saldo kas sekarang:\n${kasLines}`,
    kb([[{ text: "↩️ BERSAMA", callback_data: "together_menu" }]])
  );
}

function categoryKb() {
  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    rows.push(CATEGORIES.slice(i, i + 2).map(c => ({
      text: c,
      callback_data: `together_cat_${c}`
    })));
  }
  rows.push([{ text: "❌ Batal", callback_data: "together_cancel" }]);
  return kb(rows);
}

function splitMethodKb() {
  return kb([
    [
      { text: "50 : 50", callback_data: "together_method_50" },
      { text: "% Persentase", callback_data: "together_method_pct" }
    ],
    [{ text: "💵 Nominal Manual", callback_data: "together_method_nom" }],
    [{ text: "❌ Batal", callback_data: "together_cancel" }]
  ]);
}

async function startSplit(bot, chatId) {
  begin(String(chatId), "together", { flow: "split", step: "payer", data: {} });
  return bot.sendMessage(
    chatId,
    "➗ SPLIT BILL\n\nSiapa yang membayar seluruh tagihan?",
    kb([
      [
        { text: "💙 EXCELL", callback_data: "together_payer_EXCELL" },
        { text: "💗 ZIZI", callback_data: "together_payer_ZIZI" }
      ],
      [{ text: "❌ Batal", callback_data: "together_cancel" }]
    ])
  );
}

async function startSettle(bot, chatId) {
  const n = await getNetBalances();
  if (n.direction === "BALANCED") {
    return bot.sendMessage(chatId, "✅ Tidak ada saldo kewajiban yang perlu disettle.", kb([[{ text: "↩️ Kembali", callback_data: "together_menu" }]]));
  }
  const from = n.direction === "EXCELL_TO_ZIZI" ? "EXCELL" : "ZIZI";
  const to = from === "EXCELL" ? "ZIZI" : "EXCELL";
  begin(String(chatId), "together", {
    flow: "settle",
    step: "amount",
    data: { from, to, max: n.amount }
  });
  return bot.sendMessage(chatId, `✅ SETTLE\n\n${from} → ${to}\nTotal kewajiban: ${money(n.amount)}\n\nMasukkan nominal yang mau dibayar:`);
}

async function startKas(bot, chatId, direction) {
  begin(String(chatId), "together", { flow: "kas", step: "owner", data: { direction } });
  return bot.sendMessage(
    chatId,
    direction === "SETOR" ? "➕ SETOR KAS BERSAMA\n\nSiapa yang setor?" : "➖ TARIK KAS BERSAMA\n\nSiapa yang menerima uang?",
    kb([
      [
        { text: "💙 EXCELL", callback_data: "together_kas_owner_EXCELL" },
        { text: "💗 ZIZI", callback_data: "together_kas_owner_ZIZI" }
      ],
      [{ text: "❌ Batal", callback_data: "together_cancel" }]
    ])
  );
}

function errorMessage(e) {
  const map = {
    INVALID_TOTAL: "Total tidak valid.",
    SPLIT_NOT_EQUAL_TOTAL: "Pembagian harus tepat sama dengan total.",
    INVALID_SETTLEMENT_AMOUNT: "Nominal settlement tidak valid.",
    SETTLEMENT_TOO_HIGH: "Nominal melebihi kewajiban saat ini.",
    NOTHING_TO_SETTLE: "Tidak ada kewajiban yang perlu diselesaikan.",
    WRONG_SETTLEMENT_DIRECTION: "Arah settlement tidak sesuai saldo antar kalian.",
    KAS_INSUFFICIENT: "Saldo kas bersama di wallet tersebut tidak cukup.",
    KAS_OWNER_INSUFFICIENT: "Saldo wallet penyetor tidak cukup. Isi saldo awal atau gunakan wallet lain.",
    SETTLEMENT_INSUFFICIENT: "Saldo wallet pembayar tidak cukup untuk settlement.",
    TOGETHER_PAYER_INSUFFICIENT: "Saldo wallet pembayar tidak cukup untuk split bill.",
    INVALID_WALLET: "Wallet tidak valid."
  };
  return map[e.message] || "Terjadi error saat memproses fitur BERSAMA.";
}

function setupTogetherHandlers(bot) {
  bot.onText(/^\/bersama(?:@\w+)?$/, async m => {
    try {
      requireOwner(m.from.id);
      await menu(bot, m.chat.id);
    } catch {
      await bot.sendMessage(m.chat.id, "❌ Akses ditolak.");
    }
  });

  bot.onText(/^\/bersama_laporan(?:@\w+)?$/, async m => {
    try {
      requireOwner(m.from.id);
      await showMonthlyReport(bot, m.chat.id);
    } catch (e) {
      console.error("BERSAMA REPORT:", e);
      await bot.sendMessage(m.chat.id, "❌ Gagal membuat laporan BERSAMA.");
    }
  });

  bot.on("callback_query", async q => {
    if (!q.data || !q.message) return;
    const d = q.data;
    const id = String(q.message.chat.id);
    if (!(d === "menu_bersama" || d.startsWith("together_"))) return;

    await bot.answerCallbackQuery(q.id).catch(() => {});

    try {
      requireOwner(q.from.id);

      if (d === "menu_bersama" || d === "together_menu") return menu(bot, q.message.chat.id);
      if (d === "together_balance") return showBalance(bot, q.message.chat.id);
      if (d === "together_history") return showHistory(bot, q.message.chat.id);
      if (d === "together_report") return showMonthlyReport(bot, q.message.chat.id);
      if (d === "together_split") return startSplit(bot, q.message.chat.id);
      if (d === "together_settle") return startSettle(bot, q.message.chat.id);
      if (d === "together_kas") return showKas(bot, q.message.chat.id);
      if (d === "together_kas_setor") return startKas(bot, q.message.chat.id, "SETOR");
      if (d === "together_kas_tarik") return startKas(bot, q.message.chat.id, "TARIK");
      if (d === "together_cancel") {
        clear(id);
        return bot.sendMessage(q.message.chat.id, "❌ Dibatalkan.", kb([[{ text: "💙💗 Bersama", callback_data: "together_menu" }]]));
      }

      const s = get(id);
      if (!s || s.kind !== "together") {
        return bot.sendMessage(q.message.chat.id, "⚠️ Sesi BERSAMA tidak ditemukan.");
      }
      if (s.processing) {
        return bot.sendMessage(q.message.chat.id, "⏳ Proses sebelumnya masih berjalan. Tunggu sebentar.");
      }

      if (d.startsWith("together_payer_")) {
        s.data.payer = d.slice("together_payer_".length);
        s.step = "description";
        return bot.sendMessage(q.message.chat.id, "📝 Deskripsi pengeluaran bersama?\nContoh: Makan malam, Internet kost, Belanja bulanan");
      }

      if (d.startsWith("together_cat_")) {
        const cat = d.slice("together_cat_".length);
        if (!CATEGORIES.includes(cat)) return bot.sendMessage(q.message.chat.id, "❌ Kategori tidak valid.");
        s.data.category = cat;
        s.step = "method";
        return bot.sendMessage(q.message.chat.id, "➗ Cara pembagian:", splitMethodKb());
      }

      if (d.startsWith("together_method_")) {
        s.data.method = d.slice("together_method_".length);
        if (s.data.method === "50") {
          s.data.shares = {
            EXCELL: Math.floor(s.data.total / 2),
            ZIZI: s.data.total - Math.floor(s.data.total / 2)
          };
          s.step = "wallet";
          return bot.sendMessage(q.message.chat.id, "💳 Wallet yang dipakai pembayar:", walletKb("together_wallet_"));
        }
        s.step = s.data.method === "pct" ? "percent" : "nominal_excell";
        return bot.sendMessage(
          q.message.chat.id,
          s.data.method === "pct" ? "Masukkan persentase EXCELL (0-100). ZIZI otomatis sisanya." : "Bagian EXCELL berapa?"
        );
      }

      if (d.startsWith("together_wallet_")) {
        const w = d.slice("together_wallet_".length);
        if (!WALLETS.includes(w)) return bot.sendMessage(q.message.chat.id, "❌ Wallet tidak valid.");
        s.data.wallet = w;
        s.step = "confirm_split";
        return confirmSplit(bot, q.message.chat.id, s);
      }

      if (d === "together_confirm_split") {
        if (s.step !== "confirm_split") return bot.sendMessage(q.message.chat.id, "⚠️ Konfirmasi split bill sudah tidak berlaku.");
        s.processing = true;
        try {
          const result = await createSharedBill(s.data);
          clear(id);
          const other = result.payer === "EXCELL" ? "ZIZI" : "EXCELL";
          const otherShare = result.split[other];
          return bot.sendMessage(
            q.message.chat.id,
            `✅ SPLIT BILL TERCATAT\n\n` +
            `📝 ${s.data.description}\n` +
            `💰 ${money(result.total)}\n` +
            `💳 Dibayar ${result.payer} via ${result.wallet}\n\n` +
            `💙 EXCELL: ${money(result.split.EXCELL)}\n` +
            `💗 ZIZI: ${money(result.split.ZIZI)}\n\n` +
            (otherShare ? `🤝 ${other} sekarang punya kewajiban ${money(otherShare)} ke ${result.payer}.` : "✅ Tidak ada kewajiban antar kalian.") +
            `\n\n📤 Pengeluaran otomatis masuk ke TRANSAKSI ${result.payer}.`,
            kb([
              [{ text: "📊 Cek Saldo Antar Kita", callback_data: "together_balance" }],
              [{ text: "💙💗 Bersama", callback_data: "together_menu" }]
            ])
          );
        } catch (e) {
          s.processing = false;
          throw e;
        }
      }

      if (d.startsWith("together_settle_wallet_from_")) {
        s.data.walletFrom = d.slice("together_settle_wallet_from_".length);
        s.step = "wallet_to";
        return bot.sendMessage(q.message.chat.id, `💳 Wallet penerima (${s.data.to}):`, walletKb("together_settle_wallet_to_"));
      }

      if (d.startsWith("together_settle_wallet_to_")) {
        s.data.walletTo = d.slice("together_settle_wallet_to_".length);
        s.step = "confirm_settle";
        return bot.sendMessage(
          q.message.chat.id,
          `✅ Konfirmasi settlement\n\n${s.data.from} → ${s.data.to}\n💰 ${money(s.data.amount)}\n💳 ${s.data.walletFrom} → ${s.data.walletTo}`,
          kb([
            [{ text: "✅ Bayar Sekarang", callback_data: "together_confirm_settle" }],
            [{ text: "❌ Batal", callback_data: "together_cancel" }]
          ])
        );
      }

      if (d === "together_confirm_settle") {
        if (s.step !== "confirm_settle") return bot.sendMessage(q.message.chat.id, "⚠️ Konfirmasi settlement sudah tidak berlaku.");
        s.processing = true;
        try {
          const result = await settle(s.data);
          clear(id);
          return bot.sendMessage(
            q.message.chat.id,
            `✅ SETTLEMENT TERCATAT\n\n` +
            `${result.from} → ${result.to}\n` +
            `💰 ${money(result.amount)}\n` +
            `💳 ${result.walletFrom} → ${result.walletTo}\n\n` +
            `📊 Sisa kewajiban bersama: ${money(result.remainingNet)}\n\n` +
            `🔄 Transfer otomatis tercatat ke TRANSAKSI kedua pihak.`
          );
        } catch (e) {
          s.processing = false;
          throw e;
        }
      }

      if (d.startsWith("together_kas_owner_")) {
        const owner = d.slice("together_kas_owner_".length);
        if (!["EXCELL", "ZIZI"].includes(owner)) return bot.sendMessage(q.message.chat.id, "❌ Pemilik tidak valid.");
        s.data.owner = owner;
        s.step = "amount";
        return bot.sendMessage(q.message.chat.id, "💰 Masukkan nominal:");
      }

      if (d.startsWith("together_kas_wallet_owner_")) {
        s.data.walletOwner = d.slice("together_kas_wallet_owner_".length);
        s.step = "wallet_kas";
        return bot.sendMessage(q.message.chat.id, "💳 Pilih wallet KAS BERSAMA:", walletKb("together_kas_wallet_kas_"));
      }

      if (d.startsWith("together_kas_wallet_kas_")) {
        s.data.walletKas = d.slice("together_kas_wallet_kas_".length);
        s.step = "note";
        return bot.sendMessage(q.message.chat.id, "📝 Keterangan (atau -):");
      }
    } catch (e) {
      console.error("TOGETHER CALLBACK:", e);
      return bot.sendMessage(q.message.chat.id, "❌ " + errorMessage(e));
    }
  });

  bot.on("message", async m => {
    if (!m.text || m.text.startsWith("/")) return;
    const id = String(m.chat.id);
    const s = get(id);
    if (!s || s.kind !== "together") return;

    if (s.processing) return;

    const t = m.text.trim();
    try {
      if (s.flow === "split") {
        if (s.step === "description") {
          if (!t) return bot.sendMessage(m.chat.id, "❌ Deskripsi tidak boleh kosong.");
          s.data.description = t.slice(0, 200);
          s.step = "total";
          return bot.sendMessage(m.chat.id, "💰 Total tagihan?");
        }
        if (s.step === "total") {
          const a = cleanAmount(t);
          if (!a) return bot.sendMessage(m.chat.id, "❌ Total tidak valid.");
          s.data.total = a;
          s.step = "category";
          return bot.sendMessage(m.chat.id, "🏷️ Kategori pengeluaran bersama:", categoryKb());
        }
        if (s.step === "percent") {
          const p = Number(t.replace(",", "."));
          if (!Number.isFinite(p) || p < 0 || p > 100) return bot.sendMessage(m.chat.id, "❌ Persentase 0-100.");
          s.data.shares = {
            EXCELL: Math.round(s.data.total * p / 100),
            ZIZI: s.data.total - Math.round(s.data.total * p / 100)
          };
          s.step = "wallet";
          return bot.sendMessage(m.chat.id, "💳 Wallet yang dipakai pembayar:", walletKb("together_wallet_"));
        }
        if (s.step === "nominal_excell") {
          const a = cleanAmount(t);
          if (a < 0 || a > s.data.total) return bot.sendMessage(m.chat.id, "❌ Nominal EXCELL tidak valid.");
          s.data.excellShare = a;
          s.step = "nominal_zizi";
          return bot.sendMessage(m.chat.id, `Bagian ZIZI? Total ${money(s.data.total)}. Masukkan nominal ZIZI:`);
        }
        if (s.step === "nominal_zizi") {
          const a = cleanAmount(t);
          if (a < 0 || a > s.data.total) return bot.sendMessage(m.chat.id, "❌ Nominal ZIZI tidak valid.");
          if (s.data.excellShare + a !== s.data.total) return bot.sendMessage(m.chat.id, `❌ Total harus ${money(s.data.total)}. Bagian EXCELL ${money(s.data.excellShare)}.`);
          s.data.shares = { EXCELL: s.data.excellShare, ZIZI: a };
          s.step = "wallet";
          return bot.sendMessage(m.chat.id, "💳 Wallet yang dipakai pembayar:", walletKb("together_wallet_"));
        }
      }

      if (s.flow === "settle" && s.step === "amount") {
        const a = cleanAmount(t);
        if (!a || a > s.data.max) return bot.sendMessage(m.chat.id, `❌ Maksimal ${money(s.data.max)}.`);
        s.data.amount = a;
        s.step = "wallet_from";
        return bot.sendMessage(m.chat.id, `💳 Wallet ${s.data.from}:`, walletKb("together_settle_wallet_from_"));
      }

      if (s.flow === "kas") {
        if (s.step === "amount") {
          const a = cleanAmount(t);
          if (!a) return bot.sendMessage(m.chat.id, "❌ Nominal tidak valid.");
          s.data.amount = a;
          s.step = "wallet_owner";
          return bot.sendMessage(m.chat.id, `💳 Wallet ${s.data.owner}:`, walletKb("together_kas_wallet_owner_"));
        }
        if (s.step === "note") {
          s.data.note = t === "-" ? "" : t.slice(0, 500);
          s.processing = true;
          try {
            const result = await kasTransfer(s.data);
            clear(id);
            return bot.sendMessage(
              m.chat.id,
              `✅ KAS BERSAMA ${result.direction === "SETOR" ? "BERHASIL DIISI" : "BERHASIL DITARIK"}\n\n` +
              `👤 ${result.owner}\n` +
              `💰 ${money(result.amount)}\n` +
              `💳 ${result.walletOwner} ↔ ${result.walletKas}\n\n` +
              `🔄 Transfer otomatis tercatat dan saldo wallet diperbarui.`
            );
          } catch (e) {
            s.processing = false;
            throw e;
          }
        }
      }
    } catch (e) {
      console.error("TOGETHER TEXT:", e);
      return bot.sendMessage(m.chat.id, "❌ " + errorMessage(e));
    }
  });
}

async function confirmSplit(bot, chatId, s) {
  const x = s.data;
  const exShare = x.shares?.EXCELL ?? Math.floor(x.total / 2);
  const ziShare = x.shares?.ZIZI ?? Math.ceil(x.total / 2);
  return bot.sendMessage(
    chatId,
    `📋 KONFIRMASI SPLIT BILL\n\n` +
    `📝 ${x.description}\n` +
    `💰 Total ${money(x.total)}\n` +
    `💙 EXCELL ${money(exShare)}\n` +
    `💗 ZIZI ${money(ziShare)}\n` +
    `💳 Payer ${x.payer}\n` +
    `💳 Wallet ${x.wallet}`,
    kb([
      [{ text: "✅ Simpan", callback_data: "together_confirm_split" }],
      [{ text: "❌ Batal", callback_data: "together_cancel" }]
    ])
  );
}

module.exports = { setupTogetherHandlers, menu };
