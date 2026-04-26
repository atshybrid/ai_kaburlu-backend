#!/bin/bash
# ============================================================
# Full setup: Install rclone + deploy backup script + cron
# ============================================================

echo "=== Step 1: Verifying local DB ==="
systemctl is-active postgresql
sudo -u postgres psql -d khabarxprod -c "SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema='public';"

echo ""
echo "=== Step 2: Installing rclone ==="
if command -v rclone &>/dev/null; then
  echo "rclone already installed: $(rclone --version | head -1)"
else
  curl -fsSL https://rclone.org/install.sh | bash
  echo "rclone installed: $(rclone --version | head -1)"
fi

echo ""
echo "=== Step 3: Creating backup directory ==="
mkdir -p /opt/scripts
mkdir -p /opt/backups
mkdir -p /var/log

echo ""
echo "=== Step 4: Deploying backup script ==="
cat > /opt/scripts/backup-db.sh << 'SCRIPT'
#!/bin/bash
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

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "========================================="
log "Starting DB backup: $DB_NAME"

PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" -p "$DB_PORT" \
  -U "$DB_USER" -d "$DB_NAME" \
  -Fc -f "$BACKUP_FILE" 2>> "$LOG_FILE"

if [ $? -ne 0 ]; then log "ERROR: pg_dump failed!"; exit 1; fi

DUMP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Dump created: $BACKUP_FILE ($DUMP_SIZE)"

if command -v rclone &>/dev/null; then
  log "Uploading to Google Drive..."
  rclone copy "$BACKUP_FILE" "$GDRIVE_REMOTE/" \
    --config /root/.config/rclone/rclone.conf \
    --log-level INFO >> "$LOG_FILE" 2>&1
  if [ $? -eq 0 ]; then
    log "Upload SUCCESS"
    rm -f "$BACKUP_FILE"
    rclone delete "$GDRIVE_REMOTE/" --min-age "${KEEP_DAYS}d" --include "*.dump" 2>> "$LOG_FILE"
    log "Old backups cleaned (>${KEEP_DAYS}d)"
  else
    log "ERROR: Upload failed! Backup kept locally."
  fi
else
  log "WARNING: rclone not found — local backup only at $BACKUP_FILE"
fi
log "Backup complete"
log "========================================="
SCRIPT

chmod +x /opt/scripts/backup-db.sh
echo "Backup script deployed to /opt/scripts/backup-db.sh"

echo ""
echo "=== Step 5: Setting up cron (daily at 2:30 AM) ==="
CRON_LINE="30 2 * * * /opt/scripts/backup-db.sh >> /var/log/khabarx-backup.log 2>&1"
# Remove old line if exists, then add
(crontab -l 2>/dev/null | grep -v "backup-db.sh"; echo "$CRON_LINE") | crontab -
echo "Cron job added:"
crontab -l | grep backup

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "NEXT STEP: Configure Google Drive"
echo "Run this command to start Google Drive setup:"
echo ""
echo "  rclone config"
echo ""
echo "Then follow the prompts below:"
echo "  1. n (new remote)"
echo "  2. Name: gdrive"  
echo "  3. Storage: drive  (Google Drive)"
echo "  4. Client ID: (press Enter — leave blank)"
echo "  5. Client Secret: (press Enter — leave blank)"
echo "  6. Scope: 1 (full access)"
echo "  7. Root folder: (press Enter)"
echo "  8. Service account: (press Enter)"
echo "  9. Edit advanced: n"
echo " 10. Use auto config: n  ← IMPORTANT (headless server)"
echo " 11. Copy the URL shown → open in your browser → authorize → paste code back"
echo " 12. Team drive: n"
echo " 13. OK: y"
echo " 14. q (quit config)"
echo ""
echo "After config, test with:"
echo "  rclone lsd gdrive:"
echo "  /opt/scripts/backup-db.sh"
