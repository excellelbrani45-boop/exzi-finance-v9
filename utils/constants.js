const OWNERS = Object.freeze(["EXCELL", "ZIZI", "BERSAMA"]);
const TYPES = Object.freeze(["PEMASUKAN", "PENGELUARAN", "TRANSFER"]);
const WALLETS = Object.freeze(["CASH", "BANK", "GOPAY", "OVO", "DANA", "SHOPEEPAY", "LAINNYA", "UTAMA"]);
const CATEGORIES = Object.freeze(["Makanan", "Transportasi", "Kost", "Belanja", "Pendidikan", "Hiburan", "Kerja", "Tagihan", "Kesehatan", "Lainnya"]);

function normalizeOwner(v) { const x=String(v||"").trim().toUpperCase(); return OWNERS.includes(x)?x:null; }
function normalizeWallet(v) { const x=String(v||"").trim().toUpperCase().replace(/[ -]/g,""); return WALLETS.includes(x)?x:null; }
function normalizeType(v) { const x=String(v||"").trim().toUpperCase(); return TYPES.includes(x)?x:null; }
function normalizeCategory(v) { const raw=String(v||"").trim().toLowerCase(); const found=CATEGORIES.find(x=>x.toLowerCase()===raw); return found||null; }

module.exports={OWNERS,TYPES,WALLETS,CATEGORIES,normalizeOwner,normalizeWallet,normalizeType,normalizeCategory};
