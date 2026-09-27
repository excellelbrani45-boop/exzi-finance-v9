function money(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(n) || 0);
}

function cleanAmount(text) {
  if (text === undefined || text === null) return 0;
  let value = String(text).trim().toLowerCase().replace(/\s/g, "").replace(/rp/g, "");
  if (!value) return 0;

  const suffix = value.match(/(juta|jt|ribu|rb|k)$/i)?.[1]?.toLowerCase() || "";
  if (suffix) value = value.slice(0, -suffix.length);
  if (!value) return 0;

  if (suffix === "juta" || suffix === "jt" || suffix === "ribu" || suffix === "rb" || suffix === "k") {
    const normalized = value.replace(",", ".");
    const base = Number(normalized);
    if (!Number.isFinite(base) || base < 0) return 0;
    const multiplier = suffix === "juta" || suffix === "jt" ? 1_000_000 : 1_000;
    return Math.round(base * multiplier);
  }

  // Indonesian grouped thousands: 1.500.000 / 1,500,000.
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value)) {
    value = value.replace(/\./g, "").replace(",", ".");
    return Number(value) || 0;
  }
  if (/^\d{1,3}(?:,\d{3})+$/.test(value)) {
    return Number(value.replace(/,/g, "")) || 0;
  }

  value = value.replace(/\./g, ".").replace(/,(?=\d+$)/, ".");
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0;
}

function extractAmount(text) {
  const source = String(text || "");
  const pattern = /(?:rp\s*)?(?:\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:juta|jt|ribu|rb|k)?/i;
  const match = source.match(pattern);
  return match ? cleanAmount(match[0]) : 0;
}

function removeAmount(text) {
  const source = String(text || "");
  const pattern = /(?:rp\s*)?(?:\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:juta|jt|ribu|rb|k)?/gi;
  return source.replace(pattern, " ").replace(/\s+/g, " ").trim();
}

module.exports = { money, cleanAmount, extractAmount, removeAmount };
