#!/usr/bin/env python3
"""สร้าง public/index.html จากไฟล์เกมต้นฉบับ โดยแทรกตัวแทนห้องออนไลน์ (shim.js)
ใช้: python3 build.py <ไฟล์เกม.html>   (ค่าเริ่มต้น: game-source.html)"""
import sys, re, pathlib
here = pathlib.Path(__file__).parent
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else here / 'game-source.html').read_text(encoding='utf-8')
shim = (here / 'shim.js').read_text(encoding='utf-8')
if '<head>' not in src:
    sys.exit('ไม่พบ <head> ในไฟล์เกม')
out = src.replace('<head>', '<head>\n<script>\n' + shim + '\n</script>', 1)
(here / 'public').mkdir(exist_ok=True)
(here / 'public' / 'index.html').write_text(out, encoding='utf-8')
print('สร้าง public/index.html แล้ว', len(out), 'ไบต์')
