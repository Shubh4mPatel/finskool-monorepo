#!/usr/bin/env bash
# Turn the "under maintenance" page on or off by hand (deploy.sh does this on its own during a deploy):
#
#   bash docker/maintenance.sh on       # every request gets the maintenance page (HTTP 503)
#   bash docker/maintenance.sh off      # the site is live again
#   bash docker/maintenance.sh status
#
# nginx looks for the flag file on every request, so there is nothing to restart or reload.
set -euo pipefail

FLAG="$(cd "$(dirname "$0")" && pwd)/maintenance/ON"

case "${1:-status}" in
  on)     date -u +%Y-%m-%dT%H:%M:%SZ > "$FLAG"; echo "Maintenance mode is ON." ;;
  off)    rm -f "$FLAG"; echo "Maintenance mode is OFF. The site is live." ;;
  status) if [ -f "$FLAG" ]; then echo "Maintenance mode is ON (since $(cat "$FLAG"))."; else echo "Maintenance mode is OFF."; fi ;;
  *)      echo "Usage: $0 on|off|status" >&2; exit 2 ;;
esac
