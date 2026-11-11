// ท่านเศรษฐี: เซิร์ฟเวอร์เกมออนไลน์ (Node 18+ ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
// รันเดี่ยว:  SECRET=ข้อความลับยาวๆ PORT=3000 node server.js   (ตั้งค่าใน .env ข้างไฟล์นี้ได้ ดู .env.example)
// บนโฮสต์จริงรันรวมกับเกมอื่นผ่าน app.js ที่ root ของ repo (เมานต์ที่ /settee)
// ถ้าอยู่หลัง reverse proxy (nginx ฯลฯ) ให้ตั้ง TRUST_PROXY=1 เพื่อให้ระบบกันเดารหัสผ่านนับแยกตาม IP จริงของผู้ใช้
//
// เข้าสู่ระบบผ่านระบบภายนอก (OAuth2 / OpenID Connect) เช่น "500 Windows Thailand" ตั้งค่าด้วย env:
//   PUBLIC_URL=https://เว็บเกมของคุณ (รวม path ที่เมานต์ เช่น https://games.yaydang.com/settee)
//     ใช้สร้าง redirect_uri = PUBLIC_URL/auth/sso/callback ต้องไปลงทะเบียนกับผู้ให้บริการ
//   SSO_CLIENT_ID=...  SSO_CLIENT_SECRET=...
//   แบบ A (ผู้ให้บริการมี OpenID Connect discovery):  SSO_ISSUER=https://ผู้ให้บริการ
//   แบบ B (ระบุ URL เอง): SSO_AUTH_URL=... SSO_TOKEN_URL=... SSO_USERINFO_URL=...
//   ไม่บังคับ: SSO_NAME="500 Windows Thailand" (ข้อความบนปุ่ม)  SSO_SCOPE="openid profile"
// ถ้าไม่ตั้งค่า ปุ่มจะไม่แสดง และใช้ล็อกอินด้วยชื่อผู้ใช้/รหัสผ่านตามปกติ
const fs = require("fs"), path = require("path"), crypto = require("crypto");

function create({ env = process.env, base = "", dataDir } = {}) {
  const DATA = path.resolve(env.DATA_DIR || dataDir || __dirname);
  fs.mkdirSync(DATA, { recursive: true });
  // ไม่ตั้ง SECRET = สร้างเก็บไว้ในไฟล์ เพื่อไม่ให้ล็อกอินหลุดทุกครั้งที่รีสตาร์ท
  const SECRET = env.SECRET || (() => { const f = path.join(DATA, "secret.key");
    try { return fs.readFileSync(f, "utf8"); } catch (e) { const s = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(f, s, { mode: 0o600 }); return s; } })();
  const USERS = path.join(DATA, "users.json"), PAGE = path.join(__dirname, "tan-set-thi.html");
  let users = {}; try { users = JSON.parse(fs.readFileSync(USERS, "utf8")); } catch (e) {}
  const saveUsers = () => fs.writeFile(USERS, JSON.stringify(users), () => {});
  const rooms = new Map();   // รหัสห้อง -> {g: สถานะเกม, t: เวลาล่าสุด, cl: ผู้ฟัง SSE}
  const SSO = { name: env.SSO_NAME || "500 Windows Thailand", auth: env.SSO_AUTH_URL, token: env.SSO_TOKEN_URL,
    info: env.SSO_USERINFO_URL, issuer: env.SSO_ISSUER, id: env.SSO_CLIENT_ID, secret: env.SSO_CLIENT_SECRET || "",
    scope: env.SSO_SCOPE || "openid profile", base: (env.PUBLIC_URL || "").replace(/\/$/, "") };
  const ssoOn = () => !!(SSO.id && SSO.base && ((SSO.auth && SSO.token) || SSO.issuer));
  const pend = new Map();    // state -> {v: PKCE verifier, t: เวลา}
  async function ssoEndpoints() {
    if (SSO.auth && SSO.token) return;
    const d = await (await fetch(SSO.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration")).json();
    SSO.auth = SSO.auth || d.authorization_endpoint; SSO.token = SSO.token || d.token_endpoint; SSO.info = SSO.info || d.userinfo_endpoint;
  }
  const rnd = n => crypto.randomBytes(n).toString("base64url");
  const ssoFail = res => { res.writeHead(302, { Location: base + "/#ssoerr=1" }); res.end(); };
  const tries = new Map();   // ip -> [จำนวนครั้ง, เวลารีเซ็ต] กันเดารหัสผ่าน
  const hash = (p, s) => crypto.scryptSync(p, s, 32).toString("hex");
  const mac = b => crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
  const sign = u => { const b = Buffer.from(u + "|" + (Date.now() + 30 * 864e5)).toString("base64url"); return b + "." + mac(b); };
  function verify(t) {
    try { const [b, s] = t.split("."); if (!b || s !== mac(b)) return;
      const [u, e] = Buffer.from(b, "base64url").toString().split("|"); return +e > Date.now() ? u : undefined; } catch (e) {}
  }
  const body = req => new Promise(ok => { let d = ""; req.on("data", c => { d += c; if (d.length > 100000) req.destroy(); });
    req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch (e) { ok({}); } }); });
  const send = (res, c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

  setInterval(() => { for (const [k, v] of pend) if (Date.now() - v.t > 6e5) pend.delete(k);
    for (const [k, t] of tries) if (Date.now() > t[1]) tries.delete(k);
    for (const [c, r] of rooms) if (Date.now() - r.t > 6 * 36e5 && !r.cl.size) rooms.delete(c);
    rooms.forEach(r => r.cl.forEach(x => x.write(": ping\n\n"))); }, 25000).unref();

  return async function handle(req, res) {
    const u = new URL(req.url, "http://x"), p = u.pathname, m = req.method;
    if (p === "/" || p === "/index.html") {
      return fs.readFile(PAGE, (err, d) => { if (err) return send(res, 500, { e: "ไม่พบ tan-set-thi.html" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }); res.end(d); });
    }
    if (p === "/healthz" || p === "/api/ping") return send(res, 200, { ok: 1 });
    if (p === "/api/sso/config") return send(res, 200, { on: ssoOn(), name: SSO.name });
    if (p === "/auth/sso/login" && ssoOn()) {
      try {
        await ssoEndpoints();
        const st = rnd(16), v = rnd(32), ch = crypto.createHash("sha256").update(v).digest("base64url");
        pend.set(st, { v, t: Date.now() });
        const q = new URLSearchParams({ response_type: "code", client_id: SSO.id, redirect_uri: SSO.base + "/auth/sso/callback", scope: SSO.scope, state: st, code_challenge: ch, code_challenge_method: "S256" });
        res.writeHead(302, { Location: SSO.auth + (SSO.auth.includes("?") ? "&" : "?") + q }); return res.end();
      } catch (e) { return ssoFail(res); }
    }
    if (p === "/auth/sso/callback" && ssoOn()) {
      const st = u.searchParams.get("state"), code = u.searchParams.get("code"), pd = pend.get(st); pend.delete(st);
      if (!pd || Date.now() - pd.t > 6e5 || !code) return ssoFail(res);
      try {
        await ssoEndpoints();
        const tr = await fetch(SSO.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: SSO.base + "/auth/sso/callback", client_id: SSO.id, client_secret: SSO.secret, code_verifier: pd.v }) });
        const tk = await tr.json(); if (!tr.ok || !tk.access_token) return ssoFail(res);
        let pr = {};
        if (SSO.info) pr = await (await fetch(SSO.info, { headers: { Authorization: "Bearer " + tk.access_token } })).json();
        else if (tk.id_token) pr = JSON.parse(Buffer.from(tk.id_token.split(".")[1], "base64url").toString());
        const sub = String(pr.sub || pr.id || ""); if (!sub) return ssoFail(res);
        const key = "w5_" + crypto.createHash("sha256").update(SSO.id + "|" + sub).digest("hex").slice(0, 10);
        if (!users[key]) { users[key] = { sso: SSO.name, p: { name: String(pr.name || pr.preferred_username || "").slice(0, 12) } }; saveUsers(); }
        res.writeHead(302, { Location: base + "/#sso=" + sign(key) }); return res.end();
      } catch (e) { return ssoFail(res); }
    }
    if (m === "POST" && (p === "/api/register" || p === "/api/login")) {
      const ip = (env.TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress; let t = tries.get(ip) || [0, Date.now() + 6e5];
      if (Date.now() > t[1]) t = [0, Date.now() + 6e5];
      if (++t[0] > 30) { tries.set(ip, t); return send(res, 429, { e: "ลองบ่อยเกินไป รอสักครู่" }); }
      tries.set(ip, t);
      const b = await body(req), n = String(b.u || "").toLowerCase(), pw = String(b.p || "");
      if (!/^[a-z0-9_]{3,16}$/.test(n) || (p.endsWith("register") && pw.length < 8) || pw.length < 1 || n.startsWith("w5_")) return send(res, 400, { e: "รูปแบบชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      if (p.endsWith("register")) {
        if (users[n]) return send(res, 409, { e: "ชื่อนี้ถูกใช้แล้ว" });
        const s = crypto.randomBytes(16).toString("hex"); users[n] = { s, h: hash(pw, s), p: null }; saveUsers();
      } else {
        const x = users[n];
        if (!x || !x.h || !crypto.timingSafeEqual(Buffer.from(hash(pw, x.s)), Buffer.from(x.h))) return send(res, 401, { e: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      }
      return send(res, 200, { t: sign(n), u: n });
    }
    const au = verify((req.headers.authorization || "").slice(7) || u.searchParams.get("t") || "");
    if (!au) return send(res, 401, { e: "unauthorized" });
    if (p === "/api/me") return send(res, 200, { u: au, name: (users[au] && users[au].p && users[au].p.name) || "" });
    if (p === "/api/profile") {
      if (m === "GET") return send(res, 200, { p: users[au] ? users[au].p : null });
      if (m === "PUT") { const b = await body(req); if (users[au]) { users[au].p = b; saveUsers(); } return send(res, 200, { ok: 1 }); }
    }
    if (p === "/api/account" && m === "DELETE") { if (users[au]) { delete users[au]; saveUsers(); } return send(res, 200, { ok: 1 }); }
    const mm = p.match(/^\/api\/room\/([A-Z0-9]{4})(\/events)?$/);
    if (mm) {
      const c = mm[1]; let r = rooms.get(c);
      if (mm[2]) { // SSE: ส่งสถานะห้องแบบเรียลไทม์
        if (!r) { r = { g: null, t: Date.now(), cl: new Set() }; rooms.set(c, r); }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        if (r.g) res.write("data: " + JSON.stringify({ g: r.g }) + "\n\n");
        r.cl.add(res); req.on("close", () => r.cl.delete(res)); return;
      }
      if (m === "GET") return r && r.g ? send(res, 200, { g: r.g }) : send(res, 404, { e: "not found" });
      if (m === "PUT") {
        const b = await body(req); if (!b.g || typeof b.g !== "object") return send(res, 400, { e: "bad request" });
        if (!r) { r = { g: null, t: 0, cl: new Set() }; rooms.set(c, r); }
        r.g = b.g; r.t = Date.now(); const d = "data: " + JSON.stringify({ g: r.g }) + "\n\n"; r.cl.forEach(x => x.write(d));
        return send(res, 200, { ok: 1 });
      }
    }
    send(res, 404, { e: "not found" });
  };
}

module.exports = { create };

if (require.main === module) {
  // อ่านค่าตั้งจากไฟล์ .env ข้างๆ server.js (ถ้ามี) โดยไม่ทับค่าที่ตั้งไว้ใน environment
  try { for (const l of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } } catch (e) {}
  const PORT = process.env.PORT || 3000;
  require("http").createServer(create()).listen(PORT, () => console.log("ท่านเศรษฐี: http://localhost:" + PORT));
}
