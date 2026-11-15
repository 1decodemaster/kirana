#!/usr/bin/env bash
# Nightly SQLite backup + retention pruning (PRD §12.4).
# Cron example: 0 3 * * *  DATA_DIR=/data /app/infra/backup.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"

if [ ! -f "$DATA_DIR/kirana.db" ]; then
  echo "backup: $DATA_DIR/kirana.db not found" >&2
  exit 1
fi

mkdir -p "$DATA_DIR/backups"
stamp="$(date -u +%Y%m%d)"
target="$DATA_DIR/backups/kirana-$stamp.db"

sqlite3 "$DATA_DIR/kirana.db" ".backup '$target'"
gzip -f "$target"
echo "backup written: $target.gz"

prune() {
  local keep="$1"
  shift
  ls -1t "$DATA_DIR"/backups/kirana-*.db.gz | tail -n +"$((keep + 1))" | while read -r f; do
    local day dow
    day="$(basename "$f")"
    day="${day#kirana-}"
    day="${day%.db.gz}"
    dow="$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%u)"
    if [ "$dow" != "$2" ]; then
      rm -f "$f"
    fi
  done
}

prune "$KEEP_DAILY" "0"

mondays=()
while IFS= read -r f; do
  day="$(basename "$f")"
  day="${day#kirana-}"
  day="${day%.db.gz}"
  dow="$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%u)"
  if [ "$dow" = "1" ]; then
    mondays+=("$f")
  fi
done < <(ls -1t "$DATA_DIR"/backups/kirana-*.db.gz)

for ((i = KEEP_WEEKLY; i < ${#mondays[@]}; i++)); do
  rm -f "${mondays[$i]}"
done

echo "pruned; kept daily=$KEEP_DAILY weekly=$KEEP_WEEKLY"
