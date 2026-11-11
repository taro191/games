#!/bin/sh
# กู้ข้อมูลจากไฟล์สำรอง  ใช้: sh scripts/restore.sh backups/mitty-data-XXXX.tgz
set -e
[ -f "$1" ] || { echo "ไม่พบไฟล์: $1"; exit 1; }
docker compose stop app
docker compose run --rm -T --no-deps --entrypoint sh app -c 'rm -rf /data/* && tar xzf - -C /data' < "$1"
docker compose start app
echo "กู้ข้อมูลเรียบร้อย"
