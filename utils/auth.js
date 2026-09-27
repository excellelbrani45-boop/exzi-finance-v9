const {normalizeOwner}=require('./constants');
function ownerFromTelegram(id){
  const s=String(id);
  if(process.env.EXCELL_TELEGRAM_ID && s===String(process.env.EXCELL_TELEGRAM_ID)) return "EXCELL";
  if(process.env.ZIZI_TELEGRAM_ID && s===String(process.env.ZIZI_TELEGRAM_ID)) return "ZIZI";
  return null;
}
function requireOwner(id){const o=ownerFromTelegram(id); if(!o) throw new Error("UNAUTHORIZED_USER"); return o;}
module.exports={ownerFromTelegram,requireOwner};
