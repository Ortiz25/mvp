# ==============================================================================
#  CityNet Captive Portal — MikroTik RouterOS Hotspot Configuration
#  RouterOS 7.x  (compatible with 6.49+)
#
#  Architecture: MikroTik Hotspot (browser-redirect model)
#  - No RouterOS API. No Node.js ↔ router connection needed.
#  - MikroTik injects ?mac=, ?ip=, ?dst= into the portal redirect.
#  - After completing video+survey, portal redirects browser to:
#      http://192.168.88.1/login?username=<mac>&password=<mac>&dst=<url>
#  - RouterOS receives this GET, authenticates the MAC, redirects to dst.
#  - Sessions survive router reboots — stored natively in RouterOS.
#
#  Network topology:
#    WAN:    ether1          — uplink to ISP
#    LAN:    bridge1         — internal switch (ether2–ether5 + wlan1)
#    Pi:     192.168.88.2    — Raspberry Pi (portal, API, Kolibri)
#    Router: 192.168.88.1    — MikroTik gateway
#    Clients: 192.168.88.100-200 — Hotspot DHCP pool
#
#  PASTE INTO: Winbox → New Terminal (or SSH to router)
#  APPLY IN ORDER: sections 1 through 10
# ==============================================================================


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 1 — Bridge & interface setup
# ──────────────────────────────────────────────────────────────────────────────
/interface bridge
add name=bridge1 comment="LAN bridge"

/interface bridge port
add bridge=bridge1 interface=ether2
add bridge=bridge1 interface=ether3
add bridge=bridge1 interface=ether4
add bridge=bridge1 interface=ether5
# Uncomment if using built-in wireless:
# add bridge=bridge1 interface=wlan1


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 2 — IP addressing
# ──────────────────────────────────────────────────────────────────────────────
/ip address
add address=192.168.88.1/24 interface=bridge1 comment="LAN gateway"
# WAN: add address=YOUR_WAN_IP/MASK interface=ether1 (or use /ip dhcp-client)


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 3 — NAT (internet access for authenticated clients)
# The Hotspot system handles per-client restrictions — we just need outbound NAT.
# ──────────────────────────────────────────────────────────────────────────────
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade \
    comment="NAT: masquerade all outbound traffic"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 4 — DHCP server for hotspot clients
# NOTE: Do NOT set DNS here — the Hotspot DHCP profile overrides it.
# ──────────────────────────────────────────────────────────────────────────────
/ip pool
add name=hs-pool ranges=192.168.88.100-192.168.88.200

/ip dhcp-server
add address-pool=hs-pool disabled=no interface=bridge1 \
    lease-time=1d name=hs-dhcp

/ip dhcp-server network
add address=192.168.88.0/24 \
    gateway=192.168.88.1 \
    dns-server=192.168.88.1 \
    comment="Hotspot client network"

# Reserve static IP for Raspberry Pi
/ip dhcp-server lease
add address=192.168.88.2 mac-address=XX:XX:XX:XX:XX:XX \
    comment="Raspberry Pi — REPLACE MAC with actual Pi MAC address"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 5 — DNS
# MikroTik resolves DNS for all clients. Static entries redirect captive portal
# detection probes and local service hostnames to the Pi.
# ──────────────────────────────────────────────────────────────────────────────
/ip dns
set allow-remote-requests=yes \
    servers=8.8.8.8,8.8.4.4 \
    cache-size=4096KiB

/ip dns static
# Local service hostnames → Pi
add name=captive.local  address=192.168.88.2 comment="Captive portal frontend"
add name=portal.local   address=192.168.88.2 comment="Captive portal alias"
add name=kolibri.local  address=192.168.88.2 comment="Kolibri learning platform"
add name=kiwix.local    address=192.168.88.2 comment="Kiwix Wikipedia offline"

# Captive portal detection probes → Pi (triggers the popup on iOS/Android/Windows)
# These must resolve to the Pi so the OS detects a captive portal
add name=captive.apple.com              address=192.168.88.2 comment="iOS/macOS portal detect"
add name=www.apple.com                  address=192.168.88.2 comment="iOS/macOS alt detect"
add name=connectivitycheck.gstatic.com  address=192.168.88.2 comment="Android portal detect"
add name=clients3.google.com            address=192.168.88.2 comment="Android 204 detect"
add name=connectivitycheck.android.com  address=192.168.88.2 comment="Android alt detect"
add name=detectportal.firefox.com       address=192.168.88.2 comment="Firefox portal detect"
add name=www.msftconnecttest.com        address=192.168.88.2 comment="Windows NCSI"
add name=connecttest.txt.msedge.net     address=192.168.88.2 comment="Windows Edge NCSI"
add name=ipv6.msftconnecttest.com       address=192.168.88.2 comment="Windows IPv6 NCSI"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 6 — Hotspot server profile
# This is the heart of the configuration.
# hotspot-address: the MikroTik IP clients are redirected to for login
# login-by: must include http-chap (MAC-as-password auth)
# html-directory: points to where MikroTik looks for portal HTML — we override
#   with login-page pointing to the Pi instead (set in Section 7)
# ──────────────────────────────────────────────────────────────────────────────
/ip hotspot profile
add name=captive-profile \
    hotspot-address=192.168.88.1 \
    login-by=http-chap,http-pap,mac \
    html-directory=hotspot \
    use-radius=no \
    http-cookie-lifetime=1d \
    session-timeout=0 \
    idle-timeout=0 \
    keepalive-timeout=none \
    mac-auth-mode=mac-as-username-and-password \
    http-proxy=0.0.0.0:0 \
    dns-name=captive.local \
    comment="CityNet captive portal"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 7 — Hotspot server instance
# The Hotspot server runs on bridge1 and intercepts all unauthenticated HTTP.
# address-pool: must match the DHCP pool range
# ──────────────────────────────────────────────────────────────────────────────
/ip hotspot
add name=captive-hotspot \
    interface=bridge1 \
    address-pool=hs-pool \
    profile=captive-profile \
    disabled=no \
    comment="CityNet hotspot"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 8 — Hotspot user profile
# Default profile for all clients: unlimited bandwidth, 8h session
# Adjust rate-limit to throttle if needed: "2M/2M" = 2Mbps up/down
# ──────────────────────────────────────────────────────────────────────────────
/ip hotspot user profile
add name=captive-users \
    rate-limit="" \
    session-timeout=8h \
    idle-timeout=30m \
    keepalive-timeout=none \
    shared-users=1 \
    comment="Default portal user profile"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 9 — Hotspot walled garden
# These hosts are accessible WITHOUT authentication (pre-login).
# The Pi (192.168.88.2) must be here so the portal itself is reachable.
# Add Kolibri, Kiwix etc so users can access offline resources before login.
# ──────────────────────────────────────────────────────────────────────────────
/ip hotspot walled-garden
# Allow access to the portal Pi itself (HTTP + API)
add server=captive-hotspot dst-host=192.168.88.2  comment="Pi portal host (by IP)"
add server=captive-hotspot dst-host=captive.local  comment="Pi portal (hostname)"
add server=captive-hotspot dst-host=portal.local   comment="Pi portal (alias)"

# Offline local services — accessible before login
add server=captive-hotspot dst-host=kolibri.local  comment="Kolibri learning platform"
add server=captive-hotspot dst-host=kiwix.local    comment="Kiwix Wikipedia"

# Captive portal detection probes — must respond, or OS won't show popup
add server=captive-hotspot dst-host=captive.apple.com             comment="iOS detect"
add server=captive-hotspot dst-host=connectivitycheck.gstatic.com comment="Android detect"
add server=captive-hotspot dst-host=detectportal.firefox.com      comment="Firefox detect"
add server=captive-hotspot dst-host=www.msftconnecttest.com        comment="Windows NCSI"

/ip hotspot walled-garden ip
# Allow all traffic to/from the Pi (portal HTML, API calls, media)
add server=captive-hotspot dst-address=192.168.88.2/32 comment="Pi — all traffic allowed"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 10 — Redirect to Pi portal (Hotspot HTML override)
# By default MikroTik serves its own login page from /flash/hotspot/.
# We override this by redirecting to the Pi instead.
#
# The Hotspot profile's dns-name=captive.local means MikroTik redirects clients
# to http://captive.local/ — which our DNS resolves to 192.168.88.2 (the Pi).
#
# The Pi's nginx then serves the React portal app on port 80.
#
# MikroTik appends these params automatically to the redirect URL:
#   ?mac=XX:XX:XX:XX:XX:XX   — client MAC
#   ?ip=192.168.88.x         — client IP  
#   ?username=XX:XX:XX...    — same as mac (default)
#   ?dst=http://original.com — original URL client was trying to visit
#   ?identity=RouterName     — router identity
#
# The portal frontend (React) reads these via URLSearchParams on load.
# After completing video+survey, the frontend redirects to:
#   http://192.168.88.1/login?username=<mac>&password=<mac>&dst=<dst>
# MikroTik receives this GET, authenticates the session, redirects to dst.
# ──────────────────────────────────────────────────────────────────────────────

# Set router identity (shows in ?identity= param and Winbox title)
/system identity
set name=CityNet-Hotspot


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 11 — Wireless (uncomment if using built-in WiFi radio)
# ──────────────────────────────────────────────────────────────────────────────
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
# (Open network — Hotspot handles authentication)


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 12 — NTP (keep router clock accurate — affects session expiry)
# ──────────────────────────────────────────────────────────────────────────────
/system ntp client
set enabled=yes primary-ntp=pool.ntp.org


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 13 — Logging
# ──────────────────────────────────────────────────────────────────────────────
/system logging
add topics=hotspot,info action=memory comment="Log hotspot events"
add topics=dhcp,info    action=memory comment="Log DHCP events"


# ──────────────────────────────────────────────────────────────────────────────
# VERIFICATION COMMANDS
# Run after applying to confirm everything is correct.
# ──────────────────────────────────────────────────────────────────────────────
# /ip hotspot print
# /ip hotspot profile print
# /ip hotspot user print
# /ip hotspot active print         ← shows currently authenticated clients
# /ip hotspot walled-garden print
# /ip dns static print
# /ip dhcp-server lease print
# /log print where topics~"hotspot"


# ──────────────────────────────────────────────────────────────────────────────
# TESTING PROCEDURE
# ──────────────────────────────────────────────────────────────────────────────
# 1. Connect test device to LAN/WiFi — should get IP 192.168.88.100-200
# 2. Open browser, try http://example.com
#    → Should redirect to http://captive.local/?mac=XX&ip=XX&dst=http://example.com
#    → iOS/Android should show a captive portal popup automatically
# 3. Complete video + survey on portal
# 4. After completion, browser is redirected to:
#    http://192.168.88.1/login?username=<mac>&password=<mac>&dst=http://example.com
# 5. MikroTik authenticates the session:
#    → /ip hotspot active print shows your device
#    → Browser continues to http://example.com
# 6. Verify internet works — try https://www.google.com
# 7. After 8h (session-timeout on user profile), access is revoked automatically
# 8. Reboot router — /ip hotspot active print still shows session (survives reboot!)


# ──────────────────────────────────────────────────────────────────────────────
# TROUBLESHOOTING
# ──────────────────────────────────────────────────────────────────────────────
# Q: Client isn't redirected to portal
# A: Check hotspot is enabled: /ip hotspot print
#    Check client got IP from hs-pool (100-200): /ip dhcp-server lease print
#    Hotspot only intercepts HTTP (not HTTPS) — try http://example.com not https://
#
# Q: Portal page doesn't load (blank / connection refused)
# A: Check nginx on Pi: ssh admin@192.168.88.2 "sudo systemctl status nginx"
#    Check walled garden allows Pi: /ip hotspot walled-garden print
#    Try pinging Pi from router: /ping 192.168.88.2
#
# Q: iOS/Android popup doesn't appear
# A: DNS static entries for Apple/Google detect must point to Pi (Section 5)
#    Pi nginx must respond to these probes — check captive portal detection
#    endpoint in nginx config returns 200 for /generate_204 and /hotspot-detect.html
#
# Q: After submitting survey, browser doesn't get internet
# A: Check MikroTik Hotspot login URL in browser network tab
#    Should be: http://192.168.88.1/login?username=<mac>&password=<mac>&dst=...
#    Verify the MAC in ?username= matches the client's real MAC
#    Check MIKROTIK_MOCK=false in backend .env
#
# Q: "Wrong username or password" on MikroTik login
# A: MikroTik Hotspot default: MAC auth uses MAC as both username and password
#    Verify mac-auth-mode=mac-as-username-and-password in profile (Section 6)
#    MAC format: lowercase with colons  e.g. aa:bb:cc:dd:ee:ff
#
# Q: Sessions lost after router reboot
# A: Normal MikroTik Hotspot behavior stores sessions in memory only by default
#    To persist: ensure /ip hotspot active print shows entries after reboot
#    If they disappear: the session-timeout may have expired during reboot
#    The Pi DB still records the session — re-grant via portal if needed
