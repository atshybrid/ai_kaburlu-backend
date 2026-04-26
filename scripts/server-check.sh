#!/bin/bash
echo "=== PostgreSQL Status ==="
systemctl is-active postgresql

echo ""
echo "=== DB Size ==="
sudo -u postgres psql << 'SQL'
SELECT datname, pg_size_pretty(pg_database_size(datname)) as size
FROM pg_database WHERE datname = 'khabarxprod';
SQL

echo ""
echo "=== PM2 Status ==="
pm2 status

echo ""
echo "=== App DB connection ==="
grep "PROD_DATABASE_URL" /opt/app/.env
