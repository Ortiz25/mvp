#!/usr/bin/env bash
# =============================================================================
#  CityNet Captive Portal — RADIUS Edition — Raspberry Pi Setup
#
#  Usage:
#    cd /home/admin/apps/mvp
#    bash setup.sh
#
#  What it does:
#    1.  Installs Node.js 20, nginx, PM2
#    2.  Backend npm install + DB migration
#    3.  Builds frontend and admin React apps
#    4.  Installs nginx config
#    5.  Creates backend/.env from example if not present
#    6.  Patches ecosystem.config.cjs paths
#    7.  Starts API with PM2 + registers autostart
#
#  NOTE: FreeRADIUS + MariaDB setup is done separately (already configured).
#        See RADIUS_SETUP.md for manual steps.
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
info()   { echo -e "${BLUE}[→]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
err()    { echo -e "${RED}[✗]${NC} $*"; exit 1; }
header() { echo -e "\n${BOLD}${BLUE}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$SCRIPT_DIR"
WHOAMI="$(whoami)"
HOME_DIR="$(eval echo ~$WHOAMI)"

echo ""
echo -e "${BOLD}CityNet Captive Portal — RADIUS Edition Setup${NC}"
echo -e "  Base : ${BLUE}$BASE${NC}"
echo -e "  User : ${BLUE}$WHOAMI${NC}"
echo ""

[[ -d "$BASE/backend"  ]] || err "backend/ not found"
[[ -d "$BASE/frontend" ]] || err "frontend/ not found"
[[ -d "$BASE/admin"    ]] || err "admin/ not found"

# ── 1. System packages ───────────────────────────────────────────────────
header "System packages"
sudo apt-get update -qq

if ! node -v 2>/dev/null | grep -q v20; then
  info "Installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y nodejs >/dev/null 2>&1
fi
ok "Node $(node -v)"

if ! command -v nginx &>/dev/null; then
  sudo apt-get install -y nginx >/dev/null 2>&1
fi
ok "nginx ready"

if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2 >/dev/null 2>&1
fi
ok "PM2 ready"

# ── 2. Directories ───────────────────────────────────────────────────────
header "Directories"
mkdir -p "$BASE"/{data,media,logs}
sudo chown -R "$WHOAMI":"$WHOAMI" "$BASE"
_path="$BASE"
while [[ "$_path" != "/" ]]; do
  sudo chmod o+x "$_path" 2>/dev/null || true
  _path="$(dirname "$_path")"
done
ok "Directories ready"

# ── 3. Backend ───────────────────────────────────────────────────────────
header "Backend"
cd "$BASE/backend"
npm install --production --silent
ok "Backend deps installed (includes mysql2)"
node src/db/migrate.js
ok "SQLite DB migrated"

# ── 4. Frontend ──────────────────────────────────────────────────────────
header "Frontend"
rm -f "$BASE/frontend/dist/index.html" 2>/dev/null || true
cd "$BASE/frontend"
npm install --silent
npm run build --silent
ok "Frontend built"

# ── 5. Admin ─────────────────────────────────────────────────────────────
header "Admin"
rm -f "$BASE/admin/dist/index.html" 2>/dev/null || true
cd "$BASE/admin"
npm install --silent
npm run build --silent
ok "Admin built"

# ── 6. nginx ─────────────────────────────────────────────────────────────
header "nginx"
sudo cp "$BASE/captive-portal.nginx" /etc/nginx/sites-available/captive-portal
sudo sed -i "s|/home/admin/apps/mvp|$BASE|g" /etc/nginx/sites-available/captive-portal
sudo ln -sf /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/captive-portal
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
ok "nginx configured"

# ── 7. /etc/hosts ────────────────────────────────────────────────────────
header "Hosts"
grep -q "captive.local" /etc/hosts || echo "127.0.0.1  captive.local" | sudo tee -a /etc/hosts >/dev/null
ok "/etc/hosts updated"

# ── 8. .env ──────────────────────────────────────────────────────────────
header "Environment"
ENV_FILE="$BASE/backend/.env"
ENV_EXAMPLE="$BASE/backend/.env.example"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  sed -i "s|/home/admin/apps/mvp|$BASE|g" "$ENV_FILE"
  warn ".env created — EDIT IT before starting the API:"
  warn "  nano $ENV_FILE"
  warn "  → Set ADMIN_TOKEN"
  warn "  → Set RADIUS_DB_PASS (must match MariaDB radius user password)"
else
  ok ".env already exists"
fi

# ── 9. PM2 ──────────────────────────────────────────────────────────────
header "PM2"
ECOS="$BASE/ecosystem.config.cjs"
sed -i "s|cwd:.*'.*'|cwd:         '$BASE'|"                      "$ECOS"
sed -i "s|DB_PATH:.*'.*'|DB_PATH:   '$BASE/data/captive.db'|"    "$ECOS"
sed -i "s|MEDIA_DIR:.*'.*'|MEDIA_DIR: '$BASE/media'|"            "$ECOS"
sed -i "s|error_file:.*'.*'|error_file: '$BASE/logs/error.log'|" "$ECOS"
sed -i "s|out_file:.*'.*'|out_file:   '$BASE/logs/out.log'|"     "$ECOS"

cd "$BASE"
pm2 delete captive-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

STARTUP_CMD=$(pm2 startup systemd -u "$WHOAMI" --hp "$HOME_DIR" 2>&1 | grep "sudo env" | head -1)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
  ok "PM2 startup registered"
fi

PI_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅  Setup complete!${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Portal : ${BLUE}http://captive.local${NC}  or  ${BLUE}http://$PI_IP${NC}"
echo -e "  Admin  : ${BLUE}http://$PI_IP:8090${NC}"
echo -e "  API    : ${BLUE}http://$PI_IP:3000/health${NC}"
echo ""
echo -e "${YELLOW}${BOLD}  Next steps:${NC}"
echo -e "  1. Verify RADIUS is running : ${YELLOW}sudo systemctl status freeradius${NC}"
echo -e "  2. Verify MariaDB is running: ${YELLOW}sudo systemctl status mariadb${NC}"
echo -e "  3. Check API logs           : ${YELLOW}pm2 logs captive-api${NC}"
echo ""