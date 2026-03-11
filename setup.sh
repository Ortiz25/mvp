#!/usr/bin/env bash
# =============================================================================
#  CityNet Captive Portal v2 — Raspberry Pi Setup Script
#  Run as pi user: bash setup.sh
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[→]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

BASE="/home/pi/captive-portal"

# ── System packages ──────────────────────────────────────────────────────────
info "Updating system packages…"
sudo apt-get update -qq && sudo apt-get upgrade -y -qq

# Node.js 20 LTS
if ! node -v 2>/dev/null | grep -q "v20\|v22"; then
  info "Installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &>/dev/null
  sudo apt-get install -y nodejs &>/dev/null
fi
ok "Node $(node -v)"

# nginx
sudo apt-get install -y nginx &>/dev/null
ok "nginx ready"

# PM2
command -v pm2 &>/dev/null || sudo npm install -g pm2 &>/dev/null
ok "PM2 $(pm2 -v)"

# ── Directory structure ───────────────────────────────────────────────────────
info "Creating directory structure…"
mkdir -p "$BASE"/{data,media,logs}
# media/{campaignId}/ subdirs are created automatically by the backend on upload
ok "Directories ready"

# ── Backend ──────────────────────────────────────────────────────────────────
info "Installing backend dependencies…"
cd "$BASE/backend"
npm install --omit=dev &>/dev/null
ok "Backend deps installed"

# Copy .env if not already present
if [[ ! -f "$BASE/backend/.env" ]]; then
  cp "$BASE/backend/.env.example" "$BASE/backend/.env"
  warn "Created $BASE/backend/.env — EDIT IT before starting (ADMIN_TOKEN, MIKROTIK_PASSWORD)"
fi

# Run DB migration + seed (migrate.js handles both in one call)
info "Running DB migration + seed…"
node "$BASE/backend/src/db/migrate.js"
ok "Database ready at $BASE/data/captive.db"

# ── Frontend build ────────────────────────────────────────────────────────────
info "Building captive portal frontend…"
cd "$BASE/frontend"
npm install &>/dev/null
npm run build &>/dev/null
ok "Frontend built → $BASE/frontend/dist"

# ── Admin build ───────────────────────────────────────────────────────────────
info "Building admin dashboard…"
cd "$BASE/admin"
npm install &>/dev/null
npm run build &>/dev/null
ok "Admin built → $BASE/admin/dist"

# ── nginx ────────────────────────────────────────────────────────────────────
info "Installing nginx config…"
sudo cp "$BASE/captive-portal.nginx" /etc/nginx/sites-available/captive-portal
sudo ln -sf /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/captive-portal
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
ok "nginx configured and reloaded"

# ── /etc/hosts ───────────────────────────────────────────────────────────────
if ! grep -q "captive.local" /etc/hosts; then
  echo "127.0.0.1  captive.local kolibri.local" | sudo tee -a /etc/hosts > /dev/null
fi
ok "Hosts updated"

# ── PM2 ──────────────────────────────────────────────────────────────────────
info "Starting backend with PM2…"
cd "$BASE"

# Stop any existing instance cleanly
pm2 delete captive-api 2>/dev/null || true

pm2 start ecosystem.config.cjs
pm2 save

# Register PM2 for boot (systemd)
STARTUP_CMD=$(sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u pi --hp /home/pi | grep "sudo env")
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
fi

ok "PM2 started and registered for boot"

# ── Health check ─────────────────────────────────────────────────────────────
info "Waiting for API to start…"
sleep 3
if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  ok "API is responding"
elif curl -sf http://localhost:3000/api/campaigns > /dev/null 2>&1; then
  ok "API is responding (campaigns endpoint)"
else
  warn "API may still be starting — check: pm2 logs captive-api"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Setup complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  Portal:   ${BLUE}http://captive.local${NC}"
echo -e "  Admin:    ${BLUE}http://192.168.88.2:8090${NC}  (subnet-only)"
echo -e "  API:      ${BLUE}http://192.168.88.2:3000/api/campaigns${NC}"
echo -e "  PM2 logs: ${BLUE}pm2 logs captive-api${NC}"
echo ""
echo -e "  ${YELLOW}Required next steps:${NC}"
echo -e "  1. Edit env:      ${YELLOW}nano $BASE/backend/.env${NC}"
echo -e "     → Set ADMIN_TOKEN and MIKROTIK_PASSWORD"
echo -e "  2. Restart API:   ${YELLOW}pm2 restart captive-api${NC}"
echo -e "  3. MikroTik:      ${YELLOW}apply mikrotik/mikrotik-config.rsc${NC}"
echo -e "  4. Reboot:        ${YELLOW}sudo reboot${NC}"
