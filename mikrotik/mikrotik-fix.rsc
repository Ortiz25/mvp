# =============================================================================
#  CityNet — MikroTik Hotspot Fix Script
#  Paste into MikroTik Terminal: Winbox > New Terminal, or SSH
#
#  Run this ONCE after initial setup, and again any time you reset the hotspot.
#
#  Fixes the white page / captive.local/login redirect loop:
#    - login-page MUST be http://captive.local/  (trailing slash, no /login)
#    - html-directory must point to flash/hotspot where login.html lives
#    - Walled garden must allow both the Pi (192.168.88.2) AND the router
#      itself (192.168.88.1) so the browser can complete the auth redirect
# =============================================================================

# ── 1. Fix hotspot server profile ─────────────────────────────────────────
# login-page: where MikroTik sends unauthenticated clients.
#   CORRECT:   http://captive.local/          ← root of the Pi portal SPA
#   WRONG:     http://captive.local/login     ← nginx serves index.html,
#              React Router has no /login route → blank page + loop
#
# login-by=mac + mac-auth-mode=mac-as-username-and-password:
#   Allows the Pi to authenticate a client by redirecting the browser to:
#   http://192.168.88.1/login?username=MAC&password=MAC&dst=URL
#   RouterOS matches MAC as both username and password and grants access.
#
/ip hotspot profile set hsprof1 \
  login-by=mac \
  mac-auth-mode=mac-as-username-and-password \
  login-page=http://captive.local/ \
  html-directory=flash/hotspot \
  http-cookie-lifetime=1d

# ── 2. Verify the hotspot server is using hsprof1 ─────────────────────────
/ip hotspot print

# ── 3. Fix walled-garden IP entries ───────────────────────────────────────
# Remove any broken entries and re-add clean ones.
# Both the Pi (192.168.88.2) and the MikroTik router (192.168.88.1) MUST
# be accessible pre-auth. Without 192.168.88.1 in the walled garden,
# the browser cannot reach the MikroTik /login endpoint to complete auth.
#
/ip hotspot walled-garden ip remove [find server=hotspot1]

/ip hotspot walled-garden ip add \
  server=hotspot1 \
  action=accept \
  dst-address=192.168.88.2 \
  comment="Pi — captive portal (all pre-auth traffic)"

/ip hotspot walled-garden ip add \
  server=hotspot1 \
  action=accept \
  dst-address=192.168.88.1 \
  comment="Router — hotspot login endpoint (needed for MAC auth grant)"

# ── 4. Verify walled-garden hostname entries ───────────────────────────────
# These should already exist from the initial config export.
# Check captive.local and all OS probe hostnames are present.
/ip hotspot walled-garden print

# ── 5. Verify DNS static entries ──────────────────────────────────────────
# captive.local must resolve to 192.168.88.2 (the Pi).
# All OS captive portal probe domains must also resolve to 192.168.88.2
# so MikroTik can intercept and redirect them to the portal.
/ip dns static print

# ── 6. Print active hotspot sessions (verify after a test login) ───────────
/ip hotspot active print

# =============================================================================
#  AFTER running this script:
#
#  1. Upload flash/hotspot/login.html from the Pi:
#       From the Pi terminal:
#         scp /home/admin/apps/mvp/mikrotik/login.html \
#             admin@192.168.88.1:/flash/hotspot/login.html
#       OR via Winbox: Files → flash/hotspot → drag login.html in
#
#  2. Test the full flow:
#       a) Connect a device to CityNet WiFi
#       b) Open a browser and visit http://example.com   (HTTP, not HTTPS)
#       c) Should redirect to http://captive.local/?mac=XX&ip=YY&dst=http://example.com
#       d) Complete the portal → should get internet access
#       e) Verify: /ip hotspot active print  (your MAC should appear)
#
#  3. If still seeing captive.local/login instead of captive.local/:
#       /ip hotspot profile print detail
#       Confirm login-page=http://captive.local/  (with trailing slash)
# =============================================================================
