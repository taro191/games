'use strict';
/**
 * ตอบผิดคือชนะ – เซิร์ฟเวอร์เล็กๆ สำหรับห้องออนไลน์
 *  - เสิร์ฟหน้าเกม (public/index.html)
 *  - ส่งต่อสถานะผู้เล่น (presence) และอีโมจิ (reaction) ระหว่างคนในห้องเดียวกันผ่าน WebSocket ที่ /ws
 *  - ไม่เก็บข้อมูลลงดิสก์ ห้องอยู่ในหน่วยความจำและหายเมื่อทุกคนออก
 * ทุกอย่างที่ผู้เล่นส่งมาถือว่าไม่น่าเชื่อถือ: ตรวจรูปแบบ จำกัดขนาด และจำกัดอัตราส่ง
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const INDEX = path.join(__dirname, 'public', 'index.html');

const ROOM_RE = /^waw-[a-z0-9]{3,8}$/;
const MAX_MSG_BYTES = 8 * 1024;          // ขนาดข้อความสูงสุดต่อครั้ง
const MAX_PRESENCE_BYTES = 4 * 1024;     // ขนาดสถานะรวมของผู้เล่นหนึ่งคน
const REACTIONS = 6;                     // จำนวนอีโมจิที่รองรับ (ดัชนี 0-5)


const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

function create({ env = process.env } = {}) {
const MAX_ROOMS = parseInt(env.MAX_ROOMS, 10) || 500;
const MAX_PEERS = parseInt(env.MAX_PEERS, 10) || 12;
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const rooms = new Map();                 // ชื่อห้อง -> Map(peerId -> peer)

function handle(req, res) {
  const url = (req.url || '/').split('?')[0];
  const headers = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
  };
  if (url === '/healthz') { res.writeHead(200, { ...headers, 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500, { ...headers, 'Content-Type': 'text/plain' }); return res.end('index.html not found'); }
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
  res.end('not found');
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });

// เรียกจาก server.on('upgrade') โดย req.url ตัด path ที่เมานต์ออกแล้ว
function upgrade(req, socket, head) {
  const url = (req.url || '').split('?')[0];
  if (url !== '/ws') { socket.destroy(); return; }
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length && (!origin || !ALLOWED_ORIGINS.includes(origin))) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
}

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const jsonBytes = v => Buffer.byteLength(JSON.stringify(v), 'utf8');
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function leave(ws) {
  const p = ws._peer;
  if (!p) return;
  ws._peer = null;
  const room = rooms.get(p.room);
  if (!room) return;
  room.delete(p.id);
  if (room.size === 0) rooms.delete(p.room);
  else for (const q of room.values()) send(q.ws, { t: 'left', peer: p.id });
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws._peer = null;
  ws._tokens = 60; ws._last = Date.now(); ws._drops = 0;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data, isBinary) => {
    // จำกัดอัตราส่ง: ~30 ข้อความ/วินาที (ล้นได้ชั่วขณะถึง 60)
    const now = Date.now();
    ws._tokens = Math.min(60, ws._tokens + (now - ws._last) * 0.03);
    ws._last = now;
    if (ws._tokens < 1) { if (++ws._drops > 200) ws.terminate(); return; }
    ws._tokens -= 1;
    if (isBinary) return;

    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; }
    if (!isPlain(m) || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (ws._peer) return;
      if (typeof m.room !== 'string' || !ROOM_RE.test(m.room)) { send(ws, { t: 'error', code: 'invalid_argument' }); return ws.close(1008, 'bad room'); }
      let room = rooms.get(m.room);
      if (!room) {
        if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', code: 'limit_reached' }); return ws.close(1013, 'busy'); }
        room = new Map(); rooms.set(m.room, room);
      }
      if (room.size >= MAX_PEERS) { send(ws, { t: 'error', code: 'limit_reached' }); return ws.close(1013, 'room full'); }
      let presence = {};
      if (isPlain(m.presence) && Object.keys(m.presence).length <= 32 && jsonBytes(m.presence) <= MAX_PRESENCE_BYTES) presence = m.presence;
      const peer = { id: crypto.randomBytes(4).toString('hex'), room: m.room, ws, presence };
      ws._peer = peer;
      room.set(peer.id, peer);
      send(ws, { t: 'joined', peer: peer.id, peers: [...room.values()].map(q => ({ peer: q.id, presence: q.presence })) });
      for (const q of room.values()) if (q !== peer) send(q.ws, { t: 'peer', peer: peer.id, presence: peer.presence });
      return;
    }

    const p = ws._peer;
    if (!p) return;

    if (m.t === 'presence') {
      if (!isPlain(m.patch)) return;
      const keys = Object.keys(m.patch);
      if (keys.length > 32) return;
      const next = { ...p.presence };
      for (const k of keys) {
        if (k.length > 24 || k === '__proto__' || k === 'constructor' || k === 'prototype') return;
        if (m.patch[k] === null) delete next[k]; else next[k] = m.patch[k];
      }
      if (Object.keys(next).length > 32 || jsonBytes(next) > MAX_PRESENCE_BYTES) return;
      p.presence = next;
      const room = rooms.get(p.room);
      if (room) for (const q of room.values()) if (q !== p) send(q.ws, { t: 'peer', peer: p.id, presence: p.presence });
      return;
    }

    if (m.t === 'emit') {
      // อนุญาตเฉพาะอีโมจิ (reaction) ที่เป็นเลขเต็ม 0-5 เท่านั้น
      if (m.topic !== 'reaction' || !isPlain(m.data)) return;
      const i = m.data.i;
      if (!Number.isInteger(i) || i < 0 || i >= REACTIONS) return;
      const room = rooms.get(p.room);
      if (room) for (const q of room.values()) send(q.ws, { t: 'msg', topic: 'reaction', data: { i }, peer: p.id });
      return;
    }

    if (m.t === 'leave') { leave(ws); ws.close(1000, 'bye'); }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => { try { ws.terminate(); } catch (e) {} });
});

// ตรวจว่ายังเชื่อมต่ออยู่ ตัดคนที่หลุดทุก ~25 วินาที
const beat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);
beat.unref();

return { handle, upgrade, wss, rooms };
}

module.exports = { create };

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  const g = create();
  const server = http.createServer(g.handle);
  server.on('upgrade', g.upgrade);
  server.listen(PORT, () => console.log('ตอบผิดคือชนะ พร้อมที่ http://localhost:' + PORT));
}
