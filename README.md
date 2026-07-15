# Krinexa Agri — Final App

ప్రతి రైతుకు నమ్మకమైన తోడు · 5-role agri platform (Farmer, Field Staff, Agronomist, FPO Portal, Krinexa Admin).

## Run it (recommended — with shared data)

**Double-click `start-app.bat`** (needs Node.js, already installed on this PC).

The window shows two links:
- **On this computer:** `http://localhost:8123`
- **On a phone (same Wi-Fi):** `http://<your-pc-ip>:8123` — open it in Chrome → menu → **Add to Home screen** to install it like a native app with the Krinexa icon.

With the server running, **data is shared across all devices**: a farmer who registers on a phone instantly appears in the Admin → Farmer Master and Field Staff lists on the computer; orders, advisory tickets, consent records, products, delivery-charge settings, and the logo sync the same way. Dashboards auto-refresh every 25 seconds. Everything is stored in `krinexa-db.json` next to the app — copy that file to back up your data.

## Logins (real authentication)

**Farmers — OTP login:**
- New farmers register in the app (no password needed; they stay signed in on their phone).
- Returning farmers enter their mobile number → tap **Send OTP** → enter the 6-digit code. The OTP appears in the server window (and, until an SMS gateway is connected, also on screen labelled "demo OTP"). Unregistered numbers are refused.

**Staff — email + password** (default password `Krinexa@123`; every staff member should change it after first login — dashboards have **🔑 Change Password** in the sidebar, Field Staff have the 🔑 button on their home screen):

| Role | Login |
|---|---|
| Krinexa Admin | `admin@krinexa.app` |
| Agronomist | `agro@krinexa.app` |
| FPO Portal | `fpo@krinexa.app` |
| Field Staff | `field@krinexa.app` or `EMP-21` |

Wrong passwords are rejected; passwords are stored only as scrypt hashes (never plain text); actions like updating orders, tickets, products, and settings require a valid login session (30-day sessions).

## Sending real SMS OTPs

Copy `sms-config.example.json` to `sms-config.json`, fill in your gateway details, and restart the server — demo OTPs disappear and farmers receive the code by SMS:

- **MSG91** (most common in India): `{ "provider": "msg91", "authKey": "...", "templateId": "..." }`
- **Any other gateway** via a webhook you control: `{ "provider": "webhook", "url": "https://..." }` — the server POSTs `{mobile, otp, message}` to it.

Until that file exists, the server prints OTPs in its window and shows them on screen as "demo OTP" so testing works without an SMS account.

## Product catalog & shopping (live)

- Admin → Product Mgmt → **Add Product** saves to the server: the product appears at the top of every farmer's shop on every device.
- The farmer cart is real: it holds the actual products the farmer picked, with **quantity controls (＋/−)**, per-item totals, GST, and value-based delivery charges. Orders record every line item, and stock is deducted per product — locally and on the server.

## Employee accounts

Admin → Employee Mgmt → **＋ Add Employee** now creates a real login (email or Employee-ID + password, role selectable: Field Officer / Agronomist / FPO Manager / Admin). Only Admin can create logins; duplicate emails are refused; new staff can sign in immediately and change their password with 🔑.

## Crop photos, reports, and safety

- **Photos:** farmers attach up to 3 real photos (camera or gallery) when asking an expert; images are compressed on the phone and the agronomist sees them on the ticket.
- **Reports:** Admin → Farmer Master and FPO → Reports export real **CSV files (open in Excel)** and **printable PDFs**.
- **Backups:** the server snapshots `krinexa-db.json` into `backups/` on start and every 6 hours (last 20 kept).
- **Protection:** login/OTP endpoints are rate-limited (30 attempts per 10 minutes per device).

## Built for weak rural networks

- **Works fully offline.** The app is a real PWA with a service worker (`sw.js`): once opened, it loads instantly and still opens with no signal. Chart.js is bundled locally (`chart.umd.min.js`) — nothing loads from the internet, so there is no "needs internet on first load" caveat anymore.
- If the connection drops, farmer and staff actions (orders, tickets, updates) are **queued on the device and sent automatically** when the network returns — a toast confirms both.
- Dashboards merge live status changes (e.g. an agronomist's recommendation reaches the farmer's app and the field staff queue within ~25 seconds, on every device).
- **One mobile number = one farmer account** — duplicate registrations are refused, so OTP login is never ambiguous.

## Deploy to the internet (when ready)

The folder is deploy-ready (`package.json` with `npm start`). On [Render](https://render.com) (free tier):
1. Put this folder in a GitHub repo (or use Render's manual deploy).
2. New → **Web Service** → connect the repo → runtime **Node**, start command `node server.js`.
3. Done — you get a public `https://…onrender.com` link that works on any phone anywhere, with the home-screen install.

Note: free tiers wipe local files on redeploy, so `krinexa-db.json` (your data) resets — for a real pilot add Render's persistent disk (paid) mounted at the app folder, or ask to move storage to a hosted database.

## Run it (simple — single device)

Double-click `index.html` — works in any browser, saves data only on that device (localStorage).

For internet access from anywhere (not just home Wi-Fi), upload this folder to any Node host (Render, Railway) with start command `node server.js`, or the static files alone to Netlify/Vercel (single-device mode).

## What's inside

| File | Purpose |
|---|---|
| `index.html` | The complete app (all 5 roles, all screens) |
| `server.js` | Backend server (zero dependencies) — REST API + shared database |
| `start-app.bat` | Double-click launcher for the server |
| `krinexa-db.json` | The database (created automatically on first sync) |
| `manifest.json` | PWA manifest — enables home-screen install |
| `logo.svg` | Krinexa logo (seed + sprout + growth arrow) shown in the top bar and splash screens |
| `icon.svg` | Home-screen install icon (logo on rounded tile) |

**Using your original logo artwork:** the app loads whatever is in `logo.svg`. To use the exact original file instead of this vector recreation, just replace `logo.svg` with your file (keep the name, or export your PNG as `logo.svg`'s replacement and update the two `logo.svg` references in `index.html` to `logo.png`).

## Behaviour by device

- **Phone (≤560px):** Farmer / Field Staff apps run true full-screen — no demo bezel, no fake status bar.
- **Phone dashboards (≤760px):** Agronomist / FPO / Admin get a horizontal scrolling menu bar in place of the sidebar.
- **Desktop:** dashboards run full-width with the dark sidebar; the phone apps show in a centred device frame for demos.
- **Saved data:** language choice, farmer registration, cart orders, addresses, consent log, delivery-charge tiers, and app logo persist across refreshes (localStorage). Clear browser data to reset the demo.

## Notes

- Charts load from the Chart.js CDN, so the first load needs internet.
- All farmer/order/product data is demo data generated in the browser — connecting a real backend (NestJS + Postgres) is the next step when ready.
