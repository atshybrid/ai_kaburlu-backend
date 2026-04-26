#!/bin/bash
echo "=== Active DB connections ==="
sudo -u postgres psql -d khabarxprod << 'SQL'
SELECT count(*), application_name, client_addr
FROM pg_stat_activity 
WHERE datname = 'khabarxprod'
GROUP BY application_name, client_addr;
SQL

echo ""
echo "=== Quick API health check ==="
curl -s -o /dev/null -w "HTTP status: %{http_code}\n" http://localhost:3001/health 2>/dev/null || \
curl -s -o /dev/null -w "HTTP status: %{http_code}\n" http://localhost:3001/api/health 2>/dev/null || \
echo "No /health endpoint - trying root"
curl -s -o /dev/null -w "HTTP status: %{http_code}\n" http://localhost:3001/ 2>/dev/null
