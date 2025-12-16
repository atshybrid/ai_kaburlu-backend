# Daily Database Backup (PostgreSQL)

This project includes a **non-destructive** backup script that uses `pg_dump` and writes compressed backups to disk.

## 1) Run a backup now

From the project root:

- `npm run backup:db`

Output files go to `./backups` by default.

## 2) Configure

Environment variables:

- `DATABASE_URL` (required)
- `BACKUP_DIR` (optional, default: `./backups`)
- `BACKUP_RETENTION_DAYS` (optional, default: `7`)
- `BACKUP_PREFIX` (optional, default: `db`)

## 3) Schedule daily backups

### Windows Task Scheduler

Create a task that runs daily:

- Program: `npm`
- Arguments: `run backup:db`
- Start in: your repo folder (example: `D:\Nodejs Projects\ai_kaburlu-backend`)

Make sure the machine user running the task has `DATABASE_URL` available (system env var or in a `.env` that your shell loads).

### Linux cron (for servers)

Example (02:15 daily):

- `15 2 * * * cd /path/to/ai_kaburlu-backend && DATABASE_URL='...' npm run backup:db >> backup.log 2>&1`

## Notes

- The script requires `pg_dump` in PATH.
  - On Windows: install PostgreSQL client tools.
  - On Linux: `sudo apt-get install postgresql-client`.
