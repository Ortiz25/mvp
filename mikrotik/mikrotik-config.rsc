# ==============================================================================
#  CityNet Captive Portal — MikroTik RouterOS Configuration
#  RouterOS 7.x  (compatible with 6.49+)
#
#  Network topology:
#    WAN:     ether1          — uplink to ISP
#    LAN:     bridge1         — internal switch (ether2–ether5 + optional wlan1)
#    Pi:      192.168.88.2    — Raspberry Pi (static IP, runs nginx + Node.js)
#    Router:  192.168.88.1    — MikroTik gateway
#    Clients: 192.168.88.0/24 — DHCP pool for hotspot users
#
#  Services on the Pi:
#    :80   — nginx → captive portal frontend (React SPA) + API proxy
#    :3000 — Node.js backend API (internal only, proxied by nginx)
#    :8080 — Kolibri offline learning (walled garden — pre-auth)
#    :8090 — Admin dashboard (LAN only)
#
#  Paste into MikroTik Terminal (Winbox → New Terminal) or SSH.
#  Review every CHANGE_ME before applying to production.
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
# WAN — replace with your actual config (DHCP client or static):
# /ip dhcp-client add interface=ether1 disabled=no   # if ISP gives DHCP
# add address=YOUR_WAN_IP/MASK interface=ether1       # if static


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 3 — DHCP server for clients
# ──────────────────────────────────────────────────────────────────────────────
/ip pool
add name=captive-pool ranges=192.168.88.50-192.168.88.200

/ip dhcp-server
add address-pool=captive-pool disabled=no interface=bridge1 \
    lease-time=8h name=captive-dhcp

/ip dhcp-server network
add address=192.168.88.0/24 \
    gateway=192.168.88.1 \
    dns-server=192.168.88.1 \
    comment="Captive portal client network"

# Reserve static IP for Raspberry Pi — replace with actual Pi MAC address
/ip dhcp-server lease
add address=192.168.88.2 mac-address=XX:XX:XX:XX:XX:XX \
    comment="Raspberry Pi — CHANGE_ME: set real Pi MAC address"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 4 — DNS
# MikroTik acts as the local DNS resolver.
# Static entries redirect captive detection hostnames to the Pi so that
# devices automatically show the "Sign in to network" popup.
# ──────────────────────────────────────────────────────────────────────────────
/ip dns
set allow-remote-requests=yes \
    servers=8.8.8.8,8.8.4.4 \
    cache-size=2048KiB

/ip dns static
# Local services on Pi
add name=captive.local  address=192.168.88.2 comment="Captive portal frontend"
add name=kolibri.local  address=192.168.88.2 comment="Kolibri learning platform"
add name=kiwix.local    address=192.168.88.2 comment="Kiwix Wikipedia offline"

# ── Captive portal detection — device-specific ────────────────────────────────
# Windows (NCSI — Network Connectivity Status Indicator)
add name=www.msftconnecttest.com    address=192.168.88.2 comment="Windows NCSI"
add name=connecttest.txt.msedge.net address=192.168.88.2 comment="Windows NCSI Edge"
add name=ipv6.msftconnecttest.com   address=192.168.88.2 comment="Windows NCSI IPv6"

# Firefox
add name=detectportal.firefox.com   address=192.168.88.2 comment="Firefox portal detect"
add name=firefox.com                address=192.168.88.2 comment="Firefox fallback"

# Android / Chrome
add name=clients3.google.com        address=192.168.88.2 comment="Android 204 detect"
add name=connectivitycheck.gstatic.com address=192.168.88.2 comment="Android/Chrome connectivity"
add name=connectivitycheck.android.com address=192.168.88.2 comment="Android connectivity"

# Apple (iOS, macOS, tvOS)
# Without these, Apple devices will NOT show the captive portal popup
add name=captive.apple.com          address=192.168.88.2 comment="Apple CNA — REQUIRED for iOS/macOS popup"
add name=www.apple.com              address=192.168.88.2 comment="Apple connectivity check"
add name=gsp1.apple.com             address=192.168.88.2 comment="Apple portal detect"
add name=www.appleiphonecell.com    address=192.168.88.2 comment="Apple cellular detect"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 5 — Firewall address lists
#
# authorized-clients — managed DYNAMICALLY by Node.js backend via MikroTik API.
#   The backend adds a client IP with a timeout equal to session_hours when
#   access is granted. MikroTik auto-removes timed entries on expiry.
#   NOTE: These entries are LOST on MikroTik reboot. See Section 12 for the
#   reboot-recovery scheduler that re-syncs active DB sessions on startup.
#
# walled-garden — STATIC list of IPs/subnets always accessible pre-auth.
#   Clients can reach these before completing the portal flow.
# ──────────────────────────────────────────────────────────────────────────────
/ip firewall address-list

# ── Walled garden — always accessible, no auth required ──────────────────────
# Raspberry Pi itself (port 80 = portal, port 8080 = Kolibri, port 8090 = admin)
add list=walled-garden address=192.168.88.2  comment="Pi — captive portal, Kolibri, admin"

# If you add other always-accessible local services, add them here:
# add list=walled-garden address=192.168.88.3 comment="e.g. local NAS"
# add list=walled-garden address=192.168.88.4 comment="e.g. local printer"

# ── Authorized clients — populated by Node.js at runtime ─────────────────────
# (No static entries here — managed entirely by backend)


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 6 — Dedicated API user for the Node.js backend
# The backend uses RouterOS API (port 8728) to add/remove authorized-clients
# and to look up ARP entries for MAC address detection.
# Minimal permissions — no need for full admin access.
# ──────────────────────────────────────────────────────────────────────────────
/user group
add name=captive-api-group \
    policy=api,read,write \
    comment="Captive portal API — minimal permissions"

/user
add name=captive-api \
    group=captive-api-group \
    password=CHANGE_ME \
    comment="Used by Pi Node.js backend — CHANGE_ME: set strong password"

# Restrict the RouterOS API service to only accept connections from the Pi
/ip service
set api address=192.168.88.2/32 port=8728 disabled=no \
    comment="RouterOS API — Pi only"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 7 — NAT rules
# ──────────────────────────────────────────────────────────────────────────────
/ip firewall nat

# 7a. Masquerade outbound traffic (LAN clients → internet via WAN)
add chain=srcnat out-interface=ether1 action=masquerade \
    comment="NAT: LAN → internet"

# 7b. Redirect all HTTP from unauthenticated clients to captive portal (Pi port 80)
#     Matches: client is on LAN, NOT in authorized-clients, NOT already targeting Pi
#     IMPORTANT: this must be placed BEFORE any accept rules for HTTP
add chain=dstnat protocol=tcp dst-port=80 \
    src-address=192.168.88.0/24 \
    src-address-list=!authorized-clients \
    dst-address=!192.168.88.2 \
    action=dst-nat to-addresses=192.168.88.2 to-ports=80 \
    comment="Captive portal: redirect HTTP → Pi"

# 7c. HTTPS redirect (optional)
#     Clients will get a TLS certificate warning. Better UX to leave disabled
#     and let devices retry HTTP after portal redirect. Enable if needed.
# add chain=dstnat protocol=tcp dst-port=443 \
#     src-address=192.168.88.0/24 \
#     src-address-list=!authorized-clients \
#     dst-address=!192.168.88.2 \
#     action=dst-nat to-addresses=192.168.88.2 to-ports=80 \
#     comment="Captive portal: redirect HTTPS → Pi (optional)"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 8 — Firewall filter rules
# Applied in order — FIRST MATCH WINS.
# ──────────────────────────────────────────────────────────────────────────────
/ip firewall filter

# 8a. Accept established/related (performance — early exit, skip remaining rules)
add chain=forward action=accept connection-state=established,related \
    comment="FW: Accept established/related"

# 8b. Drop invalid packets
add chain=forward action=drop connection-state=invalid \
    comment="FW: Drop invalid"

# 8c. Raspberry Pi gets full forward access (serves portal + reaches internet for updates)
add chain=forward action=accept src-address=192.168.88.2 \
    comment="FW: Pi — full forward"

# 8d. Allow all clients to reach walled-garden destinations (portal, Kolibri, etc.)
#     This covers: port 80 (portal), port 8080 (Kolibri), port 8090 (admin)
#     on the Pi — all accessible before authentication.
add chain=forward action=accept \
    src-address=192.168.88.0/24 \
    dst-address-list=walled-garden \
    comment="FW: Walled garden — pre-auth access to Pi services"

# 8e. Authorized clients get full internet access
add chain=forward action=accept \
    src-address-list=authorized-clients \
    comment="FW: Authorized clients — internet"

# 8f. DNS — allow ALL clients (required for captive detection and walled-garden resolution)
add chain=forward action=accept protocol=udp dst-port=53 \
    src-address=192.168.88.0/24 \
    comment="FW: DNS UDP — all clients"

add chain=forward action=accept protocol=tcp dst-port=53 \
    src-address=192.168.88.0/24 \
    comment="FW: DNS TCP — all clients"

# 8g. NTP — allow all clients (time sync, important for session expiry accuracy)
add chain=forward action=accept protocol=udp dst-port=123 \
    src-address=192.168.88.0/24 \
    comment="FW: NTP — all clients"

# 8h. DROP everything else from the captive subnet
#     Unauthenticated clients are blocked here after the above passes.
#     MUST BE THE LAST FORWARD RULE for the captive subnet.
add chain=forward action=drop \
    src-address=192.168.88.0/24 \
    comment="FW: Drop unauthenticated — MUST BE LAST"

# ── INPUT chain (protect the router itself) ───────────────────────────────────
add chain=input action=accept connection-state=established,related \
    comment="FW: Input — established/related"

add chain=input action=accept in-interface=bridge1 \
    comment="FW: Input — LAN (DNS, DHCP, API port 8728)"

add chain=input action=accept in-interface=lo \
    comment="FW: Input — loopback"

add chain=input action=drop \
    comment="FW: Input — drop all other"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 9 — Wireless (optional — if using built-in WiFi)
# ──────────────────────────────────────────────────────────────────────────────
# /interface wireless
# set wlan1 \
#     mode=ap-bridge \
#     ssid="CityNet-Free-WiFi" \
#     band=2ghz-b/g/n \
#     frequency=auto \
#     country=kenya \
#     disabled=no
#
# /interface wireless security-profiles
# set default authentication-types="" mode=none
# (Open network — captive portal handles auth)
#
# /interface bridge port
# add bridge=bridge1 interface=wlan1


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 10 — NTP client
# Accurate time is critical — session expiry is calculated from timestamps.
# ──────────────────────────────────────────────────────────────────────────────
/system ntp client
set enabled=yes primary-ntp=pool.ntp.org secondary-ntp=time.cloudflare.com


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 11 — Logging
# ──────────────────────────────────────────────────────────────────────────────
/system logging
add topics=firewall,info action=memory comment="Log firewall events (in-memory)"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 12 — Schedulers
#
# IMPORTANT — Reboot gap:
#   MikroTik removes timed address-list entries on reboot.
#   Clients who had active sessions will lose internet after a router reboot
#   until the Node.js backend re-grants them.
#
#   The scheduler below calls the Pi's /api/mikrotik/resync endpoint on startup.
#   This endpoint (added to backend) re-adds all non-expired DB sessions to
#   the authorized-clients list automatically.
#
#   If the Pi is also rebooting at the same time, the script retries after 60s.
# ──────────────────────────────────────────────────────────────────────────────
/system scheduler

# On boot: ask Pi to re-sync all active sessions back into authorized-clients
add name=captive-boot-resync \
    start-time=startup \
    interval=0 \
    on-event="/tool fetch url=\"http://192.168.88.2:3000/api/mikrotik/resync\" http-method=post keep-result=no" \
    comment="On boot: restore authorized-clients from Pi DB"

# Daily midnight cleanup — removes ALL authorized-clients entries.
# Sessions still active in the Pi DB will be re-added on next client activity
# or can be restored by hitting the resync endpoint manually.
add name=captive-midnight-cleanup \
    start-time=00:00:00 \
    interval=1d \
    on-event=":foreach i in=[/ip firewall address-list find list=authorized-clients] do={ /ip firewall address-list remove \$i }" \
    comment="Daily: clear all authorized-clients (Pi re-grants active sessions on next request)"


# ──────────────────────────────────────────────────────────────────────────────
# VERIFICATION COMMANDS
# Run these after applying to confirm everything is correct:
# ──────────────────────────────────────────────────────────────────────────────
# /ip firewall filter print
# /ip firewall nat print
# /ip firewall address-list print
# /ip dns static print
# /ip dhcp-server lease print
# /user print
# /ip service print


# ──────────────────────────────────────────────────────────────────────────────
# TESTING PROCEDURE
# ──────────────────────────────────────────────────────────────────────────────
# 1. Connect test device → verify DHCP lease (192.168.88.50–200)
# 2. Visit http://example.com → should redirect to http://captive.local
# 3. iOS/macOS: should show "Sign in to network" popup automatically
# 4. Android: should show captive portal notification
# 5. Complete portal flow (pick campaign → watch video → survey)
# 6. Check: /ip firewall address-list print   → client IP in authorized-clients
# 7. Visit http://www.google.com → should load
# 8. After session_hours, IP expires → client is blocked again


# ──────────────────────────────────────────────────────────────────────────────
# TROUBLESHOOTING
# ──────────────────────────────────────────────────────────────────────────────
# Q: Redirect happens but portal page won't load
# A: Check nginx on Pi: sudo systemctl status nginx
#    Check backend: pm2 status captive-api / pm2 logs captive-api
#    Confirm Pi has 192.168.88.2: ip addr
#
# Q: Video won't play on portal
# A: Nginx must proxy /media/ to the Node.js backend.
#    Check captive-portal.nginx has a location /media/ block.
#    Confirm file exists: ls ~/captive-portal/media/{campaignId}/
#
# Q: iOS/macOS doesn't show the "Sign in" popup
# A: DNS entries for captive.apple.com and www.apple.com must point to Pi.
#    Verify: /ip dns static print | where name=captive.apple.com
#    Apple checks these URLs immediately on joining the network.
#
# Q: Android doesn't show captive portal notification
# A: Verify connectivitycheck.gstatic.com and clients3.google.com DNS entries.
#    Android does an HTTP GET to these — Pi must intercept and return 302.
#
# Q: MikroTik API connection refused from Node.js
# A: /ip service print — confirm api is enabled on port 8728
#    Confirm address= is set to 192.168.88.2/32 (Pi only)
#    Test from Pi: curl -v telnet://192.168.88.1:8728
#
# Q: Authorized clients lose internet after MikroTik reboot
# A: Normal — timed address-list entries don't survive reboot.
#    The boot-resync scheduler calls /api/mikrotik/resync on the Pi.
#    Manually trigger: /tool fetch url="http://192.168.88.2:3000/api/mikrotik/resync" http-method=post
#
# Q: Kolibri not accessible before auth
# A: kolibri.local must resolve to 192.168.88.2 — check DNS static entry.
#    The walled-garden address-list entry for 192.168.88.2 allows ALL ports
#    (80, 8080, 8090) on the Pi through the firewall for pre-auth clients.
#    Confirm Pi nginx has a server block for kolibri.local on port 80.
