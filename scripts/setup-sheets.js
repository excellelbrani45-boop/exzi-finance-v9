require("dotenv").config(); const {setup}=require("../services/sheets"); setup().then(()=>console.log("Google Sheets V9 siap.")).catch(e=>{console.error(e);process.exit(1);});
