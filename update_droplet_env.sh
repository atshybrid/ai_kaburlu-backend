#!/bin/bash
set -e

ENV_FILE="/opt/app/.env"

# Remove any existing DATABASE_URL line (bare, not DEV_ or PROD_)
sed -i '/^DATABASE_URL=/d' "$ENV_FILE"

# Add DATABASE_URL using localhost (app and DB on same machine)
sed -i '/^PROD_DATABASE_URL=/a DATABASE_URL="postgresql://khabarx_owner:mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO@localhost:5432/khabarxprod?sslmode=disable"' "$ENV_FILE"

# Fix PROD_DATABASE_URL - ensure it has quotes and sslmode=disable
sed -i 's|^PROD_DATABASE_URL=.*|PROD_DATABASE_URL="postgresql://khabarx_owner:mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO@localhost:5432/khabarxprod?sslmode=disable"|' "$ENV_FILE"

echo "=== Updated .env ==="
grep -E "DATABASE_URL|ENV_TYPE" "$ENV_FILE"
echo "DONE"
