#!/bin/bash
sudo -u postgres psql -d khabarxprod << 'SQL'
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
SQL

echo "--- Row counts ---"
sudo -u postgres psql -d khabarxprod << 'SQL'
SELECT relname AS table, n_live_tup AS rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 20;
SQL
