#!/usr/bin/env bash
#
# Deploy Kitchen Terminal K7 to the LAN machine.
#
# This script is the only way the service is updated. Editing files on the box by
# hand produces a running service nobody can reproduce, and the first time that
# matters is the day it has to be rebuilt from scratch.
#
# Idempotent: safe to run repeatedly. Deploys a git ref, so what is running is
# always a commit that exists on the remote.
set -euo pipefail

HOST="${K7_HOST_SSH:-mt3o@192.168.0.10}"
REF="${1:-main}"
APP="kitchen-terminal-k7"
REPO="https://github.com/mt3o/kitchen-terminal-k7.git"

say() { printf '\n\033[1m» %s\033[0m\n' "$*"; }

say "deploying $REF to $HOST"

ssh -o BatchMode=yes "$HOST" APP="$APP" REPO="$REPO" REF="$REF" 'bash -seu' <<'REMOTE'
cd "$HOME"

if [ -d "$APP/.git" ]; then
  echo "-- updating existing checkout"
  git -C "$APP" fetch --quiet origin
else
  echo "-- cloning"
  git clone --quiet "$REPO" "$APP"
  git -C "$APP" fetch --quiet origin
fi

cd "$APP"
# --hard, deliberately: the box is not a place to keep local edits, and a deploy
# that silently merges is a deploy whose result nobody can predict.
git reset --quiet --hard "origin/$REF"
echo "-- at $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"

echo "-- installing"
npm ci --no-audit --no-fund --silent

echo "-- building"
npm run build --silent

echo "-- installing the unit"
mkdir -p "$HOME/.config/systemd/user"
install -m 0644 deploy/k7.service "$HOME/.config/systemd/user/k7.service"
systemctl --user daemon-reload
systemctl --user enable --quiet k7.service
systemctl --user restart k7.service
REMOTE

# Poll for a bound port, not for unit state: systemd reports `active` the moment
# the process starts, which is before Node has finished listening, and a deploy
# that reports success against an unbound port is a deploy that lies.
say "waiting for the listener"
bound=""
for _ in $(seq 1 30); do
  bound=$(ssh -o BatchMode=yes "$HOST" "ss -ltn 2>/dev/null | grep -oE ':(8080|8443)\\b' | head -1" || true)
  [ -n "$bound" ] && break
  sleep 1
done
[ -z "$bound" ] && { echo "the service never bound a port — check: ssh $HOST journalctl --user -u k7 -n 40"; exit 1; }

ssh -o BatchMode=yes "$HOST" '
  echo "state:  $(systemctl --user is-active k7) / $(systemctl --user is-enabled k7)"
  echo "listening: $(ss -ltn 2>/dev/null | grep -oE ":(8080|8443)\\b" | tr -d ":" | sort -u | tr "\n" " ")"
  echo "--- last log lines ---"
  journalctl --user -u k7 -n 6 --no-pager -o cat 2>/dev/null | cut -c1-200
'
say "done"
