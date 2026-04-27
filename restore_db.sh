#!/bin/bash
set -e

echo "=== Terminating existing connections to khabarxprod ==="
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='khabarxprod' AND pid <> pg_backend_pid();"

echo "=== Dropping database ==="
sudo -u postgres psql -c "DROP DATABASE IF EXISTS khabarxprod;"

echo "=== Creating fresh database ==="
sudo -u postgres psql -c "CREATE DATABASE khabarxprod OWNER khabarx_owner;"

echo "=== Restoring from Neon dump ==="
sudo -u postgres /usr/lib/postgresql/17/bin/pg_restore --no-owner --role=khabarx_owner -d khabarxprod /tmp/neon_backup.dump

echo "=== Granting privileges ==="
sudo -u postgres psql -d khabarxprod -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO khabarx_owner;"
sudo -u postgres psql -d khabarxprod -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO khabarx_owner;"
sudo -u postgres psql -d khabarxprod -c "GRANT USAGE ON SCHEMA public TO khabarx_owner;"

echo "=== Row counts ==="
sudo -u postgres psql -d khabarxprod -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"

echo "=== RESTORE_DONE ==="
