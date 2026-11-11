// ตัวจำลองผู้ให้บริการ Login ของ 500 Windows (สำหรับทดสอบเท่านั้น ห้ามใช้จริง)
// รัน: node tools/mock-500w.js   แล้วตั้งค่า server ตาม .env.example (ส่วน "ทดสอบกับตัวจำลอง")
const http = require('http'), crypto = require('crypto'); let chal = '';
http.createServer((q, r) => { const u = new URL(q.url, 'http://x');
  if (u.pathname === '/authorize') { chal = u.searchParams.get('code_challenge'); r.writeHead(302, { Location: u.searchParams.get('redirect_uri') + '?code=CODE1&state=' + u.searchParams.get('state') }); return r.end(); }
  if (u.pathname === '/token') { let b = ''; q.on('data', d => b += d); q.on('end', () => { const f = new URLSearchParams(b);
    const ok = f.get('code') === 'CODE1' && crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === chal && f.get('client_secret') === 'sec';
    r.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(ok ? { access_token: 'TOK' } : { error: 'invalid_grant' })); }); return; }
  if (u.pathname === '/userinfo') { const ok = q.headers.authorization === 'Bearer TOK'; r.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
    return r.end(JSON.stringify(ok ? { member_id: 'W-777', name: 'สมาชิกทดสอบ', email: 'member@500windows.test' } : {})); }
  r.writeHead(404); r.end(); }).listen(4302, () => console.log('mock 500W provider on :4302'));
