#!/bin/bash
set -e

PG_CONF=$(sudo -u postgres psql -t -c "SHOW config_file;" | tr -d ' ')
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file;" | tr -d ' ')
echo "pg_conf: $PG_CONF"
echo "pg_hba: $PG_HBA"

# 1. Allow listening on all interfaces
if grep -q "^listen_addresses" "$PG_CONF"; then
  sed -i "s/^listen_addresses.*/listen_addresses = '*'/" "$PG_CONF"
else
  echo "listen_addresses = '*'" >> "$PG_CONF"
fi
echo "listen_addresses set"

# 2. Allow khabarx_owner from any IP with md5 password auth
if ! grep -q "khabarx_owner" "$PG_HBA"; then
  echo "host    khabarxprod     khabarx_owner   0.0.0.0/0               md5" >> "$PG_HBA"
  echo "host    khabarxprod     khabarx_owner   ::/0                    md5" >> "$PG_HBA"
fi
echo "pg_hba updated"

# 3. Ensure khabarx_owner has password set
sudo -u postgres psql -c "ALTER USER khabarx_owner WITH PASSWORD 'mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO';"

# 4. Reload postgres
systemctl reload postgresql
echo "PostgreSQL reloaded"

# 5. Open ufw port 5432
ufw allow 5432/tcp
ufw status verbose | grep 5432 || true
echo "FIREWALL_DONE"
