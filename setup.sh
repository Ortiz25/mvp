#!/usr/bin/env bash
# =============================================================================
#  CityNet Captive Portal v2 — Setup Script
#  Run as the admin user from the project directory:  bash setup.sh
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[→]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Resolve paths dynamically ─────────────────────────────────────────────
# BASE = directory containing this script (works wherever you drop the project)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$SCRIPT_DIR"
WHOAMI="$(whoami)"
HOME_DIR="$(eval echo ~"$WHOAMI")"

ok "Running as user: $WHOAMI"
ok "Project base:    $BASE"
ok "Home dir:        $HOME_DIR"

# ── System packages ───────────────────────────────────────────────────────
info "Updating system packages…"
sudo apt-get update -qq && sudo apt-get upgrade -y -qq

# Node.js 20
if ! node -v 2>/dev/null | grep -q "v20"; then
  info "Installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &>/dev/null
  sudo apt-get install -y nodejs &>/dev/null
fi
ok "Node $(node -v)"

# nginx
sudo apt-get install -y nginx &>/dev/null
ok "nginx ready"

# PM2
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2 &>/dev/null
fi
ok "PM2 $(pm2 -v)"

# ── Directory structure ───────────────────────────────────────────────────
info "Creating directory structure…"
# Ensure the current user owns the project tree (handles root-owned uploads/git clones)
sudo chown -R "$WHOAMI":"$WHOAMI" "$BASE"
mkdir -p "$BASE/data" "$BASE/media" "$BASE/logs"
ok "Directories ready"

# ── Backend deps + migration ──────────────────────────────────────────────
info "Installing backend dependencies…"
cd "$BASE/backend"
npm install --production &>/dev/null
ok "Backend deps installed"

info "Running DB migration…"
node src/db/migrate.js
ok "Database ready"

# ── Helper: run a long command with a live spinner ────────────────────────
# Usage: run_step "Label" logfile cmd [args…]
run_step() {
  local label="$1" logfile="$2"; shift 2
  local spinchars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  "$@" >"$logfile" 2>&1 &
  local pid=$! i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${BLUE}%s${NC}  %s  " "${spinchars:$((i % ${#spinchars})):1}" "$label"
    i=$((i + 1)); sleep 0.15
  done
  printf "\r\033[K"   # clear spinner line
  wait "$pid" && return 0
  # on failure print last 20 lines of log then abort
  echo -e "${RED}[✗] FAILED: $label${NC}"
  echo -e "${YELLOW}── last lines of $logfile ──${NC}"
  tail -20 "$logfile"
  exit 1
}

# ── Frontend build ────────────────────────────────────────────────────────
info "Installing frontend dependencies…"
cd "$BASE/frontend"
run_step "npm install (frontend)" "$BASE/logs/frontend-install.log"  npm install
ok "Frontend deps installed"

info "Building captive portal frontend…"
run_step "npm run build (frontend)" "$BASE/logs/frontend-build.log"  npm run build
ok "Frontend built → $BASE/frontend/dist"

# ── Admin build ───────────────────────────────────────────────────────────
info "Installing admin dependencies…"
cd "$BASE/admin"
run_step "npm install (admin)" "$BASE/logs/admin-install.log"  npm install
ok "Admin deps installed"

info "Building admin dashboard…"
run_step "npm run build (admin)" "$BASE/logs/admin-build.log"  npm run build
ok "Admin built → $BASE/admin/dist"

# ── nginx config ──────────────────────────────────────────────────────────
info "Installing nginx config…"
NGINX_SRC="$BASE/captive-portal.nginx"
[[ -f "$NGINX_SRC" ]] || die "captive-portal.nginx not found at $NGINX_SRC"
sudo cp "$NGINX_SRC" /etc/nginx/sites-available/captive-portal
sudo ln -sf /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/captive-portal
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
ok "nginx configured"

# ── /etc/hosts ────────────────────────────────────────────────────────────
if ! grep -q "captive.local" /etc/hosts; then
  echo "127.0.0.1  captive.local kolibri.local kiwix.local" | sudo tee -a /etc/hosts > /dev/null
fi
ok "Hosts updated"

# ── .env ──────────────────────────────────────────────────────────────────
if [[ ! -f "$BASE/backend/.env" ]]; then
  cp "$BASE/backend/.env.example" "$BASE/backend/.env"
  warn "Created $BASE/backend/.env from example — edit it before using in production!"
fi

# ── ecosystem.config.cjs — patch BASE path dynamically ───────────────────
ECOSYSTEM="$BASE/ecosystem.config.cjs"
[[ -f "$ECOSYSTEM" ]] || die "ecosystem.config.cjs not found at $ECOSYSTEM"

# Patch the cwd and env paths in ecosystem to use actual BASE
sed -i "s|cwd:.*|cwd: '$BASE/backend',|g" "$ECOSYSTEM"
sed -i "s|DB_PATH:.*|DB_PATH: '$BASE/data/captive.db',|g" "$ECOSYSTEM"
sed -i "s|MEDIA_DIR:.*|MEDIA_DIR: '$BASE/media',|g" "$ECOSYSTEM"
ok "ecosystem.config.cjs patched for $BASE"

# ── PM2 startup ───────────────────────────────────────────────────────────
info "Starting backend with PM2…"
cd "$BASE"
pm2 start ecosystem.config.cjs
pm2 save

# Generate and apply the startup command for the current user
STARTUP_CMD=$(sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$WHOAMI" --hp "$HOME_DIR" | grep "sudo " | tail -1)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
  ok "PM2 registered for boot (user: $WHOAMI)"
else
  warn "Could not auto-register PM2 startup — run manually: pm2 startup"
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Setup complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  Portal:  ${BLUE}http://captive.local${NC}"
echo -e "  Admin:   ${BLUE}http://192.168.88.2:8090${NC}"
echo -e "  API:     ${BLUE}http://192.168.88.2:3000/api/campaigns${NC}"
echo ""
echo -e "  Next steps:"
echo -e "  1. ${YELLOW}nano $BASE/backend/.env${NC}  ← set MIKROTIK_PASSWORD + ADMIN_TOKEN"
echo -e "  2. Apply MikroTik config from ${YELLOW}$BASE/mikrotik/${NC}"
echo -e "  3. ${YELLOW}sudo reboot${NC}"