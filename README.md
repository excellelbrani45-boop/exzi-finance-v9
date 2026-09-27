# EXZI FINANCE V9 — FINAL PRODUCTION

Telegram + Google Sheets personal finance bot for EXCELL, ZIZI, and their shared household/kost finances. This repository contains the production V9 source; secrets are intentionally excluded.

## Core features

- Personal income/expense tracking with owner isolation.
- Smart input: `makan 25k`, `gaji 5jt`, `transfer 100k`.
- Wallets with opening balances and automatic transfer-aware balances.
- Transaction history with protected edit/delete for ordinary transactions. Linked transactions (transfer, debt, bill, BERSAMA) are intentionally protected so relationships stay consistent.
- Debt / PayLater / installment / receivable tracking with partial payments, automatic cash-flow transactions, wallet balance checks, idempotent payment markers, and status updates.
- Bills with partial payments, automatic expense entries, recurring HARIAN/MINGGUAN/BULANAN/TAHUNAN creation, and reminder scheduler.
- Savings targets with deposit history.
- BERSAMA for EXCELL × ZIZI: split bills, custom shares, net obligations, settlement, shared cash, history, and monthly shared report.
- Monthly analysis with income, expense, net, saving/expense rate, top categories/wallets, biggest expense, previous-month comparison, due items, and target progress.
- Dashboard with 16 Google Sheets charts and hidden `CHART_DATA` helper sheet.
- Transaction month is derived from `TANGGAL`, so month/year rollover such as `2026-12` → `2027-01` remains correct.

## Google Sheets

The setup creates/ensures:

`TRANSAKSI`, `WALLET`, `UTANG`, `TAGIHAN`, `TARGET`, `ANALISIS`, `CONFIG`, `DASHBOARD`, `CHART_DATA`, `BERSAMA_BILLS`, `BERSAMA_SPLITS`, `BERSAMA_SETTLEMENTS`, `BERSAMA_KAS`, `UTANG_PEMBAYARAN`, `TAGIHAN_PEMBAYARAN`, `TARGET_SETORAN`.

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill the Telegram IDs, spreadsheet ID (ID only, not the `/edit` URL suffix), and a private Google Service Account credential.
3. Share the spreadsheet with the Service Account as Editor.
4. Run:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd test
npm.cmd run setup
npm.cmd start
```

## GitHub safety

Never commit `.env`, Service Account JSON, Telegram bot tokens, or any other secrets. `package-lock.json` should be committed.

## Hosting

For a 24/7 host, set the same environment variables in the host panel. Prefer `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` for the Service Account secret and keep the repository secret-free. Start command: `npm start`.

## Important accounting model

`TRANSAKSI` records real cash movement. `BERSAMA_*` records split/obligation metadata. A shared bill paid by EXCELL therefore creates an EXCELL expense in `TRANSAKSI`, while the other person’s share is tracked in `BERSAMA_SPLITS`. Settlement is recorded as paired TRANSFER rows, so reimbursements do not inflate income/expense.
