'use strict';
/* เซิร์ฟเวอร์ร่วมของเกมตระกูล Mitty (จ่ายตลาดอีสาน, Mitty 90 Day, Mitty Career) - Node >= 18 ไม่ต้องติดตั้งแพ็กเกจเพิ่ม
   - ให้บริการ public/landing.html (/) และ public/index.html (/play)
   - บัญชีผู้ใช้ (อีเมล+รหัสผ่าน) และ/หรือ Login ผ่าน 500 Windows Thailand (OAuth2 Authorization Code + PKCE)
   - เก็บความก้าวหน้าของผู้เล่นฝั่งเซิร์ฟเวอร์ (ข้ามเครื่องได้)

   create({ name, root, env, base }) คืน handler(req, res) ที่รับ req.url แบบตัด base ออกแล้ว (เช่น /play, /api/me)
   base = path ที่เกมถูกเมานต์ (เช่น /isan) ใช้กับ Path ของคุกกี้และการ redirect */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function create({ name = 'game', root, env = process.env, base = '' }) {
  const ROOT = path.resolve(root);
  const DATA = path.resolve(env.DATA_DIR || path.join(ROOT, '..', 'server', 'data'));
  const MODE = (env.AUTH_MODE || 'local').toLowerCase();           // local | 500w | both
  const LOCAL = MODE === 'local' || MODE === 'both';
  const SSO = MODE === '500w' || MODE === 'both';
  const GUEST = env.ALLOW_GUEST === '1';   // 1 = มีปุ่ม "ลองเล่นก่อน" (บันทึกในเบราว์เซอร์ ไม่ต้องสมัคร)
  const W = { auth: env.W500_AUTH_URL, token: env.W500_TOKEN_URL, info: env.W500_USERINFO_URL, id: env.W500_CLIENT_ID,
    secret: env.W500_CLIENT_SECRET || '', redirect: env.W500_REDIRECT_URI, scope: env.W500_SCOPE || 'openid profile email',
    idf: env.W500_ID_FIELD || 'sub', namef: env.W500_NAME_FIELD || 'name', mailf: env.W500_EMAIL_FIELD || 'email' };
  if (!['local', '500w', 'both'].includes(MODE)) throw new Error(name + ': AUTH_MODE ต้องเป็น local, 500w หรือ both');
  if (SSO && !(W.auth && W.token && W.info && W.id && W.redirect))
    throw new Error(name + ': AUTH_MODE=' + MODE + ' ต้องตั้งค่า W500_AUTH_URL, W500_TOKEN_URL, W500_USERINFO_URL, W500_CLIENT_ID, W500_REDIRECT_URI');
  fs.mkdirSync(path.join(DATA, 'states'), { recursive: true });

  const SECRET = env.SESSION_SECRET || (() => { const f = path.join(DATA, 'secret.key');
    try { return fs.readFileSync(f, 'utf8'); } catch (e) { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, s, { mode: 0o600 }); return s; } })();
  const wr = (f, o) => { const t = f + '.' + process.pid + '.tmp'; fs.writeFileSync(t, typeof o === 'string' ? o : JSON.stringify(o)); fs.renameSync(t, f); };
  const UF = path.join(DATA, 'users.json'); let USERS = {};
  try { USERS = JSON.parse(fs.readFileSync(UF, 'utf8')); } catch (e) {}
  const saveUsers = () => wr(UF, USERS);
  const stateFile = id => path.join(DATA, 'states', id.replace(/[^a-zA-Z0-9-]/g, '') + '.json');

  const b64 = b => Buffer.from(b).toString('base64url');
  const mac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
  const sign = o => { const p = b64(JSON.stringify(o)); return p + '.' + mac(p); };
  const unsign = t => { if (!t) return null; const [p, m] = String(t).split('.'); if (!p || !m) return null; const e = mac(p);
    if (e.length !== m.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(m))) return null;
    try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch (e) { return null; } };
  const cookies = req => { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; };
  const COOKIE_PATH = (base || '') + '/';   // แยกคุกกี้ของแต่ละเกมที่อยู่โดเมนเดียวกัน
  const setCookie = (res, n, val, maxAge) => { const a = [n + '=' + encodeURIComponent(val), 'Path=' + COOKIE_PATH, 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + maxAge];
    if (env.COOKIE_SECURE === '1') a.push('Secure'); res.setHeader('Set-Cookie', [].concat(res.getHeader('Set-Cookie') || [], a.join('; '))); };
  const DAYS = 30;
  const startSession = (res, uid) => setCookie(res, 'm90s', sign({ uid, exp: Date.now() + DAYS * 864e5 }), DAYS * 86400);
  const userOf = req => { const o = unsign(cookies(req).m90s); return o && USERS[o.uid] || null; };
  const pub = u => ({ id: u.id, name: u.name || '', email: u.email || '', provider: u.provider });

  const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
  const readBody = (req, max = 600000) => new Promise((ok, no) => { let n = 0; const c = [];
    req.on('data', d => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); });
    req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c).toString()) : {}); } catch (e) { no(new Error('bad json')); } });
    req.on('error', no); });
  const hits = new Map();
  const limited = (req, n = 10, ms = 600000) => { const ip = (env.TRUST_PROXY === '1' && req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < ms); a.push(now); hits.set(ip, a); return a.length > n; };
  setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 600000)) hits.delete(k); }, 600000).unref();
  const hashPw = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, (e, k) => e ? no(e) : ok(k.toString('hex'))));
  const mail = e => String(e || '').trim().toLowerCase();

  async function api(req, res, u) {
    const m = req.method, p = u.pathname;
    if (m === 'GET' && p === '/api/config') return send(res, 200, { local: LOCAL, sso: SSO, guest: GUEST, fonts: fs.existsSync(path.join(ROOT, 'fonts', 'fonts.css')) });
    if (m !== 'GET' && req.headers['x-requested-with'] !== 'm90') return send(res, 403, { error: 'forbidden' });
    if (m === 'GET' && p === '/api/me') { const me = userOf(req); return me ? send(res, 200, pub(me)) : send(res, 401, { error: 'ยังไม่ได้เข้าสู่ระบบ' }); }
    if (m === 'POST' && p === '/api/logout') { setCookie(res, 'm90s', '', 0); return send(res, 200, { ok: true }); }
    if (m === 'POST' && (p === '/api/register' || p === '/api/login')) {
      if (!LOCAL) return send(res, 403, { error: 'ระบบนี้เข้าสู่ระบบผ่าน 500 Windows Thailand เท่านั้น' });
      if (limited(req)) return send(res, 429, { error: 'ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่' });
      const b = await readBody(req), email = mail(b.email), pw = String(b.pw || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return send(res, 400, { error: 'อีเมลไม่ถูกต้อง' });
      const ex = Object.values(USERS).find(x => x.provider === 'local' && x.email === email);
      if (p === '/api/register') {
        if (pw.length < 8 || pw.length > 200) return send(res, 400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว' });
        if (ex) return send(res, 409, { error: 'อีเมลนี้สมัครไว้แล้ว' });
        const id = crypto.randomUUID(), salt = crypto.randomBytes(16).toString('hex');
        USERS[id] = { id, provider: 'local', email, name: String(b.name || '').trim().slice(0, 40), salt, hash: await hashPw(pw, salt), created: Date.now() };
        saveUsers(); startSession(res, id); return send(res, 200, pub(USERS[id]));
      }
      const ok = ex && crypto.timingSafeEqual(Buffer.from(await hashPw(pw, ex.salt), 'hex'), Buffer.from(ex.hash, 'hex'));
      if (!ok) return send(res, 401, { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      startSession(res, ex.id); return send(res, 200, pub(ex));
    }
    const me = userOf(req); if (!me) return send(res, 401, { error: 'ยังไม่ได้เข้าสู่ระบบ' });
    if (p === '/api/state' && m === 'GET') { try { const s = JSON.parse(fs.readFileSync(stateFile(me.id), 'utf8')); return send(res, 200, { exists: true, blob: s.blob, at: s.at }); } catch (e) { return send(res, 200, { exists: false }); } }
    if (p === '/api/state' && m === 'PUT') { const b = await readBody(req, 500000); if (typeof b.blob !== 'string') return send(res, 400, { error: 'bad blob' });
      wr(stateFile(me.id), { blob: b.blob, at: Date.now() }); return send(res, 200, { ok: true }); }
    if (p === '/api/account' && m === 'DELETE') { try { fs.unlinkSync(stateFile(me.id)); } catch (e) {} delete USERS[me.id]; saveUsers(); setCookie(res, 'm90s', '', 0); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'not found' });
  }

  async function sso(req, res, u) {
    if (!SSO) { res.writeHead(404); return res.end(); }
    if (u.pathname === '/auth/500w/login') {
      const state = crypto.randomBytes(16).toString('hex'), ver = crypto.randomBytes(32).toString('base64url');
      setCookie(res, 'm90o', sign({ s: state, v: ver, exp: Date.now() + 600000 }), 600);
      const q = new URLSearchParams({ response_type: 'code', client_id: W.id, redirect_uri: W.redirect, scope: W.scope, state,
        code_challenge: crypto.createHash('sha256').update(ver).digest('base64url'), code_challenge_method: 'S256' });
      res.writeHead(302, { Location: W.auth + (W.auth.includes('?') ? '&' : '?') + q }); return res.end();
    }
    const fail = () => { res.writeHead(302, { Location: base + '/play?autherr=1' }); res.end(); };
    try {
      const o = unsign(cookies(req).m90o), code = u.searchParams.get('code');
      if (!o || !code || u.searchParams.get('state') !== o.s) return fail();
      setCookie(res, 'm90o', '', 0);
      const tk = await fetch(W.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: W.redirect, client_id: W.id, client_secret: W.secret, code_verifier: o.v }) });
      const t = await tk.json(); if (!tk.ok || !t.access_token) return fail();
      const ir = await fetch(W.info, { headers: { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json' } });
      const info = await ir.json(); const sub = info && info[W.idf] != null ? String(info[W.idf]) : ''; if (!ir.ok || !sub) return fail();
      let usr = Object.values(USERS).find(x => x.provider === '500w' && x.sub === sub);
      if (!usr) { const id = crypto.randomUUID(); usr = USERS[id] = { id, provider: '500w', sub, created: Date.now() }; }
      usr.name = String(info[W.namef] || usr.name || '').slice(0, 40); usr.email = String(info[W.mailf] || usr.email || '').slice(0, 120); saveUsers();
      startSession(res, usr.id); res.writeHead(302, { Location: base + '/play' }); res.end();
    } catch (e) { fail(); }
  }

  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
  const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  function serve(req, res, u) {
    let p; try { p = decodeURIComponent(u.pathname); } catch (e) { p = ''; }
    if (p === '/') p = fs.existsSync(path.join(ROOT, 'landing.html')) ? '/landing.html' : '/index.html';   // หน้าแรก (Landing)
    else if (p === '/play') p = '/index.html';                                                           // ตัวเกม
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile() || /\.example$/.test(f)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  }

  return async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', CSP);
    try { const u = new URL(req.url, 'http://x');
      if (u.pathname === '/healthz') return send(res, 200, { ok: true });
      if (u.pathname.startsWith('/api/')) return await api(req, res, u);
      if (u.pathname.startsWith('/auth/500w/')) return await sso(req, res, u);
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      serve(req, res, u);
    } catch (e) { if (!res.headersSent) send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'ข้อมูลใหญ่เกินไป' : 'คำขอไม่ถูกต้อง' }); else res.end(); }
  };
}

/* รันเกมเดียวแบบเดิม: node server/server.js  (PORT, DATA_DIR, AUTH_MODE ... จาก environment) */
function standalone(name, root) {
  const http = require('http');
  let handle;
  try { handle = create({ name, root, env: process.env }); } catch (e) { console.error(e.message); process.exit(1); }
  const PORT = +process.env.PORT || 3000;
  const server = http.createServer(handle);
  server.listen(PORT, () => console.log(name + ': http://localhost:' + PORT + '  (AUTH_MODE=' + (process.env.AUTH_MODE || 'local') + ')'));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log('shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}

module.exports = { create, standalone };
