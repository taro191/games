#!/bin/sh
# สำรองข้อมูลผู้เล่นทั้งหมด  ใช้: sh scripts/backup.sh   (รันในโฟลเดอร์ที่มี docker-compose.yml)
set -e
mkdir -p backups
F="backups/mitty-data-$(date +%Y%m%d-%H%M%S).tgz"
docker compose exec -T app tar czf - -C /data . > "$F"
echo "สำรองแล้ว: $F"
# เก็บไว้ 30 ไฟล์ล่าสุด
ls -1t backups/mitty-data-*.tgz | tail -n +31 | xargs -r rm --
