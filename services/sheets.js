require("dotenv").config();

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

function normalizeSpreadsheetId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  return raw.replace(/[?#].*$/, "").replace(/\/edit.*$/, "").trim();
}

const SPREADSHEET_ID = normalizeSpreadsheetId(process.env.SPREADSHEET_ID);

let authClient = null;
let sheetsClient = null;

const REQUIRED = {
  TRANSAKSI: [
    "ID", "TANGGAL", "PEMILIK", "TIPE", "NOMINAL",
    "KATEGORI", "WALLET", "KETERANGAN", "BULAN", "TIMESTAMP"
  ],
  WALLET: [
    "ID", "PEMILIK", "NAMA WALLET", "SALDO AWAL", "KETERANGAN"
  ],
  UTANG: [
    "ID", "TANGGAL", "PEMILIK", "PIHAK", "JENIS", "NOMINAL",
    "JATUH TEMPO", "STATUS", "KETERANGAN", "TERBAYAR"
  ],
  TAGIHAN: [
    "ID", "PEMILIK", "NAMA TAGIHAN", "NOMINAL",
    "JATUH TEMPO", "STATUS", "RECURRING", "KETERANGAN", "TERBAYAR"
  ],
  TARGET: [
    "ID", "PEMILIK", "TARGET", "NOMINAL TARGET",
    "TERKUMPUL", "DEADLINE", "STATUS", "KETERANGAN"
  ],
  ANALISIS: [
    "BULAN", "PEMILIK", "PEMASUKAN", "PENGELUARAN",
    "SELISIH", "SAVING RATE", "EXPENSE RATE", "TOP KATEGORI"
  ],
  CONFIG: ["KEY", "VALUE"],
  DASHBOARD: [],
  CHART_DATA: [],
  BERSAMA_BILLS: [
    "ID", "TANGGAL", "DESKRIPSI", "KATEGORI", "TOTAL", "PAYER", "WALLET",
    "STATUS", "EXCELL SHARE", "ZIZI SHARE", "KETERANGAN"
  ],
  BERSAMA_SPLITS: [
    "ID", "BILL_ID", "OWNER", "SHARE_AMOUNT", "PAID_BY", "OWES_TO",
    "PAID_AMOUNT", "REMAINING", "STATUS", "SETTLED_AT"
  ],
  BERSAMA_SETTLEMENTS: [
    "ID", "TANGGAL", "FROM_OWNER", "TO_OWNER", "NOMINAL", "WALLET_FROM",
    "WALLET_TO", "TRANSACTION_OUT_ID", "TRANSACTION_IN_ID", "KETERANGAN"
  ],
  BERSAMA_KAS: [
    "ID", "TANGGAL", "OWNER", "TIPE", "NOMINAL", "WALLET_OWNER",
    "WALLET_KAS", "TRANSACTION_OUT_ID", "TRANSACTION_IN_ID", "KETERANGAN"
  ],
  UTANG_PEMBAYARAN: [
    "ID", "UTANG_ID", "TANGGAL", "PEMILIK", "JENIS", "NOMINAL",
    "WALLET", "TRANSACTION_ID", "PAYMENT_ID"
  ],
  TAGIHAN_PEMBAYARAN: [
    "ID", "TAGIHAN_ID", "TANGGAL", "PEMILIK", "NOMINAL", "WALLET",
    "TRANSACTION_ID", "PAYMENT_ID"
  ],
  TARGET_SETORAN: [
    "ID", "TARGET_ID", "TANGGAL", "PEMILIK", "NOMINAL", "KETERANGAN"
  ]
};

const OWNERS = ["EXCELL", "ZIZI", "BERSAMA"];
const CATEGORIES = [
  "Makanan",
  "Transportasi",
  "Kost",
  "Belanja",
  "Pendidikan",
  "Hiburan",
  "Kerja",
  "Tagihan",
  "Kesehatan",
  "Lainnya"
];
const WALLETS = [
  "CASH",
  "BANK",
  "GOPAY",
  "OVO",
  "DANA",
  "SHOPEEPAY",
  "LAINNYA",
  "UTAMA"
];

function assertConfig() {
  if (!SPREADSHEET_ID) {
    throw new Error("SPREADSHEET_ID belum diisi.");
  }
}

async function getAuth() {
  assertConfig();

  if (authClient) {
    return authClient;
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    const raw = Buffer
      .from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64")
      .toString("utf8");

    authClient = new google.auth.GoogleAuth({
      credentials: JSON.parse(raw),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
      ]
    });
  } else {
    const file = path.resolve(
      process.env.GOOGLE_SERVICE_ACCOUNT_FILE ||
      "./exzi-finance-509812-9acd3572321f.json"
    );

    if (!fs.existsSync(file)) {
      throw new Error(
        `Google Service Account JSON tidak ditemukan: ${file}`
      );
    }

    authClient = new google.auth.GoogleAuth({
      keyFile: file,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
      ]
    });
  }

  return authClient;
}

async function getSheets() {
  if (sheetsClient) {
    return sheetsClient;
  }

  sheetsClient = google.sheets({
    version: "v4",
    auth: await getAuth()
  });

  return sheetsClient;
}

async function getMeta() {
  const api = await getSheets();
  const result = await api.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    includeGridData: false
  });
  return result.data;
}

async function ensureSheets() {
  const api = await getSheets();
  const meta = await getMeta();

  const existing = new Set(
    (meta.sheets || []).map(s => s.properties.title)
  );

  const requests = Object.keys(REQUIRED)
    .filter(name => !existing.has(name))
    .map(title => ({
      addSheet: {
        properties: { title }
      }
    }));

  if (requests.length) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests }
    });
  }

  return true;
}


async function ensureChartDataSheet(api) {
  const meta = await getMeta();
  let sheet = (meta.sheets || []).find(s => s.properties.title === "CHART_DATA");

  if (!sheet) {
    const created = await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: "CHART_DATA",
              gridProperties: {
                rowCount: 1000,
                columnCount: 53
              }
            }
          }
        }]
      }
    });

    const props = created.data.replies?.[0]?.addSheet?.properties;
    if (props) {
      sheet = { properties: props };
    }
  }

  if (!sheet) {
    const fresh = await getMeta();
    sheet = (fresh.sheets || []).find(s => s.properties.title === "CHART_DATA");
  }

  if (!sheet) {
    throw new Error("Sheet CHART_DATA tidak dapat dibuat.");
  }

  const chartDataId = sheet.properties.sheetId;

  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: chartDataId,
            gridProperties: {
              columnCount: 53,
              rowCount: 1000
            }
          },
          fields: "gridProperties.columnCount,gridProperties.rowCount"
        }
      }]
    }
  });

  return chartDataId;
}

async function append(sheet, values) {
  const api = await getSheets();
  return api.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] }
  });
}

async function read(sheet) {
  const api = await getSheets();
  const result = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A:Z`
  });
  return result.data.values || [];
}

async function update(range, values) {
  const api = await getSheets();
  return api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function clear(range) {
  const api = await getSheets();
  return api.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
}

async function getConfigMap() {
  const rows = await read("CONFIG");
  const map = new Map();
  for (const row of rows.slice(1)) {
    const key = String(row[0] || "").trim();
    if (key) map.set(key, String(row[1] || ""));
  }
  return map;
}

async function setConfig(key, value) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) throw new Error("CONFIG_KEY_EMPTY");
  const rows = await read("CONFIG");
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][0] || "").trim() === cleanKey) {
      return update(`CONFIG!A${i + 1}:B${i + 1}`, [[cleanKey, String(value ?? "")]]);
    }
  }
  return append("CONFIG", [cleanKey, String(value ?? "")]);
}

async function writeAnalysisSheet() {
  const rows = [
    ["BULAN", "PEMILIK", "PEMASUKAN", "PENGELUARAN", "SELISIH", "SAVING RATE", "EXPENSE RATE", "TOP KATEGORI"],
    ["=TEXT(TODAY(),\"yyyy-mm\")", "EXCELL", "=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,A2,TRANSAKSI!C:C,B2,TRANSAKSI!D:D,\"PEMASUKAN\")", "=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,A2,TRANSAKSI!C:C,B2,TRANSAKSI!D:D,\"PENGELUARAN\")", "=C2-D2", "=IFERROR(E2/C2,0)", "=IFERROR(D2/C2,0)", ""],
    ["=TEXT(TODAY(),\"yyyy-mm\")", "ZIZI", "=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,A3,TRANSAKSI!C:C,B3,TRANSAKSI!D:D,\"PEMASUKAN\")", "=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,A3,TRANSAKSI!C:C,B3,TRANSAKSI!D:D,\"PENGELUARAN\")", "=C3-D3", "=IFERROR(E3/C3,0)", "=IFERROR(D3/C3,0)", ""],
    ["=TEXT(TODAY(),\"yyyy-mm\")", "BERSAMA", "=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,A4,TRANSAKSI!C:C,B4,TRANSAKSI!D:D,\"PEMASUKAN\")", "=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,A4,TRANSAKSI!C:C,B4,TRANSAKSI!D:D,\"PENGELUARAN\")", "=C4-D4", "=IFERROR(E4/C4,0)", "=IFERROR(D4/C4,0)", ""],
    ["=TEXT(TODAY(),\"yyyy-mm\")", "TOTAL", "=SUM(C2:C4)", "=SUM(D2:D4)", "=C5-D5", "=IFERROR(E5/C5,0)", "=IFERROR(D5/C5,0)", ""
    ]
  ];
  await clear("ANALISIS!A1:H50");
  await update("ANALISIS!A1:H5", rows);
}

async function setupSheets() {
  const api = await getSheets();
  await ensureSheets();

  for (const [name, headers] of Object.entries(REQUIRED)) {
    if (!headers.length) {
      continue;
    }

    const current = await read(name);
    const first = current[0] || [];

    if (first.join("|") !== headers.join("|")) {
      await api.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${name}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [headers] }
      });
    }
  }

  await repairTransactionMonthFormulas();
  await writeAnalysisSheet();
  await styleSheets();
  return true;
}

async function repairTransactionMonthFormulas() {
  const rows = await read("TRANSAKSI");
  if (!Array.isArray(rows) || rows.length <= 1) return;

  const formulas = [];
  for (let rowNumber = 2; rowNumber <= rows.length; rowNumber += 1) {
    formulas.push([`=IF(B${rowNumber}="","",IFERROR(TEXT(B${rowNumber},"yyyy-mm"),LEFT(B${rowNumber},7)))`]);
  }
  await update(`TRANSAKSI!I2:I${rows.length}`, formulas);
}

async function styleSheets() {
  const api = await getSheets();
  const meta = await getMeta();
  const requests = [];

  for (const sheet of meta.sheets || []) {
    const id = sheet.properties.sheetId;

    // Dashboard/legacy sheets may contain merged cells.
    // Do not freeze rows here to avoid Google Sheets merge conflicts.

    requests.push({
      repeatCell: {
        range: {
          sheetId: id,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: {
              red: 0.04,
              green: 0.18,
              blue: 0.38
            },
            textFormat: {
              foregroundColor: {
                red: 1,
                green: 1,
                blue: 1
              },
              bold: true
            },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE"
          }
        },
        fields: "userEnteredFormat"
      }
    });
  }

  if (requests.length) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests }
    });
  }
}

function cellRange(sheetId, r1, r2, c1, c2) {
  return {
    sheetId,
    startRowIndex: r1,
    endRowIndex: r2,
    startColumnIndex: c1,
    endColumnIndex: c2
  };
}

function chartPosition(sheetId, rowIndex, columnIndex, widthPixels = 520, heightPixels = 300) {
  return {
    overlayPosition: {
      anchorCell: {
        sheetId,
        rowIndex,
        columnIndex
      },
      offsetXPixels: 0,
      offsetYPixels: 0,
      widthPixels,
      heightPixels
    }
  };
}

function source(sheetId, r1, r2, c1, c2) {
  return {
    sourceRange: {
      sources: [cellRange(sheetId, r1, r2, c1, c2)]
    }
  };
}

function pieRequest(sheetId, title, labelRange, valueRange, position) {
  return {
    addChart: {
      chart: {
        spec: {
          title,
          hiddenDimensionStrategy: "SHOW_ALL",
          pieChart: {
            legendPosition: "RIGHT_LEGEND",
            pieHole: 0.5,
            domain: {
              sourceRange: {
                sources: [cellRange(sheetId, ...labelRange)]
              }
            },
            series: {
              sourceRange: {
                sources: [cellRange(sheetId, ...valueRange)]
              }
            }
          }
        },
        position
      }
    }
  };
}

function barRequest(sheetId, title, labelRange, valueRange, position, chartType = "BAR") {
  return {
    addChart: {
      chart: {
        spec: {
          title,
          hiddenDimensionStrategy: "SHOW_ALL",
          basicChart: {
            chartType,
            legendPosition: "RIGHT_LEGEND",
            headerCount: 1,
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [cellRange(sheetId, ...labelRange)]
                  }
                }
              }
            ],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [cellRange(sheetId, ...valueRange)]
                  }
                },
                targetAxis: chartType === "BAR" ? "BOTTOM_AXIS" : "LEFT_AXIS"
              }
            ]
          }
        },
        position
      }
    }
  };
}

function groupedRequest(sheetId, title, labelRange, seriesRanges, position, chartType = "COLUMN") {
  return {
    addChart: {
      chart: {
        spec: {
          title,
          hiddenDimensionStrategy: "SHOW_ALL",
          basicChart: {
            chartType,
            legendPosition: "BOTTOM_LEGEND",
            headerCount: 1,
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [cellRange(sheetId, ...labelRange)]
                  }
                }
              }
            ],
            series: seriesRanges.map(r => ({
              series: {
                sourceRange: {
                  sources: [cellRange(sheetId, ...r)]
                }
              },
              targetAxis: chartType === "BAR" ? "BOTTOM_AXIS" : "LEFT_AXIS"
            }))
          }
        },
        position
      }
    }
  };
}

async function clearDashboardCharts(api, dashboard) {
  const charts = dashboard.charts || [];
  if (!charts.length) {
    return;
  }

  const requests = charts
    .map(chart => chart.chartId)
    .filter(id => Number.isInteger(id))
    .map(objectId => ({
      deleteEmbeddedObject: { objectId }
    }));

  if (!requests.length) {
    return;
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests }
  });

  console.log(`${requests.length} grafik Dashboard lama dihapus.`);
}


function walletBalanceFormula(wallet, owner = null) {
  const walletCriteria = `"${wallet}"`;
  const ownerIn = owner ? `,TRANSAKSI!C:C,"${owner}"` : "";
  const ownerWallet = owner ? `,WALLET!B:B,"${owner}"` : "";
  return `=SUMIFS(WALLET!D:D,WALLET!C:C,${walletCriteria}${ownerWallet})` +
    `+SUMIFS(TRANSAKSI!E:E,TRANSAKSI!G:G,${walletCriteria},TRANSAKSI!D:D,"PEMASUKAN"${ownerIn})` +
    `-SUMIFS(TRANSAKSI!E:E,TRANSAKSI!G:G,${walletCriteria},TRANSAKSI!D:D,"PENGELUARAN"${ownerIn})` +
    `+SUMIFS(TRANSAKSI!E:E,TRANSAKSI!G:G,${walletCriteria},TRANSAKSI!D:D,"TRANSFER",TRANSAKSI!H:H,"TRANSFER_IN|*"${ownerIn})` +
    `-SUMIFS(TRANSAKSI!E:E,TRANSAKSI!G:G,${walletCriteria},TRANSAKSI!D:D,"TRANSFER",TRANSAKSI!H:H,"TRANSFER_OUT|*"${ownerIn})`;
}

function ownerBalanceFormula(owner) {
  return `=SUMIFS(WALLET!D:D,WALLET!B:B,"${owner}")` +
    `+SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"${owner}",TRANSAKSI!D:D,"PEMASUKAN")` +
    `-SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"${owner}",TRANSAKSI!D:D,"PENGELUARAN")` +
    `+SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"${owner}",TRANSAKSI!D:D,"TRANSFER",TRANSAKSI!H:H,"TRANSFER_IN|*")` +
    `-SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"${owner}",TRANSAKSI!D:D,"TRANSFER",TRANSAKSI!H:H,"TRANSFER_OUT|*")`;
}

function dashboardRows() {
  return [
    ["EXZI FINANCE V9 — DASHBOARD", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["EXCELL × ZIZI × BERSAMA | Ringkasan & Visualisasi Keuangan", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["UPDATE", '=TEXT(NOW(),"dd mmmm yyyy hh:mm")', "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["KPI", "NILAI", "", "KPI", "NILAI", "", "KPI", "NILAI", "", "KATEGORI", "PENGELUARAN", "", "WALLET", "SALDO", ""],
    ["TOTAL SALDO", '=SUM(WALLET!D:D)+SUMIF(TRANSAKSI!D:D,"PEMASUKAN",TRANSAKSI!E:E)-SUMIF(TRANSAKSI!D:D,"PENGELUARAN",TRANSAKSI!E:E)', "", "PEMASUKAN", '=SUMIF(TRANSAKSI!D:D,"PEMASUKAN",TRANSAKSI!E:E)', "", "PENGELUARAN", '=SUMIF(TRANSAKSI!D:D,"PENGELUARAN",TRANSAKSI!E:E)', "", "Makanan", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Makanan",TRANSAKSI!D:D,"PENGELUARAN")', "", "CASH", walletBalanceFormula("CASH"), ""],
    ["SAVING RATE", '=IFERROR((E5-G5)/E5,0)', "", "EXPENSE RATE", '=IFERROR(G5/E5,0)', "", "TRANSAKSI", '=COUNTA(TRANSAKSI!A:A)-1', "", "Transportasi", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Transportasi",TRANSAKSI!D:D,"PENGELUARAN")', "", "BANK", walletBalanceFormula("BANK"), ""],
    ["EXCELL SALDO", ownerBalanceFormula("EXCELL"), "", "ZIZI SALDO", ownerBalanceFormula("ZIZI"), "", "BERSAMA SALDO", ownerBalanceFormula("BERSAMA"), "", "Kost", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Kost",TRANSAKSI!D:D,"PENGELUARAN")', "", "GOPAY", walletBalanceFormula("GOPAY"), ""],
    ["OWNER", "PEMASUKAN", "PENGELUARAN", "SALDO", "SAVING RATE", "TRANSAKSI", "", "", "", "Belanja", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Belanja",TRANSAKSI!D:D,"PENGELUARAN")', "", "OVO", walletBalanceFormula("OVO"), ""],
    ["EXCELL", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"EXCELL",TRANSAKSI!D:D,"PEMASUKAN")', '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"EXCELL",TRANSAKSI!D:D,"PENGELUARAN")', ownerBalanceFormula("EXCELL"), '=IFERROR((B9-C9)/B9,0)', '=COUNTIF(TRANSAKSI!C:C,"EXCELL")', "", "", "", "Pendidikan", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Pendidikan",TRANSAKSI!D:D,"PENGELUARAN")', "", "DANA", walletBalanceFormula("DANA"), ""],
    ["ZIZI", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"ZIZI",TRANSAKSI!D:D,"PEMASUKAN")', '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"ZIZI",TRANSAKSI!D:D,"PENGELUARAN")', ownerBalanceFormula("ZIZI"), '=IFERROR((B10-C10)/B10,0)', '=COUNTIF(TRANSAKSI!C:C,"ZIZI")', "", "", "", "Hiburan", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Hiburan",TRANSAKSI!D:D,"PENGELUARAN")', "", "SHOPEEPAY", walletBalanceFormula("SHOPEEPAY"), ""],
    ["BERSAMA", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"BERSAMA",TRANSAKSI!D:D,"PEMASUKAN")', '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"BERSAMA",TRANSAKSI!D:D,"PENGELUARAN")', ownerBalanceFormula("BERSAMA"), '=IFERROR((B11-C11)/B11,0)', '=COUNTIF(TRANSAKSI!C:C,"BERSAMA")', "", "", "", "Kerja", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Kerja",TRANSAKSI!D:D,"PENGELUARAN")', "", "LAINNYA", walletBalanceFormula("LAINNYA"), ""],
    ["", "", "", "", "", "", "", "", "", "Tagihan", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Tagihan",TRANSAKSI!D:D,"PENGELUARAN")', "", "UTAMA", walletBalanceFormula("UTAMA"), ""],
    ["", "", "", "", "", "", "", "", "", "Kesehatan", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Kesehatan",TRANSAKSI!D:D,"PENGELUARAN")', "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "Lainnya", '=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"Lainnya",TRANSAKSI!D:D,"PENGELUARAN")', "", "", "", ""],
    ["TARGET & TAGIHAN", "", "", "", "", "", "", "", "", "", "", "", "TAGIHAN AKTIF", "UTANG AKTIF", ""],
    ["Tagihan Aktif", '=COUNTIF(TAGIHAN!F:F,"AKTIF")+COUNTIF(TAGIHAN!F:F,"SEBAGIAN")', "", "Utang Aktif", '=COUNTIF(UTANG!H:H,"AKTIF")+COUNTIF(UTANG!H:H,"SEBAGIAN")', "", "", "", "", "TARGET", '=COUNTA(TARGET!A:A)-1', "", "TAGIHAN", '=COUNTIF(TAGIHAN!F:F,"AKTIF")+COUNTIF(TAGIHAN!F:F,"SEBAGIAN")', ""],
    ["Target Aktif", '=COUNTIF(TARGET!G:G,"AKTIF")', "", "Target Terkumpul", '=SUM(TARGET!E:E)', "", "", "", "", "TOTAL TAGIHAN", '=SUM(TAGIHAN!D:D)', "", "UTANG", '=COUNTIF(UTANG!H:H,"AKTIF")+COUNTIF(UTANG!H:H,"SEBAGIAN")', ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]
  ];
}
async function writeHelperData(api, sheetId) {
  // Semua helper data diarahkan eksplisit ke CHART_DATA.
  const targetSheet = "CHART_DATA";
  const overallRows = [
    ["JENIS", "PEMASUKAN", "PENGELUARAN"],
    ["TOTAL",
      '=SUMIF(TRANSAKSI!D:D,"PEMASUKAN",TRANSAKSI!E:E)',
      '=SUMIF(TRANSAKSI!D:D,"PENGELUARAN",TRANSAKSI!E:E)'
    ]
  ];

  const ownerRows = [
    ["OWNER", "PEMASUKAN", "PENGELUARAN", "SALDO", "SAVING RATE", "TRANSAKSI"],
    ...OWNERS.map((owner, i) => {
      const r = i + 2;
      return [
        owner,
        `=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"${owner}",TRANSAKSI!D:D,"PEMASUKAN")`,
        `=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!C:C,"${owner}",TRANSAKSI!D:D,"PENGELUARAN")`,
        ownerBalanceFormula(owner),
        `=IFERROR((B${r}-C${r})/B${r},0)`,
        `=COUNTIF(TRANSAKSI!C:C,"${owner}")`
      ];
    })
  ];

  const overallCategories = [
    ["KATEGORI", "PENGELUARAN"],
    ...CATEGORIES.map(category => [
      category,
      `=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"${category}",TRANSAKSI!D:D,"PENGELUARAN")`
    ])
  ];

  const overallWallets = [
    ["WALLET", "SALDO"],
    ...WALLETS.map(wallet => [
      wallet,
      walletBalanceFormula(wallet)
    ])
  ];

  const monthly = [["BULAN", "PEMASUKAN", "PENGELUARAN"]];
  for (let i = 11; i >= 0; i--) {
    const row = monthly.length + 1;
    monthly.push([
      `=TEXT(EDATE(TODAY(),-${i}),"yyyy-mm")`,
      `=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,AC${row},TRANSAKSI!D:D,"PEMASUKAN")`,
      `=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!I:I,AC${row},TRANSAKSI!D:D,"PENGELUARAN")`
    ]);
  }

  const values = [
    {
      range: `${targetSheet}!A1:C2`,
      values: overallRows
    },
    {
      range: `${targetSheet}!P1:U4`,
      values: ownerRows
    },
    {
      range: `${targetSheet}!W1:X11`,
      values: overallCategories
    },
    {
      range: `${targetSheet}!Z1:AA9`,
      values: overallWallets
    },
    {
      range: `${targetSheet}!AC1:AE13`,
      values: monthly
    }
  ];

  const categoryStarts = [
    ["AG", "AH", "EXCELL"],
    ["AJ", "AK", "ZIZI"],
    ["AM", "AN", "BERSAMA"]
  ];

  for (const [lc, vc, owner] of categoryStarts) {
    values.push({
      range: `${targetSheet}!${lc}1:${vc}11`,
      values: [
        ["KATEGORI", owner],
        ...CATEGORIES.map(category => [
          category,
          owner === "BERSAMA"
            ? `=SUMIFS(BERSAMA_BILLS!E:E,BERSAMA_BILLS!D:D,"${category}")`
            : `=SUMIFS(TRANSAKSI!E:E,TRANSAKSI!F:F,"${category}",TRANSAKSI!D:D,"PENGELUARAN",TRANSAKSI!C:C,"${owner}")`
        ])
      ]
    });
  }

  const walletStarts = [
    ["AP", "AQ", "EXCELL"],
    ["AS", "AT", "ZIZI"],
    ["AV", "AW", "BERSAMA"]
  ];

  for (const [lc, vc, owner] of walletStarts) {
    values.push({
      range: `${targetSheet}!${lc}1:${vc}11`,
      values: [
        ["WALLET", owner],
        ...WALLETS.map(wallet => [
          wallet,
          walletBalanceFormula(wallet, owner)
        ])
      ]
    });
  }

  const targetRows = [["TARGET", "NOMINAL", "TERKUMPUL"]];
  for (let i = 2; i <= 11; i++) {
    targetRows.push([
      `=IFERROR(TARGET!C${i},"")`,
      `=IFERROR(TARGET!D${i},0)`,
      `=IFERROR(TARGET!E${i},0)`
    ]);
  }
  values.push({
    range: `${targetSheet}!AY1:BA11`,
    values: targetRows
  });

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: values
    }
  });
}

async function setupDashboard() {
  const api = await getSheets();
  await ensureSheets();

  let meta = await getMeta();
  let dashboard = (meta.sheets || []).find(
    s => s.properties.title === "DASHBOARD"
  );

  if (!dashboard) {
    throw new Error("Sheet DASHBOARD tidak ditemukan.");
  }

  const id = dashboard.properties.sheetId;
  const chartDataId = await ensureChartDataSheet(api);

  // Pastikan area Dashboard cukup besar untuk seluruh chart.
  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: id,
              gridProperties: {
                rowCount: 180,
                columnCount: 15
              }
            },
            fields: "gridProperties.rowCount,gridProperties.columnCount"
          }
        }
      ]
    }
  });

  await clearDashboardCharts(api, dashboard);

  await api.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "DASHBOARD!A1:O120"
  });

  await api.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "CHART_DATA!A1:BA1000"
  });

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "DASHBOARD!A1:O18",
          values: dashboardRows()
        }
      ]
    }
  });

  await writeHelperData(api, chartDataId);

  const formatRequests = [
    {
      updateDimensionProperties: {
        range: {
          sheetId: id,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 15
        },
        properties: { pixelSize: 105 },
        fields: "pixelSize"
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: id,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: 18
        },
        properties: { pixelSize: 30 },
        fields: "pixelSize"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 0, 1, 0, 15),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.02, green: 0.08, blue: 0.18 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
              fontSize: 20
            },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 1, 2, 0, 15),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.05, green: 0.25, blue: 0.60 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 3, 17, 0, 15),
        cell: {
          userEnteredFormat: {
            borders: {
              top: { style: "SOLID" },
              bottom: { style: "SOLID" },
              left: { style: "SOLID" },
              right: { style: "SOLID" }
            }
          }
        },
        fields: "userEnteredFormat.borders"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 3, 4, 0, 8),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.35, blue: 0.72 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 3, 4, 9, 11),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.35, blue: 0.72 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 3, 4, 12, 14),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.35, blue: 0.72 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 7, 8, 0, 6),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.35, blue: 0.72 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 14, 15, 0, 6),
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.35, blue: 0.72 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 4, 17, 1, 15),
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "CURRENCY",
              pattern: 'Rp #,##0'
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 5, 6, 1, 2),
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "PERCENT",
              pattern: "0.0%"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: cellRange(id, 8, 10, 4, 5),
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "PERCENT",
              pattern: "0.0%"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    }
  ];

  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: formatRequests }
  });

  const chartRequests = [];

  // 1. Overall income vs expense
  chartRequests.push(
    groupedRequest(
      chartDataId,
      "TOTAL PEMASUKAN vs PENGELUARAN",
      [0, 2, 0, 1],
      [[0, 2, 1, 2], [0, 2, 2, 3]],
      chartPosition(id, 19, 0, 520, 300),
      "COLUMN"
    )
  );

  // 2. Overall categories
  chartRequests.push(
    pieRequest(
      chartDataId,
      "PENGELUARAN — SEMUA",
      [0, 11, 22, 23],
      [0, 11, 23, 24],
      chartPosition(id, 19, 7, 520, 300)
    )
  );

  // 3. Overall wallets
  chartRequests.push(
    barRequest(
      chartDataId,
      "SALDO WALLET — SEMUA",
      [0, 9, 25, 26],
      [0, 9, 26, 27],
      chartPosition(id, 36, 0, 520, 300),
      "BAR"
    )
  );

  // 4. Owner balance
  chartRequests.push(
    barRequest(
      chartDataId,
      "SALDO EXCELL vs ZIZI vs BERSAMA",
      [0, 4, 15, 16],
      [0, 4, 18, 19],
      chartPosition(id, 36, 7, 520, 300),
      "BAR"
    )
  );

  // 5. Owner income
  chartRequests.push(
    barRequest(
      chartDataId,
      "PEMASUKAN PER PEMILIK",
      [0, 4, 15, 16],
      [0, 4, 16, 17],
      chartPosition(id, 53, 0, 520, 300),
      "COLUMN"
    )
  );

  // 6. Owner expense
  chartRequests.push(
    barRequest(
      chartDataId,
      "PENGELUARAN PER PEMILIK",
      [0, 4, 15, 16],
      [0, 4, 17, 18],
      chartPosition(id, 53, 7, 520, 300),
      "COLUMN"
    )
  );

  // 7. Saving rate per owner
  chartRequests.push(
    barRequest(
      chartDataId,
      "SAVING RATE PER PEMILIK",
      [0, 4, 15, 16],
      [0, 4, 19, 20],
      chartPosition(id, 70, 0, 520, 300),
      "COLUMN"
    )
  );

  // 8. Transaction count per owner
  chartRequests.push(
    barRequest(
      chartDataId,
      "JUMLAH TRANSAKSI PER PEMILIK",
      [0, 4, 15, 16],
      [0, 4, 20, 21],
      chartPosition(id, 70, 7, 520, 300),
      "COLUMN"
    )
  );

  // 9-11 category charts by owner
  const catCharts = [
    ["EXCELL", [0, 11, 32, 33], [0, 11, 33, 34], 86, 0],
    ["ZIZI", [0, 11, 35, 36], [0, 11, 36, 37], 86, 7],
    ["BERSAMA", [0, 11, 38, 39], [0, 11, 39, 40], 103, 0]
  ];

  for (const [owner, labels, valuesRange, row, col] of catCharts) {
    chartRequests.push(
      pieRequest(
        chartDataId,
        `PENGELUARAN KATEGORI — ${owner}`,
        labels,
        valuesRange,
        chartPosition(id, row, col, 520, 300)
      )
    );
  }

  // 12-14 wallets by owner
  const walletCharts = [
    ["EXCELL", [0, 9, 41, 42], [0, 9, 42, 43], 103, 7],
    ["ZIZI", [0, 9, 44, 45], [0, 9, 45, 46], 120, 0],
    ["BERSAMA", [0, 9, 47, 48], [0, 9, 48, 49], 120, 7]
  ];

  for (const [owner, labels, valuesRange, row, col] of walletCharts) {
    chartRequests.push(
      barRequest(
        chartDataId,
        `SALDO WALLET — ${owner}`,
        labels,
        valuesRange,
        chartPosition(id, row, col, 520, 300),
        "BAR"
      )
    );
  }

  // 15 monthly trend
  chartRequests.push(
    groupedRequest(
      chartDataId,
      "TREND 12 BULAN — PEMASUKAN vs PENGELUARAN",
      [0, 13, 28, 29],
      [[0, 13, 29, 30], [0, 13, 30, 31]],
      chartPosition(id, 138, 0, 520, 300),
      "LINE"
    )
  );

  // 16 target progress
  chartRequests.push(
    groupedRequest(
      chartDataId,
      "TARGET TABUNGAN — NOMINAL vs TERKUMPUL",
      [0, 11, 50, 51],
      [[0, 11, 51, 52], [0, 11, 52, 53]],
      chartPosition(id, 138, 7, 520, 300),
      "COLUMN"
    )
  );

  let chartCreated = 0;

  // Buat chart satu per satu. Dengan cara ini, satu chart yang ditolak
  // Google Sheets tidak menggagalkan semua chart lainnya.
  for (let i = 0; i < chartRequests.length; i += 1) {
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [chartRequests[i]]
        }
      });

      chartCreated += 1;
    } catch (error) {
      console.warn(
        `Grafik ${i + 1} gagal dibuat:`,
        error.message
      );
    }
  }

  console.log(
    `${chartCreated}/${chartRequests.length} grafik Dashboard V9 berhasil dibuat.`
  );

  if (chartCreated > 0) {
    try {
      const verify = await getMeta();
      const verifyDashboard = (verify.sheets || []).find(
        s => s.properties.title === "DASHBOARD"
      );
      console.log(
        `Verifikasi Dashboard: ${(verifyDashboard?.charts || []).length} chart tersimpan.`
      );
    } catch (error) {
      console.warn("Verifikasi chart dilewati:", error.message);
    }
  }

  // Sheet CHART_DATA disembunyikan supaya Dashboard tetap bersih.
  try {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: chartDataId,
                hidden: true
              },
              fields: "hidden"
            }
          }
        ]
      }
    });
  } catch (error) {
    console.warn("CHART_DATA tidak bisa disembunyikan:", error.message);
  }

  return true;
}

async function setup() {
  await setupSheets();
  await setupDashboard();

  console.log("=====================================");
  console.log(" SETUP GOOGLE SHEETS V9 BERHASIL");
  console.log("=====================================");
  console.log("Dashboard lengkap siap.");
}

module.exports = {
  getAuth,
  getSheets,
  getMeta,
  ensureSheets,
  setupSheets,
  setupDashboard,
  setup,
  append,
  read,
  update,
  clear,
  getConfigMap,
  setConfig,
  writeAnalysisSheet,
  normalizeSpreadsheetId,
  SPREADSHEET_ID
};
