# FreeRADIUS Setup Guide

Follow these steps on the Raspberry Pi after running `setup.sh`.

## 1. Secure MySQL

```bash
sudo mysql_secure_installation
# Set root password, remove anonymous users, disallow remote root login
```

## 2. FreeRADIUS SQL module — set password

Edit `/etc/freeradius/3.0/mods-available/sql` and find the `mysql` section:

```
sql {
    driver = "rlm_sql_mysql"
    dialect = "mysql"
    server = "localhost"
    port = 3306
    login = "radius"
    password = "YOUR_RADIUS_DB_PASS_HERE"   ← must match backend/.env RADIUS_DB_PASS
    radius_db = "radius"
    ...
}
```

Also set `read_clients = yes` so the clients.conf secret is used.

## 3. Enable SQL in sites-available/default

Edit `/etc/freeradius/3.0/sites-available/default`:

In the `authorize {}` block, add `sql` after `preprocess`:
```
authorize {
    preprocess
    sql
    expiration
    logintime
    pap
}
```

In the `accounting {}` block, add `sql`:
```
accounting {
    detail
    sql
}
```

## 4. Add MikroTik as a RADIUS client

Edit `/etc/freeradius/3.0/clients.conf`, add:

```
client mikrotik {
    ipaddr = 192.168.88.1
    secret = citynet_radius_secret
    shortname = mikrotik
}
```

The secret must match `secret=citynet_radius_secret` in `mikrotik/mikrotik-setup.rsc`.

## 5. Test and start

```bash
# Test in debug mode first
sudo freeradius -X
# Look for: Ready to process requests
# Press Ctrl+C when satisfied

# Enable and start
sudo systemctl enable freeradius
sudo systemctl restart freeradius
sudo systemctl status freeradius
```

## 6. Verify end-to-end

```bash
# Insert a test MAC
mysql -u radius -p radius -e "INSERT INTO radcheck (username, attribute, op, value) VALUES ('AA:BB:CC:DD:EE:FF', 'Cleartext-Password', ':=', 'password');"

# Test RADIUS auth
radtest 'AA:BB:CC:DD:EE:FF' password 127.0.0.1 1812 citynet_radius_secret
# Expected: Access-Accept

# Clean up test entry
mysql -u radius -p radius -e "DELETE FROM radcheck WHERE username='AA:BB:CC:DD:EE:FF';"
```

## 7. Restart the API

```bash
pm2 restart captive-api --update-env
pm2 logs captive-api --lines 20
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| FreeRADIUS won't start | Run `sudo freeradius -X` and check output |
| Access-Reject on radtest | Check username format — must be `XX:XX:XX:XX:XX:XX` uppercase |
| MySQL connection refused | Check RADIUS_DB_PASS matches in both `.env` and FreeRADIUS SQL module |
| Phone still blocked after grant | Check MikroTik `/radius print` — verify address and secret |
| WebView never dismisses | Verify nginx returns 200 for /generate_204 (keeps WebView open until real internet) |
