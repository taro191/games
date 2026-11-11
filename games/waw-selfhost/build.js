// สร้าง public/index.html จาก game-source.html + shim.js (แบบเดียวกับ build.py)  ใช้: node build.js . [--check]
const fs=require('fs'),p=require('path');const d=process.argv[2];
const src=fs.readFileSync(p.join(d,'game-source.html'),'utf8'),shim=fs.readFileSync(p.join(d,'shim.js'),'utf8');
const out=src.replace('<head>','<head>\n<script>\n'+shim+'\n</script>');
if(process.argv[3]==='--check'){console.log(out===fs.readFileSync(p.join(d,'public/index.html'),'utf8')?'IDENTICAL':'DIFFERENT');}else{fs.writeFileSync(p.join(d,'public/index.html'),out);console.log('built',out.length);}
