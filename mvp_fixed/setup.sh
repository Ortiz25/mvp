#!/usr/bin/env bash
# =============================================================================
#  CityNet Captive Portal — Raspberry Pi Setup Script
#  MikroTik Hotspot edition — no RouterOS API credentials required
#
#  Usage:
#    cd /home/admin/apps/mvp
#    bash setup.sh
#
#  What it does:
#    1.  Installs system packages (Node.js 20, nginx, PM2)
#    2.  Creates required directories with correct permissions
#    3.  Installs backend npm dependencies + runs DB migration
#    4.  Builds frontend and admin React apps
#    5.  Installs nginx config (patches paths to match BASE)
#    6.  Creates backend/.env from example if not present
#    7.  Patches ecosystem.config.cjs with correct BASE path
#    8.  Starts the API with PM2 + registers autostart on boot
#
#  Dev vs Live mode:
#    Default install uses MIKROTIK_MOCK=true (dev/testing).
#    Change to MIKROTIK_MOCK=false in backend/.env once the
#    MikroTik Hotspot config (mikrotik/mikrotik-hotspot.rsc) is applied.
# =============================================================================
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
info()   { echo -e "${BLUE}[→]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; exit 1; }
header() { echo -e "\n${BOLD}${BLUE}── $* ──${NC}"; }

# ── Spinner ──────────────────────────────────────────────────────────────────
_spin_pid=""
spin_start() {
  local msg="${1:-Working…}"
  local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  ( while true; do
      for (( i=0; i<${#chars}; i++ )); do
        echo -en "\r  ${BLUE}${chars:$i:1}${NC} $msg   " >&2
        sleep 0.1
      done
    done ) &
  _spin_pid=$!
}
spin_stop() {
  if [[ -n "$_spin_pid" ]]; then kill "$_spin_pid" 2>/dev/null; _spin_pid=""; fi
  echo -en "\r\033[K" >&2
}

# ── Detect base directory ─────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$SCRIPT_DIR"

# ── Detect running user ───────────────────────────────────────────────────
WHOAMI="$(whoami)"
HOME_DIR="$(eval echo ~$WHOAMI)"

echo ""
echo -e "${BOLD}CityNet Captive Portal — Setup${NC}"
echo -e "  Base directory : ${BLUE}$BASE${NC}"
echo -e "  Running as     : ${BLUE}$WHOAMI${NC}"
echo -e "  Home           : ${BLUE}$HOME_DIR${NC}"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────
[[ -d "$BASE/backend"  ]] || err "backend/ not found in $BASE"
[[ -d "$BASE/frontend" ]] || err "frontend/ not found in $BASE"
[[ -d "$BASE/admin"    ]] || err "admin/ not found in $BASE"

# ── 1. System packages ────────────────────────────────────────────────────
header "System packages"

info "Updating apt…"
sudo apt-get update -qq

# Node.js 20 LTS
if ! node -v 2>/dev/null | grep -q v20; then
  info "Installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y nodejs >/dev/null 2>&1
fi
ok "Node $(node -v)"

# nginx
if ! command -v nginx &>/dev/null; then
  sudo apt-get install -y nginx >/dev/null 2>&1
fi
ok "nginx $(nginx -v 2>&1 | grep -oP '[\d.]+')"

# PM2
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2 globally…"
  sudo npm install -g pm2 >/dev/null 2>&1
fi
ok "PM2 $(pm2 -v)"

# ── 2. Directories & permissions ─────────────────────────────────────────
header "Directories"

mkdir -p "$BASE"/{data,media,logs}
sudo chown -R "$WHOAMI":"$WHOAMI" "$BASE"

# nginx needs execute (traverse) permission on every dir in the path
_path="$BASE"
while [[ "$_path" != "/" ]]; do
  sudo chmod o+x "$_path" 2>/dev/null || true
  _path="$(dirname "$_path")"
done

ok "Directories ready: data/ media/ logs/"

# ── 3. Backend ────────────────────────────────────────────────────────────
header "Backend"

spin_start "Installing backend dependencies…"
cd "$BASE/backend"
npm install --production --silent
spin_stop
ok "Backend deps installed"

info "Running DB migration…"
node src/db/migrate.js
ok "Database migrated + seeded"

# ── 4. Frontend ───────────────────────────────────────────────────────────
header "Frontend"

# Remove stale Vite build artifacts that can cause blank-page issues
rm -f "$BASE/frontend/dist/index.html" 2>/dev/null || true

spin_start "Installing frontend dependencies…"
cd "$BASE/frontend"
npm install --silent
spin_stop

spin_start "Building frontend…"
npm run build --silent
spin_stop
ok "Frontend built → $BASE/frontend/dist"

# ── 5. Admin ──────────────────────────────────────────────────────────────
header "Admin"

rm -f "$BASE/admin/dist/index.html" 2>/dev/null || true

spin_start "Installing admin dependencies…"
cd "$BASE/admin"
npm install --silent
spin_stop

spin_start "Building admin…"
npm run build --silent
spin_stop
ok "Admin built → $BASE/admin/dist"

# ── 6. nginx config ───────────────────────────────────────────────────────
header "nginx"

NGINX_CONF="$BASE/captive-portal.nginx"
[[ -f "$NGINX_CONF" ]] || err "captive-portal.nginx not found at $BASE"

sudo cp "$NGINX_CONF" /etc/nginx/sites-available/captive-portal

# Patch any legacy paths to use the current BASE
sudo sed -i "s|/home/pi/captive-portal|$BASE|g"  /etc/nginx/sites-available/captive-portal
sudo sed -i "s|/home/admin/apps/mvp|$BASE|g"     /etc/nginx/sites-available/captive-portal

# Enable site, remove default
sudo ln -sf /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/captive-portal
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
ok "nginx configured and reloaded"

# ── 7. /etc/hosts ─────────────────────────────────────────────────────────
header "Hosts"

grep -q "captive.local" /etc/hosts || echo "127.0.0.1  captive.local" | sudo tee -a /etc/hosts >/dev/null
grep -q "kolibri.local" /etc/hosts || echo "127.0.0.1  kolibri.local" | sudo tee -a /etc/hosts >/dev/null
ok "/etc/hosts updated (captive.local, kolibri.local)"

# ── 8. .env ───────────────────────────────────────────────────────────────
header "Environment"

ENV_FILE="$BASE/backend/.env"
ENV_EXAMPLE="$BASE/backend/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  # Patch paths in .env
  sed -i "s|/home/admin/apps/mvp|$BASE|g" "$ENV_FILE"
  warn ".env created from example — EDIT IT BEFORE GOING LIVE:"
  warn "  nano $ENV_FILE"
  warn "  → Set ADMIN_TOKEN to something secure"
  warn "  → Set MIKROTIK_MOCK=false once MikroTik Hotspot is configured"
else
  ok ".env already exists — skipping (edit manually if needed)"
fi

# ── 9. ecosystem.config.cjs — patch BASE path ─────────────────────────────
header "PM2 config"

ECOS="$BASE/ecosystem.config.cjs"
[[ -f "$ECOS" ]] || err "ecosystem.config.cjs not found at $BASE"

sed -i "s|cwd:.*'.*'|cwd:         '$BASE'|"                             "$ECOS"
sed -i "s|DB_PATH:.*'.*'|DB_PATH:   '$BASE/data/captive.db'|"           "$ECOS"
sed -i "s|MEDIA_DIR:.*'.*'|MEDIA_DIR: '$BASE/media'|"                   "$ECOS"
sed -i "s|error_file:.*'.*'|error_file: '$BASE/logs/error.log'|"        "$ECOS"
sed -i "s|out_file:.*'.*'|out_file:   '$BASE/logs/out.log'|"            "$ECOS"

ok "ecosystem.config.cjs paths updated → $BASE"

# ── 10. PM2 start ─────────────────────────────────────────────────────────
header "PM2"

cd "$BASE"

pm2 delete captive-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Register PM2 startup
STARTUP_CMD=$(pm2 startup systemd -u "$WHOAMI" --hp "$HOME_DIR" 2>&1 | grep "sudo env" | head -1)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
  ok "PM2 startup registered for $WHOAMI"
else
  warn "Could not auto-register PM2 startup — run manually:"
  warn "  sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u $WHOAMI --hp $HOME_DIR"
fi

ok "PM2 started: captive-api"

# ── Done ─────────────────────────────────────────────────────────────────
PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅  Setup complete!${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Portal  :  ${BLUE}http://captive.local${NC}   or  ${BLUE}http://$PI_IP${NC}"
echo -e "  Admin   :  ${BLUE}http://$PI_IP:8090${NC}"
echo -e "  API     :  ${BLUE}http://$PI_IP:3000/health${NC}"
echo ""
echo -e "${YELLOW}${BOLD}  ── Next steps ──────────────────────────────────────────${NC}"
echo ""
echo -e "  1. Set a secure admin token + choose mode:"
echo -e "     ${YELLOW}nano $ENV_FILE${NC}"
echo -e "     → ADMIN_TOKEN=your-secret-here"
echo -e "     → MIKROTIK_MOCK=true   ← keep for dev/testing"
echo -e "     → MIKROTIK_MOCK=false  ← set when router is ready"
echo ""
echo -e "  2. Apply MikroTik Hotspot config in Winbox / Terminal:"
echo -e "     Paste: ${YELLOW}$BASE/mikrotik/mikrotik-hotspot.rsc${NC}"
echo -e "     (Replace XX:XX:XX:XX:XX:XX with the Pi's MAC address)"
echo ""
echo -e "  3. Reload the API after editing .env:"
echo -e "     ${YELLOW}pm2 restart captive-api --update-env${NC}"
echo ""
echo -e "  4. Verify the API is running:"
echo -e "     ${YELLOW}pm2 status${NC}"
echo -e "     ${YELLOW}curl http://localhost:3000/health${NC}"
echo ""
echo -e "  5. Reboot to verify autostart:"
echo -e "     ${YELLOW}sudo reboot${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "     ${BLUE}pm2 logs captive-api --lines 50${NC}"
echo -e "     ${BLUE}sudo nginx -t && sudo systemctl reload nginx${NC}"
echo -e "     ${BLUE}sudo tail -30 /var/log/nginx/error.log${NC}"
echo -e "     ${BLUE}curl -H 'x-admin-token: your-token' http://localhost:3000/api/admin/stats${NC}"
echo ""
