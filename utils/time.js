const TZ = process.env.TZ || "Asia/Jakarta";
function parts(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  return Object.fromEntries(p.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
}
function nowJakarta(){const p=parts(); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;}
function today(){const p=parts(); return `${p.year}-${p.month}-${p.day}`;}
function month(){return today().slice(0,7);}
function clock(){const p=parts(); return `${p.hour}:${p.minute}`;}
function greeting(){const h=Number(parts().hour); if(h<11)return "Selamat pagi"; if(h<15)return "Selamat siang"; if(h<18)return "Selamat sore"; return "Selamat malam";}
function daysAgoDate(n){const d=new Date(`${today()}T00:00:00+07:00`); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10);}
module.exports={TZ,nowJakarta,today,month,clock,greeting,daysAgoDate};
