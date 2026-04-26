#!/bin/bash
# Update PROD_DATABASE_URL in .env to local PostgreSQL
sed -i 's|PROD_DATABASE_URL=.*|PROD_DATABASE_URL=postgresql://khabarx_owner:mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO@localhost:5432/khabarxprod|' /opt/app/.env

echo "Updated PROD_DATABASE_URL:"
grep "PROD_DATABASE_URL" /opt/app/.env
