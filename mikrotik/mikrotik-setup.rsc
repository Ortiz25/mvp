# =============================================================================
#  CityNet — MikroTik Setup Script (RouterOS 7.x REST API mode)
#  Paste into Winbox Terminal or SSH session
#
#  This script configures the MikroTik for the REST API grant model.
#  The Pi backend calls the router's REST API to add/remove hotspot users
#  directly — no browser redirect to /login needed.
# =============================================================================

# ── 1. Create a dedicated API user for the Pi ─────────────────────────────
# This user is used by the Pi backend to call the REST API.
# IMPORTANT: Change the password to something strong before deploying.
/user add name=pi-api password=CHANGE_ME_STRONG_PASSWORD group=full \
  comment="CityNet Pi REST API user"

# Verify it was created:
/user print where name=pi-api

# ── 2. Hotspot profile — keep login-by=mac ────────────────────────────────
# login-by=mac means RouterOS auto-authenticates clients whose MAC is in
# /ip/hotspot/user. The Pi adds the MAC via REST API after portal completion.
# mac-auth-mode=mac-as-username-and-password is required for this to work.
/ip hotspot profile set hsprof1 \
  login-by=mac \
  mac-auth-mode=mac-as-username-and-password \
  dns-name=captive.local \
  hotspot-address=192.168.88.1 \
  html-directory=flash/hotspot

# ── 3. Hotspot server settings ────────────────────────────────────────────
# idle-timeout: disconnect client after 5min of inactivity (saves bandwidth)
# keepalive-timeout: ping interval to check client is still connected
/ip hotspot set hotspot1 \
  idle-timeout=5m \
  keepalive-timeout=none

# ── 4. Walled garden — ensure Pi and router are accessible pre-auth ───────
# These should already exist from previous setup, but verify:
/ip hotspot walled-garden ip print
# Should show:
#   dst-address=192.168.88.2  action=accept  (Pi — all traffic)
#   dst-address=192.168.88.1  action=accept  (Router — REST API + hotspot)

# If missing, add them:
# /ip hotspot walled-garden ip add action=accept dst-address=192.168.88.2 server=hotspot1
# /ip hotspot walled-garden ip add action=accept dst-address=192.168.88.1 server=hotspot1

# ── 5. Verify REST API is reachable ───────────────────────────────────────
# From the Pi terminal, test the REST API:
#   curl -u pi-api:CHANGE_ME_STRONG_PASSWORD http://192.168.88.1/rest/system/identity
# Expected response: {"name":"CityNet-Hotspot"}

# ── 6. Test the full flow ─────────────────────────────────────────────────
# Connect a device to CityNet WiFi.
# Complete the portal flow on the device.
# After grant, check the MikroTik — the MAC should appear in:
/ip hotspot user print
# The MAC should be listed as a user.
# Within 1-2 seconds it should also appear in:
/ip hotspot active print
# And the device should have internet access.

# ── 7. Manual grant test (from Pi terminal) ───────────────────────────────
# Replace AA:BB:CC:DD:EE:FF with the device MAC you want to test:
#
# curl -s -u pi-api:CHANGE_ME_STRONG_PASSWORD \
#   -X POST http://192.168.88.1/rest/ip/hotspot/user \
#   -H "Content-Type: application/json" \
#   -d '{"name":"AA:BB:CC:DD:EE:FF","mac-address":"AA:BB:CC:DD:EE:FF","profile":"default","limit-uptime":"01:00:00"}'
#
# Then check: /ip hotspot active print
# =============================================================================
