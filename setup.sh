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
#    2.  Installs FreeRADIUS + MySQL + configures the radius database
#    3.  Backend npm install + DB migration
#    4.  Builds frontend and admin React apps
#    5.  Installs nginx config
#    6.  Creates backend/.env from example if not present
#    7.  Patches ecosystem.config.cjs paths
#    8.  Starts API with PM2 + registers autostart
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

# ── 2. FreeRADIUS + MySQL ────────────────────────────────────────────────
header "FreeRADIUS + MySQL"

if ! command -v freeradius &>/dev/null; then
  info "Installing FreeRADIUS + MySQL…"
  sudo apt-get install -y freeradius freeradius-mysql mysql-server >/dev/null 2>&1
  ok "FreeRADIUS + MySQL installed"
else
  ok "FreeRADIUS already installed"
fi

# Load the RADIUS DB password from .env.example (or .env if it exists)
ENV_FILE="$BASE/backend/.env"
ENV_EXAMPLE="$BASE/backend/.env.example"
RADIUS_PASS=$(grep RADIUS_DB_PASS "$ENV_FILE" 2>/dev/null || grep RADIUS_DB_PASS "$ENV_EXAMPLE") 
RADIUS_PASS=$(echo "$RADIUS_PASS" | cut -d= -f2 | tr -d ' ')

if [[ "$RADIUS_PASS" == "CHANGE_ME_radius_db_password" ]]; then
  warn "RADIUS_DB_PASS is still the placeholder in .env.example"
  warn "Edit backend/.env and set a real password, then re-run setup.sh"
  warn "Skipping MySQL radius DB setup — do it manually per RADIUS_SETUP.md"
else
  info "Setting up radius MySQL database…"
  sudo mysql -u root -e "
    CREATE DATABASE IF NOT EXISTS radius;
    CREATE USER IF NOT EXISTS 'radius'@'localhost' IDENTIFIED BY '${RADIUS_PASS}';
    GRANT ALL PRIVILEGES ON radius.* TO 'radius'@'localhost';
    FLUSH PRIVILEGES;
  " 2>/dev/null || warn "MySQL setup skipped (may need sudo mysql_secure_installation first)"

  # Import FreeRADIUS schema if tables don't exist yet
  TABLE_COUNT=$(sudo mysql -u root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='radius';" 2>/dev/null | tail -1 || echo "0")
  if [[ "$TABLE_COUNT" -lt 4 ]]; then
    sudo mysql -u root radius < /etc/freeradius/3.0/mods-config/sql/main/mysql/schema.sql 2>/dev/null && ok "radius schema imported" || warn "Schema import failed — import manually"
  else
    ok "radius schema already present ($TABLE_COUNT tables)"
  fi

  # Enable SQL module
  if [[ ! -L /etc/freeradius/3.0/mods-enabled/sql ]]; then
    sudo ln -s /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
    ok "FreeRADIUS SQL module enabled"
  fi

  # Patch FreeRADIUS SQL module password
  sudo sed -i "s/password = .*/password = \"${RADIUS_PASS}\"/" /etc/freeradius/3.0/mods-available/sql 2>/dev/null || true

  sudo systemctl enable freeradius >/dev/null 2>&1
  sudo systemctl restart freeradius && ok "FreeRADIUS started" || warn "FreeRADIUS failed to start — check: sudo freeradius -X"
fi

# ── 3. Directories ───────────────────────────────────────────────────────
header "Directories"
mkdir -p "$BASE"/{data,media,logs}
sudo chown -R "$WHOAMI":"$WHOAMI" "$BASE"
_path="$BASE"
while [[ "$_path" != "/" ]]; do
  sudo chmod o+x "$_path" 2>/dev/null || true
  _path="$(dirname "$_path")"
done
ok "Directories ready"

# ── 4. Backend ───────────────────────────────────────────────────────────
header "Backend"
cd "$BASE/backend"
npm install --production --silent
ok "Backend deps installed (includes mysql2)"
node src/db/migrate.js
ok "SQLite DB migrated"

# ── 5. Frontend ──────────────────────────────────────────────────────────
header "Frontend"
rm -f "$BASE/frontend/dist/index.html" 2>/dev/null || true
cd "$BASE/frontend"
npm install --silent
npm run build --silent
ok "Frontend built"

# ── 6. Admin ─────────────────────────────────────────────────────────────
header "Admin"
rm -f "$BASE/admin/dist/index.html" 2>/dev/null || true
cd "$BASE/admin"
npm install --silent
npm run build --silent
ok "Admin built"

# ── 7. nginx ─────────────────────────────────────────────────────────────
header "nginx"
sudo cp "$BASE/captive-portal.nginx" /etc/nginx/sites-available/captive-portal
sudo sed -i "s|/home/admin/apps/mvp|$BASE|g" /etc/nginx/sites-available/captive-portal
sudo ln -sf /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/captive-portal
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
ok "nginx configured"

# ── 8. /etc/hosts ────────────────────────────────────────────────────────
grep -q "captive.local" /etc/hosts || echo "127.0.0.1  captive.local" | sudo tee -a /etc/hosts >/dev/null
ok "/etc/hosts updated"

# ── 9. .env ──────────────────────────────────────────────────────────────
header "Environment"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  sed -i "s|/home/admin/apps/mvp|$BASE|g" "$ENV_FILE"
  warn ".env created — EDIT IT:"
  warn "  nano $ENV_FILE"
  warn "  → Set ADMIN_TOKEN"
  warn "  → Set RADIUS_DB_PASS (same password used in MySQL setup above)"
else
  ok ".env already exists"
fi

# ── 10. PM2 ──────────────────────────────────────────────────────────────
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
echo -e "  1. Complete FreeRADIUS config: ${YELLOW}nano RADIUS_SETUP.md${NC}"
echo -e "  2. Set ADMIN_TOKEN + RADIUS_DB_PASS: ${YELLOW}nano $ENV_FILE${NC}"
echo -e "  3. Add MikroTik RADIUS client: ${YELLOW}cat mikrotik/mikrotik-setup.rsc${NC}"
echo -e "  4. Restart API: ${YELLOW}pm2 restart captive-api --update-env${NC}"
echo ""
