โฮสต์ฟอนต์เอง (ไม่พึ่ง Google Fonts)

1) ดาวน์โหลดฟอนต์ Kanit และ Kumbh Sans เป็นไฟล์ .woff2 (เช่นจาก https://gwfh.mranftl.com/fonts หรือ Google Fonts)
2) วางไฟล์ .woff2 ไว้ในโฟลเดอร์นี้ ให้ชื่อตรงกับใน fonts.css.example
3) เปลี่ยนชื่อ fonts.css.example เป็น fonts.css  (เซิร์ฟเวอร์ตรวจเจอแล้วจะให้เกมโหลดไฟล์นี้เอง)
4) (ไม่บังคับ) ลบบรรทัด <link ... fonts.googleapis.com ...> ใน public/index.html เพื่อไม่ให้เกมเรียก Google เลย
   ถ้าไม่มีฟอนต์ของเราและเข้า Google ไม่ได้ เกมจะใช้ฟอนต์ไทยของเครื่อง (Sarabun, Thonburi, Tahoma ฯลฯ)
