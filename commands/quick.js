const {addTransaction}=require("../services/transactions");
const {extractAmount,removeAmount,money}=require("../utils/money");
const {normalizeWallet}=require("../utils/constants");
const {requireOwner}=require("../utils/auth");
const {get,begin,clear}=require("../utils/session");
const {startTransfer}=require("./transfer");
function detectCategory(t){const s=t.toLowerCase(); if(/makan|minum|kopi|jajan|kuliner/.test(s))return"Makanan"; if(/grab|gojek|transport|bensin|parkir|ojek|bus|kereta/.test(s))return"Transportasi"; if(/kost|kos|kontrakan/.test(s))return"Kost"; if(/belanja|beli|shopping|shopee|tokopedia/.test(s))return"Belanja"; if(/game|hiburan|nonton|film|bioskop/.test(s))return"Hiburan"; if(/tagihan|listrik|internet|wifi|pulsa|paket data/.test(s))return"Tagihan"; if(/kuliah|kampus|buku|pendidikan|spp/.test(s))return"Pendidikan"; if(/kerja|freelance|proyek/.test(s))return"Kerja"; return"Lainnya";}
function detectWallet(t){const s=t.toLowerCase(); if(/\bcash\b|tunai/.test(s))return"CASH"; if(/bank|rekening|bca|bri|mandiri|bni/.test(s))return"BANK"; if(/gopay|go pay/.test(s))return"GOPAY"; if(/ovo/.test(s))return"OVO"; if(/dana/.test(s))return"DANA"; if(/shopeepay|spay/.test(s))return"SHOPEEPAY"; return"UTAMA";}
function detectType(t){return /\b(gaji|dapat|dapet|masuk|pemasukan|income|bonus|uang masuk|dibayar|terima|diterima|fee|pendapatan)\b/i.test(t)?"PEMASUKAN":"PENGELUARAN";}
function keyboard(){return{reply_markup:{inline_keyboard:[[{text:"💰 Pemasukan",callback_data:"quick_income"},{text:"💸 Pengeluaran",callback_data:"quick_expense"}],[{text:"💳 Wallet",callback_data:"menu_wallet"},{text:"📊 Laporan",callback_data:"menu_laporan"}],[{text:"📈 Analisis",callback_data:"menu_analysis"},{text:"↩️ Menu",callback_data:"menu"}]]}};}
async function processQuick(bot,msg,text,forcedType=null){
  const amount=extractAmount(text); if(!amount) return false; const owner=requireOwner(msg.from.id); const type=forcedType||detectType(text); const category=type==="PEMASUKAN"?"Lainnya":detectCategory(text); const wallet=detectWallet(text); const note=removeAmount(text)||"-";
  await addTransaction({owner,type,amount,category,wallet,note}); await bot.sendMessage(msg.chat.id,`✅ TRANSAKSI TERCATAT\n\n👤 ${owner}\n${type==="PEMASUKAN"?"📥 Pemasukan":"📤 Pengeluaran"}\n💰 ${money(amount)}\n📂 ${category}\n💳 ${wallet}\n📝 ${note}`); return true;
}
function setupQuickHandlers(bot){
  bot.onText(/^\/quick(?:@\w+)?$/,m=>bot.sendMessage(m.chat.id,"⚡ QUICK INPUT\n\nContoh: makan 25k\nbensin 50rb\ngaji 5jt\ntransfer 100k",keyboard()));
  bot.on("message",async msg=>{if(!msg.text||msg.text.startsWith("/"))return; const active=get(msg.chat.id); if(active) { if(active.kind!=="quick_forced" || active.step!=="input") return; try { const ok=await processQuick(bot,msg,msg.text,active.forcedType); if(ok) clear(String(msg.chat.id)); } catch(e){ if(e.message!=="UNAUTHORIZED_USER") console.error("QUICK FORCED:",e); } return; } try{
    if(/^transfer\b/i.test(msg.text.trim())){
      const amount=extractAmount(msg.text);
      if(!amount){await bot.sendMessage(msg.chat.id,"❌ Untuk transfer, tulis contoh: transfer 100k");return;}
      await startTransfer(bot,msg,amount);
      return;
    }
    await processQuick(bot,msg,msg.text);
  }catch(e){if(e.message!=="UNAUTHORIZED_USER")console.error("QUICK:",e);}});
  bot.on("callback_query",async q=>{if(!q.data||!q.message)return; if(!["quick_income","quick_expense"].includes(q.data))return; await bot.answerCallbackQuery(q.id).catch(()=>{}); const forcedType=q.data==="quick_income"?"PEMASUKAN":"PENGELUARAN"; begin(String(q.message.chat.id),"quick_forced",{step:"input",forcedType}); await bot.sendMessage(q.message.chat.id,forcedType==="PEMASUKAN"?"📥 Ketik pemasukan, contoh: gaji 5jt":"📤 Ketik pengeluaran, contoh: makan 25k");});
}
module.exports={setupQuickHandlers,processQuick,detectCategory,detectWallet,detectType};
