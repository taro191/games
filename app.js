'use strict';
/* games.yaydang.com - รวมทุกเกมไว้ในแอป Node เดียว (สำหรับ Plesk Node.js / Passenger หรือรัน node app.js เอง)
   /            หน้ารวมเกม (public/index.html)
   /isan/       จ่ายตลาดอีสาน
   /mitty90/    Mitty 90 Day เกมสร้างตัว 90 วัน
   /career/     Mitty Career เกมจำลองอาชีพ 90 วัน
   /settee/     ท่านเศรษฐี
   /waw/        คนเก่งเกินเบอร์ 5 (ตอบผิดคือชนะ) + WebSocket ที่ /waw/ws

   ค่าตั้งของแต่ละเกมใช้ตัวแปรสภาพแวดล้อมขึ้นต้นด้วยชื่อเกม เช่น ISAN_AUTH_MODE=both, SETTEE_PUBLIC_URL=...
   ค่าที่ไม่มีคำนำหน้า (เช่น COOKIE_SECURE=1, TRUST_PROXY=1) ใช้กับทุกเกม
   ข้อมูลผู้เล่นเก็บที่ STORAGE_DIR/<เกม> (ค่าเริ่มต้น ./storage ซึ่งไม่อยู่ใน git) */
const http = require('http'), fs = require('fs'), path = require('path');

// อ่าน .env ข้างไฟล์นี้ (ถ้ามี) โดยไม่ทับค่าที่ตั้งไว้แล้ว
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}

const PORT = +process.env.PORT || 3000;
const STORAGE = path.resolve(__dirname, process.env.STORAGE_DIR || 'storage');
const HUB = path.join(__dirname, 'public', 'index.html');
const m90 = require('./lib/m90-server');

// env ของเกม = env กลาง + ตัวแปร PREFIX_xxx (ตัดคำนำหน้าออก) + DATA_DIR ของเกมนั้น
function envFor(prefix, slug) {
  const e = Object.assign({}, process.env, { DATA_DIR: path.join(STORAGE, slug) });
  delete e.PORT;
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith(prefix + '_')) e[k.slice(prefix.length + 1)] = v;
  return e;
}

const GAMES = [
  { slug: 'isan', prefix: 'ISAN', make: (env, base) => m90.create({ name: 'จ่ายตลาดอีสาน', root: path.join(__dirname, 'games/isan-market-game/public'), env, base }) },
  { slug: 'mitty90', prefix: 'MITTY90', make: (env, base) => m90.create({ name: 'Mitty 90 Day', root: path.join(__dirname, 'games/mitty-90-day/public'), env, base }) },
  { slug: 'career', prefix: 'CAREER', make: (env, base) => m90.create({ name: 'Mitty Career', root: path.join(__dirname, 'games/mitty-career/public'), env, base }) },
  { slug: 'settee', prefix: 'SETTEE', make: (env, base) => require('./games/tan-set-thi/server').create({ env, base }) },
  { slug: 'waw', prefix: 'WAW', make: (env) => require('./games/waw-selfhost/server').create({ env }) },
];

const mounted = new Map();   // slug -> { handle, upgrade } หรือ { error }
for (const g of GAMES) {
  const base = '/' + g.slug;
  try {
    const r = g.make(envFor(g.prefix, g.slug), base);
    mounted.set(g.slug, typeof r === 'function' ? { handle: r } : r);
  } catch (e) {
    console.error('[' + g.slug + '] เปิดไม่ได้:', e.message);
    mounted.set(g.slug, { error: e.message });
  }
}

// แยก /slug/rest -> [slug, /rest]
function route(url) {
  const m = /^\/([a-z0-9]+)(\/.*|\?.*)?$/.exec(url || '/');
  return m && mounted.has(m[1]) ? [m[1], m[2] || ''] : null;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/', p = url.split('?')[0];
  if (p === '/healthz') {
    const st = {}; for (const [k, v] of mounted) st[k] = v.error ? 'error' : 'ok';
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ok: true, games: st }));
  }
  if (p === '/' || p === '/index.html') {
    return fs.readFile(HUB, (err, d) => {
      if (err) { res.writeHead(500); return res.end('hub missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(d);
    });
  }
  const shot = /^\/shots\/([a-z0-9]+)\.jpg$/.exec(p);   // ภาพปกเกมในหน้ารวม (บน Plesk nginx เสิร์ฟเองจาก public/)
  if (shot) {
    return fs.readFile(path.join(__dirname, 'public', 'shots', shot[1] + '.jpg'), (err, d) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); res.end(d);
    });
  }
  const r = route(url);
  if (!r) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  const [slug, rest] = r, g = mounted.get(slug);
  if (!rest || rest[0] === '?') {   // /isan -> /isan/ เพื่อให้ลิงก์แบบ relative ในหน้าเกมถูกต้อง
    res.writeHead(301, { Location: '/' + slug + '/' + rest }); return res.end();
  }
  if (g.error) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('เกมนี้ยังตั้งค่าไม่ครบ: ' + g.error); }
  req.url = rest;
  Promise.resolve(g.handle(req, res)).catch(e => { console.error('[' + slug + ']', e); if (!res.headersSent) { res.writeHead(500); } res.end(); });
});

server.on('upgrade', (req, socket, head) => {
  const r = route(req.url);
  const g = r && mounted.get(r[0]);
  if (!g || !g.upgrade) return socket.destroy();
  req.url = r[1];
  g.upgrade(req, socket, head);
});

server.listen(PORT, () => console.log('games: http://localhost:' + PORT + '  [' + [...mounted.keys()].join(', ') + ']'));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
