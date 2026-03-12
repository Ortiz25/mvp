# =============================================================================
#  CityNet MikroTik Configuration — RADIUS Edition
#  Paste into Winbox Terminal or upload via /file and import
# =============================================================================

# ── 1. Add FreeRADIUS server (Pi at 192.168.88.2) ─────────────────────────
/radius
add service=hotspot \
    address=192.168.88.2 \
    secret=citynet_radius_secret \
    authentication-port=1812 \
    accounting-port=1813 \
    timeout=3s \
    comment="CityNet FreeRADIUS on Pi"

# ── 2. Hotspot server profile ─────────────────────────────────────────────
# If hsprof1 already exists, use 'set' instead of 'add'
/ip hotspot profile
set hsprof1 \
    login-by=mac \
    mac-auth-mode=mac-as-username-and-password \
    use-radius=yes \
    radius-mac-format=XX:XX:XX:XX:XX:XX \
    dns-name=captive.local \
    html-directory=flash/hotspot \
    http-proxy=0.0.0.0:0

# ── 3. Hotspot server (adjust interface to your LAN bridge) ───────────────
/ip hotspot
set hotspot1 \
    profile=hsprof1 \
    address-pool=hotspot-pool \
    disabled=no

# ── 4. DNS entry so captive.local resolves to Pi ─────────────────────────
/ip dns static
add name=captive.local address=192.168.88.2 comment="CityNet portal"

# ── 5. Verify ─────────────────────────────────────────────────────────────
/radius print
/ip hotspot profile print
# Expected: use-radius=yes, radius-mac-format=XX:XX:XX:XX:XX:XX

# ── Notes ─────────────────────────────────────────────────────────────────
# shared secret 'citynet_radius_secret' must match /etc/freeradius/3.0/clients.conf
# MAC format XX:XX:XX:XX:XX:XX means uppercase, colon-separated
# This must match exactly what radius.js writes to radcheck username column
