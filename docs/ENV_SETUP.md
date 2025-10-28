# Environment setup (Dev vs Production)

This backend now uses `dotenv-flow` to load environment files automatically based on `NODE_ENV`.

## Files you can create

- `.env` (shared defaults, loaded for all environments)
- `.env.development` (only when `NODE_ENV=development`)
- `.env.production` (only when `NODE_ENV=production`)
- Optional: `.env.local`, `.env.development.local`, `.env.production.local` (ignored by Git, for secrets)

`dotenv-flow` merges them in the correct order: base `.env` < environment file < `.local` overrides.

## NPM scripts

- Development: `npm run start:dev` — starts with `NODE_ENV=development`
- Production: `npm start` — runs with `NODE_ENV=production`

## Common variables

- Server
  - `PORT=3001`
  - `HOST=0.0.0.0`
- CORS
  - `CORS_ALLOW_ALL=true` (dev) or `CORS_ORIGINS=https://app.example.com,https://admin.example.com`
- Domains (used by `src/lib/domains.ts`)
  - `DEV_DOMAIN=http://localhost:3000`
  - `STAGING_DOMAIN=https://staging.example.com`
  - `PROD_DOMAIN=https://app.example.com`
  - Optional overrides: `CANONICAL_DOMAIN`, `EXTRA_DOMAIN`
- Firebase (server-side Admin)
  - Either set `FIREBASE_CREDENTIALS_PATH` to a JSON file path, or set:
    - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- Prisma / Database
  - `DATABASE_URL=postgresql://user:pass@host:5432/dbname`

## Examples

See `.env.example`, `.env.development.example`, `.env.production.example` for templates.

## Tips

- Do not commit secrets. Use the `*.local` variants for local-only overrides.
- Frontend domains differ per env — set `CORS_ORIGINS` and `DEV_DOMAIN`/`PROD_DOMAIN` accordingly.
- For Expo + FCM push, keep the backend Firebase Admin creds pointing to the same project used by the app.
