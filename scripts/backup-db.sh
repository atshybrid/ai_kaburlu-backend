#!/bin/bash
# ============================================================
# Khabarx DB Backup Script — Uploads to Google Drive via rclone
# Location: /opt/scripts/backup-db.sh
# ============================================================

DB_NAME="khabarxprod"
DB_USER="khabarx_owner"
DB_PASS="mMIvTgbmqj8eQc7iiW4TZzKyjGP9JhyO"
DB_HOST="localhost"
DB_PORT="5432"
BACKUP_DIR="/opt/backups"
GDRIVE_REMOTE="gdrive:khabarx-backups"
KEEP_DAYS=7
LOG_FILE="/var/log/khabarx-backup.log"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========================================="
log "Starting DB backup: $DB_NAME"

# 1. Dump PostgreSQL
PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" -p "$DB_PORT" \
  -U "$DB_USER" -d "$DB_NAME" \
  -Fc -f "$BACKUP_FILE" 2>> "$LOG_FILE"

if [ $? -ne 0 ]; then
  log "ERROR: pg_dump failed!"
  exit 1
fi

DUMP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Dump created: $BACKUP_FILE ($DUMP_SIZE)"

# 2. Upload to Google Drive
if command -v rclone &>/dev/null; then
  log "Uploading to Google Drive..."
  rclone copy "$BACKUP_FILE" "$GDRIVE_REMOTE/" \
    --config /root/.config/rclone/rclone.conf \
    --log-file "$LOG_FILE" --log-level INFO

  if [ $? -eq 0 ]; then
    log "Upload SUCCESS to $GDRIVE_REMOTE"
    rm -f "$BACKUP_FILE"
    log "Local temp file removed"
  else
    log "ERROR: Upload to Google Drive failed! Local file kept at $BACKUP_FILE"
  fi

  # 3. Delete old backups on Drive (older than KEEP_DAYS)
  log "Cleaning up Drive backups older than ${KEEP_DAYS} days..."
  rclone delete "$GDRIVE_REMOTE/" \
    --config /root/.config/rclone/rclone.conf \
    --min-age "${KEEP_DAYS}d" \
    --include "*.dump" 2>> "$LOG_FILE"
  log "Cleanup done"
else
  log "WARNING: rclone not installed — backup saved locally only at $BACKUP_FILE"
fi

log "Backup complete"
log "========================================="
