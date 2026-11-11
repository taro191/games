# games.yaydang.com

รวม 5 เกมไว้ในแอป Node.js เดียว (Node 18+) ใช้ dependency เดียวคือ `ws` (สำหรับห้องออนไลน์ของเกม waw)

| Path | เกม | โฟลเดอร์ |
|---|---|---|
| `/` | หน้ารวมเกม | `public/index.html` |
| `/isan/` | จ่ายตลาดอีสาน | `games/isan-market-game` |
| `/mitty90/` | สร้างตัว 90 วัน (Mitty 90 Day) | `games/mitty-90-day` |
| `/career/` | จำลองอาชีพ 90 วัน (Mitty Career) | `games/mitty-career` |
| `/settee/` | ท่านเศรษฐี | `games/tan-set-thi` |
| `/waw/` | คนเก่งเกินเบอร์ 5 (ตอบผิดคือชนะ) | `games/waw-selfhost` |

## รันในเครื่อง

```
npm install
node app.js          # http://localhost:3000
```

ตรวจสถานะได้ที่ `/healthz`

## โครงสร้าง

- `app.js` ตัวกลาง รับทุก request แล้วส่งต่อให้เกมตาม path (ตัด `/isan` ออกก่อนส่ง) รวมถึง WebSocket `/waw/ws`
- `lib/m90-server.js` เซิร์ฟเวอร์ร่วมของ 3 เกมตระกูล Mitty (isan, mitty90, career) เดิมเป็นโค้ดชุดเดียวกัน 3 ชุด
- `games/tan-set-thi/server.js`, `games/waw-selfhost/server.js` export `create()` ให้ app.js เมานต์ได้ และยังรันเดี่ยวได้เหมือนเดิม
- หน้าเกมเรียก API แบบ relative (`api/...`) จึงทำงานได้ทั้งตอนอยู่ใต้ path และตอนรันเดี่ยว
- waw: ถ้าแก้ `game-source.html` หรือ `shim.js` ให้รัน `node build.js .` ในโฟลเดอร์นั้นเพื่อสร้าง `public/index.html` ใหม่
- waw ใช้ WebSocket `/waw/ws` ถ้าโฮสต์ไม่ส่งต่อ WebSocket (Plesk ที่ nginx อยู่หน้า Apache) หน้าเกมจะสลับไปใช้ SSE (`/waw/rt/open` + `/waw/rt/send`) เอง
- ไฟล์ Docker/Caddy/DEPLOY.md ในโฟลเดอร์เกมเป็นของเดิมแบบแยกเกม ไม่ได้ใช้กับการขึ้น Plesk

## ข้อมูลผู้เล่น

เก็บเป็นไฟล์ที่ `storage/<เกม>/` (ไม่อยู่ใน git) ควรสำรองโฟลเดอร์นี้สม่ำเสมอ
ห้องเล่นออนไลน์ของ settee และ waw อยู่ในหน่วยความจำ หายเมื่อแอปรีสตาร์ท

## ค่าตั้ง (environment variables)

ค่าที่ไม่มีคำนำหน้าใช้กับทุกเกม ค่าที่ขึ้นต้นด้วยชื่อเกมใช้เฉพาะเกมนั้น (คำนำหน้าจะถูกตัดออก)

| ตัวแปร | ความหมาย |
|---|---|
| `COOKIE_SECURE=1` | ใส่เมื่อใช้ HTTPS (แนะนำบนโฮสต์จริง) |
| `TRUST_PROXY=1` | อยู่หลัง nginx ของ Plesk ให้นับจำกัดการลองรหัสผ่านตาม IP จริง |
| `STORAGE_DIR` | ที่เก็บข้อมูล (ค่าเริ่มต้น `./storage`) |
| `ISAN_AUTH_MODE`, `MITTY90_AUTH_MODE`, `CAREER_AUTH_MODE` | `local` / `500w` / `both` |
| `ISAN_ALLOW_GUEST=1` ฯลฯ | เปิดปุ่ม "ลองเล่นก่อน" |
| `ISAN_W500_*` ฯลฯ | ค่า Login ผ่าน 500 Windows (ดู `games/isan-market-game/.env.example`) redirect URI เช่น `https://games.yaydang.com/isan/auth/500w/callback` |
| `SETTEE_SECRET` | คีย์เซ็นโทเค็น (ไม่ตั้ง = สร้างเก็บไว้ใน storage อัตโนมัติ) |
| `SETTEE_PUBLIC_URL`, `SETTEE_SSO_*` | Login ภายนอกของท่านเศรษฐี ใช้ `SETTEE_PUBLIC_URL=https://games.yaydang.com/settee` |
| `WAW_ALLOWED_ORIGINS` | จำกัด origin ของ WebSocket เช่น `https://games.yaydang.com` |

ถ้าค่าตั้งของเกมไหนไม่ครบ (เช่นเปิด 500w แต่ไม่ใส่ URL) เกมนั้นจะตอบ 503 ส่วนเกมอื่นยังทำงานปกติ

## ขึ้น Plesk (games.yaydang.com)

1. **Git**: Websites & Domains > games.yaydang.com > Git > เพิ่ม repository `https://github.com/taro191/games.git`
   (repo private ต้องใช้ SSH URL และเพิ่ม deploy key ที่ Plesk ให้ใน GitHub) ให้ deploy ไปที่ `/httpdocs` อัตโนมัติเมื่อ pull
2. **Node.js**: เปิด Node.js ของโดเมน ตั้ง
   - Node.js version: 18 ขึ้นไป (แนะนำ 20/22)
   - Application root: `/httpdocs`
   - Document root: `/httpdocs/public` (**ห้ามตั้งเป็น /httpdocs** เพราะ nginx จะเสิร์ฟไฟล์ใน storage ตรงๆ)
   - Application startup file: `app.js`
   - Application mode: production
   - Custom environment variables: อย่างน้อย `COOKIE_SECURE=1` และ `TRUST_PROXY=1`
   - กด **NPM install** แล้ว **Restart App**
3. **SSL**: SSL/TLS Certificates > Let's Encrypt สำหรับ games.yaydang.com
4. **DNS**: ตอนนี้ Plesk แจ้งว่าโดเมน resolve ไม่ได้ ต้องเพิ่ม A record `games` -> IP ของโฮสต์ ที่ผู้ดูแล DNS ของ yaydang.com
5. หลัง push โค้ดใหม่: Plesk pull อัตโนมัติ (ถ้าเปิด webhook/auto deploy) แล้วกด Restart App ในหน้า Node.js
   หรือใส่ไฟล์ `tmp/restart.txt` ให้ Passenger รีสตาร์ทเอง
