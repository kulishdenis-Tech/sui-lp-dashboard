# Home server (Linux) deployment

Everything runs on one always-on Linux box, reached over Tailscale. No Vercel, no GitHub cron, no Edge Function.

## One-time setup
```bash
sudo useradd -m sui-lp   # or edit User= in the units
sudo mkdir -p /opt/sui-lp-dashboard && sudo chown sui-lp /opt/sui-lp-dashboard
git clone https://github.com/kulishdenis-Tech/sui-lp-dashboard /opt/sui-lp-dashboard
cd /opt/sui-lp-dashboard && npm ci
cd sui-lp-tracker && cp .env.example .env   # or create .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WATCH_WALLETS, OKX_*, COINGECKO_API_KEY ...
npm run build
sudo cp deploy/sui-lp-*.service deploy/sui-lp-snapshot.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sui-lp-dashboard.service sui-lp-snapshot.timer
```
The units run as the Linux user `sui-lp` (`User=` in the .service files: change it to your user, and `/opt/sui-lp-dashboard` if you clone elsewhere). The dashboard is then on `http://<tailscale-name>:4173`.

## Update
```bash
cd /opt/sui-lp-dashboard && git pull && npm ci && cd sui-lp-tracker && npm run build
sudo systemctl restart sui-lp-dashboard.service
```

## Check
```bash
systemctl list-timers | grep sui-lp          # next snapshot run
journalctl -u sui-lp-snapshot.service -n 50
cd /opt/sui-lp-dashboard/sui-lp-tracker && npm run snapshot:health   # exit 1 if any wallet is older than 90 min
```
Notifications: edit `sui-lp-snapshot-alert.service` (it runs when a snapshot or the freshness check fails).

## Retire the old scheduler (once)
Run `supabase/portfolio-snapshot-cron-disable.sql` in the Supabase SQL editor, delete the Edge Function
`portfolio-snapshot` and the related vault secrets. The GitHub workflow `Portfolio snapshot` stays as a manual fallback.
