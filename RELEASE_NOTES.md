# EXZI FINANCE V9 — Production Audit Release

This package is the single production V9 source prepared before GitHub/deployment.

## Audit status

- JavaScript syntax checked across all project files.
- Local self-test passes.
- Module-load smoke test passes with dependency stubs.
- Obvious embedded secrets scan passes.
- `package-lock.json` included and synchronized to V9 root dependencies.
- Temporary/stale `services/sheets.js.tmp` removed.
- Transaction owner is derived from Telegram ID.
- Transaction `BULAN` is formula-derived from `TANGGAL` and is repaired on setup, including month/year rollover.
- Wallet balances include opening balance and transfer movements.
- Debt/bill payments are linked to real cash-flow transactions with duplicate markers.
- BERSAMA split bills, settlement, shared cash, history, and monthly report are included.
- Dashboard helper ranges target `CHART_DATA`, category charts include all configured categories, and BAR charts use the correct bottom axis.

## Secrets

`.env`, service-account JSON, bot tokens, and other credentials are intentionally not included.
