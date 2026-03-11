# ==============================================================================
#  CityNet Captive Portal — MikroTik RouterOS Hotspot Configuration
#  RouterOS 7.x  (compatible with 6.49+)
#
#  Architecture:
#    WAN:    ether1           — uplink to ISP
#    LAN:    bridge1          — ether2–ether5 + wlan1
#    Pi:     192.168.88.2     — Raspberry Pi (captive portal + API)
#    Router: 192.168.88.1     — MikroTik gateway
#    Hotspot pool: 192.168.88.50–200
#
#  How it works:
#    1. Client connects to Wi-Fi, tries to browse
#    2. MikroTik Hotspot intercepts and redirects to:
#         http://captive.local/?mac=XX&ip=YY&username=XX&dst=http://original
#    3. Portal shows video → survey flow
#    4. After completion, portal redirects browser to:
#         http://192.168.88.1/login?username=MAC&password=MAC&dst=http://original
#    5. MikroTik receives the GET, authenticates MAC, redirects to dst
#    6. Session lives in RouterOS natively — survives reboots
#
#  NO RouterOS API user needed.
#  NO address-list management from Node.js.
#  NO firewall rule per-client.
#
#  Paste into Winbox > New Terminal, or SSH as admin.
#  Review each section before pasting. Run section-by-section if unsure.
# ==============================================================================


# ==============================================================================
# SECTION 1 — Bridge & interface setup
# Skip if bridge already exists on your router.
# ==============================================================================
/interface bridge
add name=bridge1 comment="LAN bridge" fast-forward=yes

/interface bridge port
add bridge=bridge1 interface=ether2 comment="LAN port 2"
add bridge=bridge1 interface=ether3 comment="LAN port 3"
add bridge=bridge1 interface=ether4 comment="LAN port 4"
add bridge=bridge1 interface=ether5 comment="LAN port 5"
# Uncomment if you have built-in wireless:
# add bridge=bridge1 interface=wlan1 comment="WiFi"


# ==============================================================================
# SECTION 2 — IP addressing
# ==============================================================================
/ip address
add address=192.168.88.1/24 interface=bridge1 comment="LAN gateway"
# WAN: replace with your actual config. Options:
#   DHCP:   /ip dhcp-client add interface=ether1 disabled=no
#   Static: add address=YOUR_WAN_IP/MASK interface=ether1
/ip dhcp-client
add interface=ether1 disabled=no comment="WAN DHCP — edit for static"


# ==============================================================================
# SECTION 3 — DNS
# MikroTik acts as DNS resolver.
# Static entries redirect captive portal detection probes to the Pi,
# and resolve local services (kolibri.local, etc.) without internet.
# ==============================================================================
/ip dns
set allow-remote-requests=yes \
    servers=8.8.8.8,1.1.1.1 \
    cache-size=4096KiB

/ip dns static
# ── Local services ────────────────────────────────────────────────────────
add name=captive.local  address=192.168.88.2 comment="Captive portal frontend"
add name=kolibri.local  address=192.168.88.2 comment="Kolibri offline learning"
add name=kiwix.local    address=192.168.88.2 comment="Kiwix / Wikipedia offline"

# ── Captive portal detection — redirect all OS probes to Pi ─────────────
# Android / Chrome
add name=clients3.google.com          address=192.168.88.2 comment="Android 204 detect"
add name=connectivitycheck.android.com address=192.168.88.2 comment="Android check"
add name=connectivitycheck.gstatic.com address=192.168.88.2 comment="Android gstatic check"
# Windows NCSI
add name=www.msftconnecttest.com      address=192.168.88.2 comment="Windows NCSI"
add name=msftconnecttest.com          address=192.168.88.2 comment="Windows NCSI alt"
# Firefox
add name=detectportal.firefox.com     address=192.168.88.2 comment="Firefox portal detect"
# Apple (iOS / macOS)
add name=captive.apple.com            address=192.168.88.2 comment="Apple captive detect"
add name=www.apple.com                address=192.168.88.2 comment="Apple check alt"


# ==============================================================================
# SECTION 4 — NAT (masquerade for internet access)
# ==============================================================================
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade \
    comment="NAT: LAN clients to internet"


# ==============================================================================
# SECTION 5 — MikroTik Hotspot
#
# The Hotspot subsystem handles:
#   - Intercepting HTTP requests from unauthenticated clients
#   - Redirecting them to the portal with ?mac=, ?ip=, ?dst= params
#   - Receiving the login GET from the portal and authenticating the client
#   - Managing session state, timeouts, and expiry natively
#   - Surviving reboots (sessions are written to RouterOS config)
# ==============================================================================

# ── Hotspot IP pool ────────────────────────────────────────────────────────
/ip pool
add name=hotspot-pool ranges=192.168.88.50-192.168.88.200 \
    comment="Hotspot client DHCP pool"

# ── Hotspot DHCP (replaces any existing DHCP on bridge1) ─────────────────
/ip dhcp-server
add name=hotspot-dhcp \
    interface=bridge1 \
    address-pool=hotspot-pool \
    lease-time=8h \
    disabled=no \
    comment="Hotspot DHCP server"

/ip dhcp-server network
add address=192.168.88.0/24 \
    gateway=192.168.88.1 \
    dns-server=192.168.88.1 \
    comment="Hotspot client network"

# ── DHCP lease for the Raspberry Pi (static) ──────────────────────────────
# Replace XX:XX:XX:XX:XX:XX with the actual Pi MAC address.
# Run: /ip dhcp-server lease print  to find the Pi after it connects.
/ip dhcp-server lease
add address=192.168.88.2 \
    mac-address=XX:XX:XX:XX:XX:XX \
    server=hotspot-dhcp \
    comment="Raspberry Pi — replace MAC with actual value"

# ── Hotspot user profile ───────────────────────────────────────────────────
# Rate limits and session settings per user.
# Adjust rate-limit as needed (format: "up/down" in bps, K, M).
/ip hotspot user profile
add name=citynet-users \
    rate-limit="5M/10M" \
    session-timeout=8h \
    idle-timeout=30m \
    keepalive-timeout=none \
    shared-users=1 \
    comment="Default portal user profile"

# ── Hotspot server profile ────────────────────────────────────────────────
# This is the key section. login-by=mac means:
#   The portal authenticates users by sending their MAC as username + password.
#   No account creation needed — any MAC is auto-provisioned.
# login-page points to the Pi. MikroTik appends ?mac=, ?ip=, ?dst= to this URL.
/ip hotspot server profile
add name=citynet-profile \
    login-by=mac \
    login-page=http://captive.local/ \
    split-user-domain=no \
    use-radius=no \
    dns-name=captive.local \
    hotspot-address=192.168.88.1 \
    html-directory=hotspot \
    rate-limit="5M/10M" \
    trial-uptime=0s \
    comment="CityNet portal server profile"

# ── Hotspot server (activate on the bridge) ──────────────────────────────
/ip hotspot
add name=citynet-hotspot \
    interface=bridge1 \
    address-pool=hotspot-pool \
    profile=citynet-profile \
    disabled=no \
    comment="CityNet captive portal hotspot"


# ==============================================================================
# SECTION 6 — Hotspot Walled Garden
# Clients can access these destinations WITHOUT authenticating first.
# This is how the portal frontend, API, and offline services load before auth.
# ==============================================================================
/ip hotspot walled-garden
# Portal frontend and API (Pi)
add server=citynet-hotspot dst-host=captive.local comment="Portal (hostname)"
add server=citynet-hotspot dst-host=192.168.88.2  comment="Portal (IP)"
# Offline local services
add server=citynet-hotspot dst-host=kolibri.local comment="Kolibri offline learning"
add server=citynet-hotspot dst-host=kiwix.local   comment="Kiwix offline Wikipedia"
# Captive portal detection endpoints
add server=citynet-hotspot dst-host=captive.apple.com         comment="Apple detect"
add server=citynet-hotspot dst-host=www.apple.com             comment="Apple check"
add server=citynet-hotspot dst-host=www.msftconnecttest.com   comment="Windows NCSI"
add server=citynet-hotspot dst-host=detectportal.firefox.com  comment="Firefox detect"
add server=citynet-hotspot dst-host=clients3.google.com       comment="Android detect"
add server=citynet-hotspot dst-host=connectivitycheck.android.com comment="Android check"

# ── IP-based walled garden (allow Pi subnet regardless of hostname) ───────
/ip hotspot walled-garden ip
add server=citynet-hotspot dst-address=192.168.88.2 comment="Pi — all traffic pre-auth"
add server=citynet-hotspot dst-address=192.168.88.1 comment="Router — hotspot login URL"


# ==============================================================================
# SECTION 7 — Wireless (if using MikroTik built-in WiFi)
# Skip if using an external access point bridged to ether2–5.
# ==============================================================================
# /interface wireless
# set wlan1 \
#     mode=ap-bridge \
#     ssid="CityNet Free WiFi" \
#     band=2ghz-b/g/n \
#     frequency=auto \
#     country=kenya \
#     disabled=no
#
# /interface wireless security-profiles
# set default authentication-types="" mode=none
# (Open network — captive portal handles authentication)


# ==============================================================================
# SECTION 8 — Minimal firewall (Hotspot manages per-client access)
# NOTE: MikroTik Hotspot inserts its own dynamic rules automatically.
#       These are base rules only. Do NOT add address-list rules for
#       authorized-clients — Hotspot handles that internally.
# ==============================================================================
/ip firewall filter

# ── INPUT chain (protect the router) ──────────────────────────────────────
add chain=input action=accept connection-state=established,related \
    comment="FW: Input — accept established"
add chain=input action=accept in-interface=bridge1 \
    comment="FW: Input — allow LAN (DNS, DHCP, Hotspot login)"
add chain=input action=accept in-interface=lo \
    comment="FW: Input — loopback"
add chain=input action=drop \
    comment="FW: Input — drop all else"

# ── FORWARD chain (Hotspot inserts its own rules above these) ─────────────
add chain=forward action=accept connection-state=established,related \
    comment="FW: Forward — accept established"
add chain=forward action=drop connection-state=invalid \
    comment="FW: Forward — drop invalid"
add chain=forward action=accept src-address=192.168.88.2 \
    comment="FW: Forward — Pi gets full internet"
# Note: Hotspot dynamically inserts ACCEPT rules above the default DROP
# for each authenticated client. No static per-client rules needed.
add chain=forward action=drop in-interface=bridge1 \
    comment="FW: Forward — drop unauthenticated (Hotspot overrides per session)"


# ==============================================================================
# SECTION 9 — System settings
# ==============================================================================
/system ntp client
set enabled=yes primary-ntp=pool.ntp.org secondary-ntp=time.cloudflare.com

/system clock
set time-zone-autodetect=yes

# ── Router identity (shows up in logs and MikroTik discovery) ─────────────
/system identity
set name=CityNet-Hotspot


# ==============================================================================
# SECTION 10 — Logging
# ==============================================================================
/system logging
add topics=hotspot    action=memory comment="Log Hotspot events"
add topics=dhcp       action=memory comment="Log DHCP"
add topics=firewall   action=memory comment="Log firewall"


# ==============================================================================
# VERIFICATION COMMANDS
# Run these after applying to confirm everything is active:
# ==============================================================================
# /ip hotspot print
# /ip hotspot active print
# /ip hotspot host print
# /ip hotspot walled-garden print
# /ip hotspot walled-garden ip print
# /ip dns static print
# /ip dhcp-server lease print
# /ip pool print


# ==============================================================================
# TESTING PROCEDURE
# ==============================================================================
# ── Dev testing (MIKROTIK_MOCK=true in Pi .env) ───────────────────────────
# 1. Open http://localhost:5173 (or http://captive.local) in a browser
# 2. Complete the flow: Pick campaign → Watch video (sim) → Survey
# 3. Should redirect to /success page (mock mode)
# 4. Admin panel at http://localhost:5174 (or http://Pi_IP:8090)
#    → Sessions tab should show session with video_watched + survey_done
#
# ── Live testing (MIKROTIK_MOCK=false, router configured above) ───────────
# 1. Connect a phone/laptop to the CityNet Wi-Fi
# 2. Try visiting http://example.com (or any HTTP site)
# 3. Should automatically redirect to http://captive.local/?mac=XX&ip=YY&dst=http://example.com
# 4. Complete portal flow
# 5. On last step, browser goes to http://192.168.88.1/login?username=MAC&password=MAC&dst=...
# 6. MikroTik authenticates and redirects to the original destination
# 7. Internet should now work
# 8. /ip hotspot active print  should show your client MAC
#
# ── HTTPS note ────────────────────────────────────────────────────────────
# MikroTik Hotspot only intercepts HTTP (port 80).
# Modern browsers that use HTTPS first will show a connection error.
# The OS captive portal detection (iOS, Android, Windows) uses HTTP first,
# so the popup usually appears before the user tries HTTPS manually.
# For the best experience, ensure your DNS static entries are set correctly
# so the OS probes hit the Pi and trigger the popup.


# ==============================================================================
# TROUBLESHOOTING
# ==============================================================================
# Q: Portal doesn't load / connection refused
# A: Check Pi is reachable: /ping 192.168.88.2
#    Check nginx: ssh pi@192.168.88.2  then  sudo systemctl status nginx
#    Check hotspot is active: /ip hotspot print
#
# Q: iOS/Android not showing captive portal popup
# A: Verify DNS static entries:  /ip dns static print
#    Apple checks captive.apple.com — must be in walled garden + DNS
#    Android checks clients3.google.com + connectivitycheck — same
#
# Q: Portal loads but "Connected" never happens
# A: Check MIKROTIK_MOCK=false in backend/.env
#    Check MIKROTIK_HOST=192.168.88.1 in backend/.env
#    Confirm hotspot server is active: /ip hotspot print
#    Check Pi logs: pm2 logs captive-api --lines 50
#
# Q: User granted access but still can't browse
# A: Check /ip hotspot active print — client should appear here
#    Check forward firewall: /ip firewall filter print  (Hotspot inserts dynamic rules)
#    Check NAT masquerade: /ip firewall nat print
#
# Q: Sessions don't survive router reboot
# A: THIS IS FIXED with Hotspot — RouterOS persists hotspot active sessions.
#    If sessions are being lost, check /ip hotspot server profile print
#    and ensure keepalive-timeout is configured.
#
# Q: Rate limiting not working
# A: Edit citynet-users profile rate-limit: /ip hotspot user profile edit citynet-users
#    Format: "upload/download" e.g. "2M/5M" = 2Mbps up, 5Mbps down
#    Set to "" (empty) to disable rate limiting.
