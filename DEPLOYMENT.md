# CityNet Captive Portal — Deployment Guide
> **Stack:** Raspberry Pi 4 (router) · MikroTik/UniFi AP (dumb AP) · FreeRADIUS + MariaDB · nginx · Node.js/Express · React
>
> **Auth strategy:** iptables MAC chain (no ipset — `ip_set_hash_mac` not in RPi kernel)
> **No MikroTik login URL call** — Pi controls internet access directly via `iptables -I authorized_clients`

---

## Table of Contents
1. [Architecture](#architecture)
2. [Part 1 — Raspberry Pi OS & Network](#part-1--raspberry-pi-os--network)
3. [Part 2 — iptables Firewall](#part-2--iptables-firewall)
4. [Part 3 — dnsmasq (DHCP + DNS)](#part-3--dnsmasq-dhcp--dns)
5. [Part 4 — Software Stack](#part-4--software-stack)
6. [Part 5 — App Deployment](#part-5--app-deployment)
7. [Part 6 — MikroTik Dumb AP](#part-6--mikrotik-dumb-ap)
8. [Part 7 — Boot Services](#part-7--boot-services)
9. [Part 8 — Testing](#part-8--testing)
10. [Part 9 — Troubleshooting](#part-9--troubleshooting)
11. [Quick Reference](#quick-reference)

---

## Architecture

```
ISP Modem
    │
   eth0  ← WAN (DHCP from ISP modem)
[Raspberry Pi 4]
   eth1  ← LAN (USB Gigabit Adapter) — 192.168.100.1/24
    │
[MikroTik / UniFi AP]  ← Dumb AP (bridge only, no DHCP, no hotspot)
    │
   Wi-Fi
    │
[Client Devices]  ← 192.168.100.50–200 via Pi dnsmasq
```

### Traffic flow after a client connects

```
Client → Wi-Fi → MikroTik (bridge) → Pi eth1
                                          │
                               dnsmasq gives DHCP lease
                                          │
                         HTTP probe → iptables DNAT → nginx → React portal
                                          │
                              User watches video + survey
                                          │
                         POST /api/:slug/access/grant
                                          │
                              radius.js:
                                1. INSERT radcheck / radreply (FreeRADIUS MySQL)
                                2. iptables -I authorized_clients 1 -m mac --mac-source <MAC> -j ACCEPT
                                3. iptables -t nat -I PREROUTING 1 ... -j RETURN
                                          │
                              Client → Pi eth0 → Internet ✅
```

### Why iptables MAC chain instead of ipset

`ipset hash:mac` requires the `ip_set_hash_mac` kernel module which is **not compiled** into the Raspberry Pi custom kernel (`6.12.x+rpt-rpi-v8`). The module is not available via apt either. Using `iptables -m mac` works with the existing kernel — no extra modules needed.

---

## Part 1 — Raspberry Pi OS & Network

### Step 1: Flash Raspberry Pi OS Lite (64-bit)

Flash with Raspberry Pi Imager. In the settings gear before flashing:
- Hostname: `captiveportal.local`
- Enable SSH
- Set username/password (these examples use `admin`)

### Step 2: First boot — update and install basics

```bash
ssh admin@captiveportal.local

sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl git nano net-tools iptables
sudo reboot
```

### Step 3: Plug in USB Ethernet adapter and identify interfaces

```bash
ip link show
```

Expected:
```
2: eth0  — onboard NIC (WAN)
3: eth1  — USB adapter (LAN)  may appear as enx...
```

**If USB adapter shows as `enx...`, rename it:**

```bash
# Note the MAC from ip link show output
sudo nano /etc/udev/rules.d/10-network.rules
```

Add (replace MAC with yours):
```
SUBSYSTEM=="net", ACTION=="add", ATTR{address}=="xx:xx:xx:xx:xx:xx", NAME="eth1"
```

```bash
sudo reboot
ip link show   # confirm eth1 appears
```

### Step 4: Set static IP on LAN interface (eth1)

> **Note:** If NetworkManager is managing your interfaces (check with `nmcli device status`), use the nmcli method below. Otherwise use dhcpcd.

**Method A — nmcli (if NetworkManager is active):**

```bash
# Check which connection manages eth1
nmcli connection show

# Modify it (replace 'netplan-eth1' with the actual connection name)
sudo nmcli connection modify netplan-eth1 \
  ipv4.addresses 192.168.100.1/24 \
  ipv4.method manual \
  ipv4.dns "8.8.8.8 1.1.1.1"

sudo nmcli connection up netplan-eth1
```

**Method B — dhcpcd (if using dhcpcd):**

```bash
sudo nano /etc/dhcpcd.conf
```

Add at end:
```conf
interface eth0
static domain_name_servers=8.8.8.8 8.8.4.4

interface eth1
static ip_address=192.168.100.1/24
static domain_name_servers=192.168.100.1
nohook wpa_supplicant
```

```bash
sudo systemctl restart dhcpcd
```

**Verify:**

```bash
ip addr show eth1
# Must show: inet 192.168.100.1/24
```

### Step 5: Enable IP forwarding

```bash
sudo sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf

# Verify
sysctl net.ipv4.ip_forward
# Expected: net.ipv4.ip_forward = 1
```

---

## Part 2 — iptables Firewall

### Step 6: Create the iptables rules script

```bash
sudo mkdir -p /etc/captive-portal
sudo nano /etc/captive-portal/iptables-setup.sh
```

Paste the full script:

```bash
#!/bin/bash

IFACE_WAN='eth0'
IFACE_LAN='eth1'
PORTAL_IP='192.168.100.1'

# ── Flush all rules ───────────────────────────────────────────────────────
iptables -F
iptables -t nat -F
iptables -t mangle -F
iptables -X

# ── Create authorized_clients chain ──────────────────────────────────────
# Per-MAC ACCEPT rules are inserted dynamically by Node.js when a client
# completes the portal flow. Each rule: -m mac --mac-source <MAC> -j ACCEPT
iptables -N authorized_clients

# ── Default policies ──────────────────────────────────────────────────────
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# ── INPUT: loopback + established ─────────────────────────────────────────
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# ── INPUT: services clients need to reach the portal ──────────────────────
iptables -A INPUT -i $IFACE_LAN -p tcp --dport 80   -j ACCEPT   # nginx portal
iptables -A INPUT -i $IFACE_LAN -p tcp --dport 443  -j ACCEPT   # nginx HTTPS
iptables -A INPUT -i $IFACE_LAN -p tcp --dport 3000 -j ACCEPT   # Node.js API
iptables -A INPUT -i $IFACE_LAN -p udp --dport 53   -j ACCEPT   # DNS
iptables -A INPUT -i $IFACE_LAN -p tcp --dport 53   -j ACCEPT   # DNS TCP
iptables -A INPUT -i $IFACE_LAN -p udp --dport 67   -j ACCEPT   # DHCP

# ── INPUT: admin SSH from WAN ─────────────────────────────────────────────
iptables -A INPUT -i $IFACE_WAN -p tcp --dport 22 -j ACCEPT

# ── NAT: masquerade LAN traffic going out to internet ─────────────────────
iptables -t nat -A POSTROUTING -o $IFACE_WAN -j MASQUERADE

# ── FORWARD: allow established/related flows ──────────────────────────────
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

# ── FORWARD: jump to authorized_clients chain ─────────────────────────────
# Authorized MACs get ACCEPT rules inserted at position 1 of this chain.
# Unauthorized MACs fall through to DROP below.
iptables -A FORWARD -i $IFACE_LAN -o $IFACE_WAN -j authorized_clients

# ── FORWARD: block all unauthenticated clients ────────────────────────────
iptables -A FORWARD -i $IFACE_LAN -o $IFACE_WAN -j DROP

# ── NAT PREROUTING: captive portal redirect ───────────────────────────────

# Allow DNS through for everyone (needed to resolve captive.local)
iptables -t nat -A PREROUTING -i $IFACE_LAN -p udp --dport 53 -j RETURN

# Redirect all HTTP to portal
iptables -t nat -A PREROUTING -i $IFACE_LAN -p tcp --dport 80 \
  -j DNAT --to-destination $PORTAL_IP:80

# Redirect HTTPS to portal (iOS probe uses HTTPS)
iptables -t nat -A PREROUTING -i $IFACE_LAN -p tcp --dport 443 \
  -j DNAT --to-destination $PORTAL_IP:443

echo '[OK] iptables rules applied'
```

```bash
sudo chmod +x /etc/captive-portal/iptables-setup.sh
sudo bash /etc/captive-portal/iptables-setup.sh

# Verify FORWARD chain
sudo iptables -L FORWARD -n -v
# Should show: authorized_clients chain jump + DROP

# Verify NAT
sudo iptables -t nat -L PREROUTING -n -v
# Should show: DNS RETURN + HTTP DNAT + HTTPS DNAT
```

### Step 7: Test MAC matching works (critical check)

```bash
sudo iptables -m mac --help 2>&1 | head -3
# Should show: mac match options

# Test insert and delete
sudo iptables -I authorized_clients 1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j ACCEPT
sudo iptables -L authorized_clients -n -v
sudo iptables -D authorized_clients -m mac --mac-source aa:bb:cc:dd:ee:ff -j ACCEPT
```

### Step 8: Persist iptables across reboots

```bash
sudo apt install -y iptables-persistent netfilter-persistent
sudo netfilter-persistent save
sudo systemctl enable netfilter-persistent
```

Create a systemd service to re-run the script on boot (re-creates the chain and rules cleanly):

```bash
sudo nano /etc/systemd/system/captive-portal-fw.service
```

```ini
[Unit]
Description=Captive Portal iptables Rules
After=network.target
Before=dnsmasq.service

[Service]
Type=oneshot
ExecStart=/etc/captive-portal/iptables-setup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable captive-portal-fw
sudo systemctl start captive-portal-fw
sudo systemctl status captive-portal-fw
```

### Step 9: Allow Node.js to run iptables without password

```bash
sudo visudo
```

Add (replace `admin` with the user running your Node.js process):
```
admin ALL=(ALL) NOPASSWD: /sbin/iptables
```

---

## Part 3 — dnsmasq (DHCP + DNS)

### Step 10: Install dnsmasq

```bash
sudo apt install dnsmasq -y
sudo systemctl stop dnsmasq
```

### Step 11: Configure dnsmasq

```bash
sudo nano /etc/dnsmasq.conf
```

Replace entire content:

```conf
# Only serve on LAN interface
interface=eth1
bind-interfaces
except-interface=eth0

# DHCP pool: 192.168.100.50–200, 12 hour leases
dhcp-range=192.168.100.50,192.168.100.200,255.255.255.0,12h

# Tell clients: Pi is the gateway and DNS server
dhcp-option=3,192.168.100.1
dhcp-option=6,192.168.100.1

# Upstream DNS
server=8.8.8.8
server=8.8.4.4

# CAPTIVE PORTAL TRIGGER:
# Redirect ALL DNS queries to Pi — causes pop-up on Android/iOS/Windows
address=/#/192.168.100.1

# Logging
log-queries
log-facility=/var/log/dnsmasq.log
```

```bash
sudo systemctl start dnsmasq
sudo systemctl enable dnsmasq
sudo systemctl status dnsmasq
```

> **How the pop-up works:** `address=/#/192.168.100.1` makes every domain resolve to the Pi.
> The OS sends a connectivity probe (e.g. `connectivitycheck.gstatic.com`), gets the portal
> instead of the expected response, and shows the captive portal notification automatically.
> After `iptables -I authorized_clients` fires, real internet flows — DNS is bypassed by
> the FORWARD rules so the pop-up dismisses itself once the OS probe reaches real Google.

---

## Part 4 — Software Stack

### Step 12: Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # must show v20.x.x
```

### Step 13: Install nginx

```bash
sudo apt install nginx -y
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl enable nginx
```

### Step 14: Install FreeRADIUS + MariaDB

```bash
sudo apt install -y freeradius freeradius-mysql mariadb-server
sudo mysql_secure_installation
# Set root password, remove anonymous users, disallow remote root login
```

**Create RADIUS database:**

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE radius;
CREATE USER 'radius'@'localhost' IDENTIFIED BY 'StrongPassword123!';
GRANT ALL PRIVILEGES ON radius.* TO 'radius'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

```bash
sudo mysql -u root -p radius < /etc/freeradius/3.0/mods-config/sql/main/mysql/schema.sql
```

**Enable FreeRADIUS SQL module:**

```bash
sudo ln -s /etc/freeradius/3.0/mods-available/sql \
           /etc/freeradius/3.0/mods-enabled/sql

sudo nano /etc/freeradius/3.0/mods-enabled/sql
```

Set:
```
driver = 'rlm_sql_mysql'
dialect = 'mysql'
server = 'localhost'
port = 3306
login = 'radius'
password = 'StrongPassword123!'
radius_db = 'radius'
read_clients = yes
```

```bash
sudo nano /etc/freeradius/3.0/sites-enabled/default
```

In `authorize`, `accounting`, and `session` sections — add `sql` after `files`:
```
authorize {
    ...
    files
    sql
    ...
}
accounting {
    ...
    sql
}
session {
    sql
}
```

```bash
sudo chown -R freerad:freerad /etc/freeradius/3.0/mods-enabled/sql

# Test — must show "Ready to process requests"
sudo freeradius -X 2>&1 | tail -5

sudo systemctl start freeradius
sudo systemctl enable freeradius
```

### Step 15: Install PM2

```bash
sudo npm install -g pm2
```

---

## Part 5 — App Deployment

### Step 16: Deploy the app

```bash
sudo mkdir -p /home/admin/apps/captive-portal
sudo chown admin:admin /home/admin/apps/captive-portal

# Copy the app to the Pi (run from your dev machine)
scp -r captive-portal/* admin@192.168.100.1:/home/admin/apps/captive-portal/
```

### Step 17: Configure environment

```bash
cd /home/admin/apps/captive-portal/backend
cp .env.example .env
nano .env
```

Update these values:
```env
ADMIN_TOKEN=your_random_token_here
RADIUS_DB_PASS=StrongPassword123!
CORS_ORIGINS=http://captive.local,http://192.168.100.1
LAN_IFACE=eth1
```

### Step 18: Install backend dependencies

```bash
cd /home/admin/apps/captive-portal/backend
npm install
node src/db/migrate.js   # initialise SQLite DB
```

### Step 19: Install nginx config

```bash
sudo cp /home/admin/apps/captive-portal/captive-portal.nginx \
        /etc/nginx/sites-available/captive-portal

sudo ln -sf /etc/nginx/sites-available/captive-portal \
            /etc/nginx/sites-enabled/captive-portal

sudo nginx -t   # must say OK
sudo systemctl reload nginx
```

### Step 20: Build and deploy React frontend

```bash
# On your dev machine:
cd frontend
npm install
npm run build

# Copy build to Pi:
scp -r dist/* admin@192.168.100.1:/home/admin/apps/captive-portal/frontend/dist/
```

```bash
# On Pi — fix permissions:
sudo chown -R www-data:www-data /home/admin/apps/captive-portal/frontend/dist
```

### Step 21: Build and deploy admin panel

```bash
# On your dev machine:
cd admin
npm install
npm run build

# Copy build to Pi:
scp -r dist/* admin@192.168.100.1:/home/admin/apps/captive-portal/admin/dist/
```

### Step 22: Start with PM2

```bash
cd /home/admin/apps/captive-portal
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable on boot

# Verify running
pm2 status
pm2 logs captive-api --lines 20
```

---

## Part 6 — MikroTik Dumb AP

> ⚠️ Connect laptop directly to MikroTik ether2 before configuring. Do NOT connect to Pi yet.

### Via Terminal / SSH (paste directly)

```
# Optional full reset first
/system reset-configuration no-defaults=yes skip-backup=yes
```

After reconnecting:

```
# Create bridge
/interface bridge add name=bridge-lan

# Add uplink and Wi-Fi to bridge
/interface bridge port add interface=ether1 bridge=bridge-lan
/interface bridge port add interface=wlan1 bridge=bridge-lan

# Management IP (for SSH access via Pi's LAN)
/ip address add address=192.168.100.2/24 interface=bridge-lan

# Configure Wi-Fi
/interface wireless set wlan1 mode=ap-bridge ssid=YourHotspotName \
  band=2ghz-b/g/n disabled=no

# Disable DHCP server
/ip dhcp-server disable [find]

# Disable hotspot
/ip hotspot disable [find]

# Disable firewall (Pi handles this)
/ip firewall filter disable [find]
/ip firewall nat disable [find]
```

### Via Winbox (GUI)

1. **Reset:** System → Reset Configuration → "No Default Configuration" → Reset
2. **Bridge:** Bridge → Add → Name `bridge-lan`
3. **Bridge ports:** Bridge → Ports → Add ether1 and wlan1 to `bridge-lan`
4. **Management IP:** IP → Addresses → Add `192.168.100.2/24` on `bridge-lan`
5. **Wi-Fi:** Wireless → wlan1 → Mode: `ap bridge`, SSID: `YourHotspotName` → Enable
6. **Disable DHCP Server:** IP → DHCP Server → delete all
7. **Disable Hotspot:** IP → Hotspot → Servers → delete all

> ✅ Now connect MikroTik ether1 → Pi eth1 (USB adapter)

---

## Part 7 — Boot Services

### Startup order

| Order | Service | Role |
|---|---|---|
| 1 | `captive-portal-fw` | iptables rules + authorized_clients chain |
| 2 | `dnsmasq` | DHCP + DNS + portal trigger |
| 3 | `mariadb` | FreeRADIUS database |
| 4 | `freeradius` | RADIUS auth server |
| 5 | `nginx` | Serves React portal |
| 6 | PM2 (`captive-api`) | Node.js Express backend |

### Verify all services at once

```bash
sudo systemctl status captive-portal-fw dnsmasq mariadb freeradius nginx
pm2 status
```

---

## Part 8 — Testing

### Test 1: DHCP — does Pi give client an IP?

```bash
# Watch live as a device connects to Wi-Fi
sudo tail -f /var/log/dnsmasq.log
```

Expected:
```
dnsmasq-dhcp: DHCPDISCOVER(eth1) ...
dnsmasq-dhcp: DHCPOFFER(eth1) 192.168.100.50 ...
dnsmasq-dhcp: DHCPACK(eth1) 192.168.100.50 ...
```

### Test 2: Portal pop-up

Connect a phone to the MikroTik Wi-Fi. Within 5–10 seconds the captive portal notification should appear. Tapping it opens your React login page.

### Test 3: ARP lookup works

After a client gets a DHCP lease:

```bash
arp -n
# Should list: 192.168.100.50  ether  aa:bb:cc:dd:ee:ff  C  eth1
```

This is how Node.js resolves the MAC — if ARP is empty, the grant will fail.

### Test 4: Manual grant test

```bash
# Simulate granting a MAC manually
sudo iptables -I authorized_clients 1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j ACCEPT
sudo iptables -t nat -I PREROUTING 1 -i eth1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j RETURN

# Verify
sudo iptables -L authorized_clients -n -v

# Revoke
sudo iptables -D authorized_clients -m mac --mac-source aa:bb:cc:dd:ee:ff -j ACCEPT
sudo iptables -t nat -D PREROUTING -i eth1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j RETURN
```

### Test 5: Full portal flow

```bash
# Monitor PM2 logs while a client goes through the portal
pm2 logs captive-api --lines 0

# After login completes, check authorized_clients chain
sudo iptables -L authorized_clients -n -v
# Client's MAC should appear

# Client should now have internet ✅
```

### Test 6: Internet blocked for unauthenticated client

```bash
# Watch FORWARD DROP counter increase as unauth client tries to browse
watch -n 1 'sudo iptables -L FORWARD -n -v'
# Last rule (DROP) pkts counter should increment
```

---

## Part 9 — Troubleshooting

### No pop-up when connecting to Wi-Fi

```bash
# Check client got Pi as DNS server
# On client: run  nslookup google.com
# Should resolve to 192.168.100.1

# Check dnsmasq is serving on eth1
sudo ss -ulnp | grep 53
# Should show dnsmasq listening on 192.168.100.1:53

# Check DHCP option 6 is set
cat /etc/dnsmasq.conf | grep dhcp-option
```

### Portal page doesn't load

```bash
sudo systemctl status nginx
sudo nginx -t

# Check nginx is listening
sudo ss -tlnp | grep 80

# Test locally
curl -I http://192.168.100.1/
```

### Login succeeds but no internet

```bash
# 1. Check MAC is in authorized_clients chain
sudo iptables -L authorized_clients -n -v

# 2. Check NAT PREROUTING has the MAC RETURN rule
sudo iptables -t nat -L PREROUTING -n -v

# 3. Check NAT MASQUERADE is on eth0
sudo iptables -t nat -L POSTROUTING -n -v
# Should show: MASQUERADE on eth0

# 4. Check IP forwarding is still on
sysctl net.ipv4.ip_forward   # must be 1

# 5. Check PM2 logs for errors
pm2 logs captive-api --lines 50
```

### ARP lookup returns no MAC (grant fails)

```bash
# Client must have traffic pass through Pi for ARP to populate
# Check ARP table
arp -n

# If empty, the client hasn't sent any traffic yet, or eth1 is wrong interface
# Force ARP: ping the client from Pi
ping -c 1 192.168.100.50
arp -n   # should now show the client
```

### MikroTik clients not getting DHCP from Pi

```bash
# Most common cause: MikroTik DHCP server still active
# SSH into MikroTik and verify:
# /ip dhcp-server print   ← must show no active servers

# Also confirm MikroTik bridge is correct:
# /interface bridge port print   ← ether1 and wlan1 must both be in bridge-lan
```

### SSH to Pi locked out after iptables

```bash
# Connect via HDMI + keyboard, or use serial console
# Re-run the script
sudo bash /etc/captive-portal/iptables-setup.sh

# The script includes:
# iptables -A INPUT -i eth0 -p tcp --dport 22 -j ACCEPT
```

### FreeRADIUS won't start

```bash
sudo freeradius -X 2>&1 | tail -20

# Common fix: wrong file ownership
sudo chown -R freerad:freerad /etc/freeradius/3.0/mods-enabled/sql

# Check MySQL connection
mysql -u radius -p radius -e "SELECT COUNT(*) FROM radcheck;"
```

---

## Quick Reference

### IP & port map

| Component | Address / Port |
|---|---|
| Pi WAN (eth0) | DHCP from modem |
| Pi LAN (eth1) | 192.168.100.1/24 |
| DHCP pool | 192.168.100.50 – .200 |
| MikroTik management | 192.168.100.2 |
| nginx (portal) | :80 |
| Node.js API | 127.0.0.1:3000 (proxied by nginx) |
| Admin panel | :8090 (LAN only) |
| FreeRADIUS | 127.0.0.1:1812 UDP |
| MariaDB | 127.0.0.1:3306 |

### Key file locations

| File | Purpose |
|---|---|
| `/etc/captive-portal/iptables-setup.sh` | Full iptables ruleset — re-run after reboot |
| `/etc/dnsmasq.conf` | DHCP + DNS + portal trigger |
| `/etc/nginx/sites-available/captive-portal` | nginx reverse proxy |
| `/home/admin/apps/captive-portal/backend/.env` | App secrets + DB credentials |
| `/home/admin/apps/captive-portal/data/captive.db` | SQLite sessions DB |

### Most-used debug commands

```bash
# All service status
sudo systemctl status captive-portal-fw dnsmasq mariadb freeradius nginx && pm2 status

# Live DHCP log
sudo tail -f /var/log/dnsmasq.log

# Live app log
pm2 logs captive-api --lines 0

# See authorized MACs
sudo iptables -L authorized_clients -n -v

# See NAT rules
sudo iptables -t nat -L PREROUTING -n -v

# ARP table (clients)
arp -n

# DHCP leases
cat /var/lib/misc/dnsmasq.leases

# Watch FORWARD in real time
watch -n 1 'sudo iptables -L FORWARD -n -v'

# Manually grant a MAC
sudo iptables -I authorized_clients 1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j ACCEPT
sudo iptables -t nat -I PREROUTING 1 -i eth1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j RETURN

# Manually revoke a MAC
sudo iptables -D authorized_clients -m mac --mac-source aa:bb:cc:dd:ee:ff -j ACCEPT
sudo iptables -t nat -D PREROUTING -i eth1 -m mac --mac-source aa:bb:cc:dd:ee:ff -j RETURN
```
ENDOFM�