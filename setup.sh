#!/usr/bin/env bash
# =============================================================================
#  CityNet Captive Portal — Pi-as-router edition — Setup Script
#
#  Usage:
#    cd /home/admin/apps/captive-portal
#    bash setup.sh
#
#  What it does:
#    1. Installs Node.js 20, nginx, PM2
#    2. Backend npm install + DB migration
#    3. Builds frontend and admin React apps
#    4. Installs nginx config
#    5. Creates backend/.env from .env.example if not present
#    6. Patches ecosystem.config.cjs with correct paths
#    7. Starts API with PM2 + registers autostart
#
#  NOTE: FreeRADIUS + MariaDB + iptables setup done separately.
#        See DEPLOYMENT.md for full steps.
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

echo ""
echo -e "${BOLD}CityNet Captive Portal — Pi-as-router edition${NC}"
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
mkdir -p "$BASE"/{data,media,logs,frontend/dist,admin/dist}
sudo chown -R "$WHOAMI":"$WHOAMI" "$BASE"
ok "Directories ready"

# ── 3. Backend ───────────────────────────────────────────────────────────
header "Backend"
cd "$BASE/backend"
npm install --omit=dev 2>&1 | tail -3
ok "Backend deps installed"

if [[ ! -f "$BASE/backend/.env" ]]; then
  cp "$BASE/backend/.env.example" "$BASE/backend/.env"
  warn "Created backend/.env from .env.example — EDIT IT before starting!"
  warn "  nano $BASE/backend/.env"
else
  ok "backend/.env already exists"
fi

node src/db/migrate.js
ok "DB migrated"

# ── 4. Frontend ──────────────────────────────────────────────────────────
header "Frontend (React portal)"
cd "$BASE/frontend"
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -5
ok "Frontend built → frontend/dist"

# ── 5. Admin ─────────────────────────────────────────────────────────────
header "Admin panel"
cd "$BASE/admin"
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -5
ok "Admin built → admin/dist"

# ── 6. nginx ─────────────────────────────────────────────────────────────
header "nginx"
# Patch frontend/admin dist paths in nginx config
NGINX_CONF="/etc/nginx/sites-available/captive-portal"
sudo cp "$BASE/captive-portal.nginx" "$NGINX_CONF"
sudo sed -i "s|/home/admin/apps/captive-portal|$BASE|g" "$NGINX_CONF"
sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/captive-portal
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
ok "nginx configured and reloaded"

# ── 7. ecosystem.config.cjs — patch paths ────────────────────────────────
header "PM2 ecosystem"
sed -i "s|/home/admin/apps/captive-portal|$BASE|g" "$BASE/ecosystem.config.cjs"
ok "ecosystem.config.cjs paths patched to $BASE"

# ── 8. PM2 ───────────────────────────────────────────────────────────────
header "PM2"
cd "$BASE"
pm2 delete captive-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
ok "PM2 started captive-api"

PM2_STARTUP=$(pm2 startup 2>&1 | grep "sudo env" || true)
if [[ -n "$PM2_STARTUP" ]]; then
  warn "Run this command to enable PM2 on boot:"
  echo -e "  ${YELLOW}${PM2_STARTUP}${NC}"
fi

# ── Done ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo -e "  Portal:       ${BLUE}http://192.168.100.1/${NC}"
echo -e "  Admin panel:  ${BLUE}http://192.168.100.1:8090/${NC}"
echo -e "  API health:   ${BLUE}http://192.168.100.1/health${NC}"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. Edit backend/.env and set RADIUS_DB_PASS + ADMIN_TOKEN"
echo -e "  2. Run iptables setup:  sudo bash /etc/captive-portal/iptables-setup.sh"
echo -e "  3. Connect MikroTik as dumb AP (see DEPLOYMENT.md Part 6)"
echo -e "  4. Connect a phone to Wi-Fi and test the portal flow"
echo ""
