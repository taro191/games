'use strict';
/* Mitty 90 Day - รันเกมนี้เดี่ยวๆ: node server/server.js  (ตัวเซิร์ฟเวอร์จริงอยู่ที่ lib/m90-server.js ใช้ร่วมกับเกมตระกูลเดียวกัน)
   บนโฮสต์จริงทุกเกมรันรวมกันผ่าน app.js ที่ root ของ repo */
const path = require('path');
require('../../../lib/m90-server').standalone('Mitty 90 Day', path.resolve(__dirname, process.env.PUBLIC_DIR || '../public'));
