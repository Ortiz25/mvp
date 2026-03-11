# =============================================================================
#  CityNet — Hotspot Fix Script
#  Paste into MikroTik Terminal (Winbox > New Terminal or SSH)
#
#  Fixes:
#   1. Hotspot profile — use login-by=mac only (simplest, most reliable)
#   2. Walled garden IP entries — fix dst-address syntax
#   3. flash/hotspot/login.html — updated to pass dst= param correctly
#
#  The login.html fix must be done via Winbox Files or SCP (see below).
# =============================================================================

# ── 1. Fix hotspot server profile ─────────────────────────────────────────
# Change login-by to mac only. cookie and http-chap are not needed and
# can interfere with the MAC-as-username-and-password flow.
/ip hotspot profile set hsprof1 \
  login-by=mac \
  mac-auth-mode=mac-as-username-and-password \
  login-page=http://captive.local/ \
  html-directory=flash/hotspot

# ── 2. Fix walled garden IP entries ───────────────────────────────────────
# Remove the broken entries (they use dst-address-list syntax which is wrong)
# and replace with correct dst-address entries.
/ip hotspot walled-garden ip
remove [find server=hotspot1]

add server=hotspot1 action=accept dst-address=192.168.88.2 \
    comment="Pi — all traffic pre-auth"
add server=hotspot1 action=accept dst-address=192.168.88.1 \
    comment="Router — hotspot login URL"

# ── 3. Verify walled garden hostname entries are correct ───────────────────
# (These should already be correct from initial config)
/ip hotspot walled-garden print

# ── 4. Verify active hotspot ──────────────────────────────────────────────
/ip hotspot print
/ip hotspot active print

# =============================================================================
#  IMPORTANT: Update login.html on the router
#
#  The login.html file needs one change: pass dst= instead of link-orig=
#  so the Pi portal receives the original destination URL correctly.
#
#  Option A — Winbox:
#    1. Open Winbox → Files → flash/hotspot/
#    2. Double-click login.html → edit
#    3. Change the form to match the file at: mikrotik/login.html
#    4. Save
#
#  Option B — SCP from the Pi:
#    scp /home/admin/apps/mvp/mikrotik/login.html admin@192.168.88.1:/flash/hotspot/login.html
#    (Replace 'admin' with your MikroTik admin username)
#
#  Option C — Paste via Terminal:
#    /file set flash/hotspot/login.html contents="<html>...</html>"
#    (Tedious for large files — use Winbox Files instead)
# =============================================================================

# ── 5. After updating login.html, test the flow ───────────────────────────
# Connect a device to CityNet WiFi
# Try browsing http://example.com (HTTP, not HTTPS)
# Should redirect to captive.local with ?mac=XX&ip=YY&dst=http://example.com
# Complete portal flow → should get internet access
# Verify: /ip hotspot active print  (your device should appear)

