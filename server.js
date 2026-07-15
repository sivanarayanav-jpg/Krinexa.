/*
 * Krinexa Agri — zero-dependency backend (Node.js built-ins only).
 * Static app + REST API + real authentication + shared JSON database.
 *
 *   node server.js          → http://localhost:8123
 *
 * Database file: krinexa-db.json (auto-created next to this file).
 * Passwords are stored as scrypt hashes — never in plain text.
 * Farmer OTPs are printed in THIS window; until an SMS gateway is
 * connected (SMS_CONNECTED=true) they are also returned to the app
 * so the demo works end-to-end.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'krinexa-db.json');
const PORT = process.env.PORT || 8123;
const SESSION_DAYS = 30;
const DEFAULT_PASSWORD = 'Krinexa@123';

/*
 * SMS gateway (optional). Create sms-config.json next to this file to send
 * real SMS OTPs — see sms-config.example.json. While that file is absent,
 * the app runs in demo mode: OTPs print here and show on screen.
 */
let SMS = null;
try { SMS = JSON.parse(fs.readFileSync(path.join(ROOT, 'sms-config.json'), 'utf8')); } catch (e) {}
const SMS_CONNECTED = !!(SMS && SMS.provider);
function sendSms(mobile, otp) {
  if (!SMS_CONNECTED) return;
  try {
    const msg = 'Your Krinexa Agri OTP is ' + otp + '. Valid for 5 minutes.';
    if (SMS.provider === 'msg91') {
      const https = require('https');
      const q = 'authkey=' + encodeURIComponent(SMS.authKey) + '&mobile=91' + digits(mobile) + '&otp=' + otp +
        (SMS.templateId ? '&template_id=' + encodeURIComponent(SMS.templateId) : '');
      https.get('https://control.msg91.com/api/v5/otp?' + q, r => r.resume()).on('error', () => {});
    } else if (SMS.provider === 'webhook' && SMS.url) {
      const mod = require(SMS.url.startsWith('https') ? 'https' : 'http');
      const req2 = mod.request(SMS.url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => r.resume());
      req2.on('error', () => {});
      req2.end(JSON.stringify({ mobile: digits(mobile), otp: otp, message: msg }));
    }
  } catch (e) {}
}

let db = { farmers: [], orders: [], tickets: [], consents: [], products: [], config: null, users: [], sessions: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}

const otps = {}; // in-memory only: { mobileDigits: {code, exp, tries} }

/* ---------- password + session helpers ---------- */
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function newUser(email, role, name, empId) {
  const salt = crypto.randomBytes(12).toString('hex');
  return { email, role, name, empId: empId || '', salt, hash: hashPw(DEFAULT_PASSWORD, salt) };
}
if (!db.users || !db.users.length) {
  db.users = [
    newUser('admin@krinexa.app', 'admin', 'Krinexa Admin'),
    newUser('agro@krinexa.app', 'agronomist', 'Dr. Anitha'),
    newUser('fpo@krinexa.app', 'fpo', 'Sri Annadata FPC Manager'),
    newUser('field@krinexa.app', 'field', 'Saritha (Field Officer)', 'EMP-21')
  ];
}
if (!db.sessions) db.sessions = {};
function makeSession(info) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = Object.assign({ exp: Date.now() + SESSION_DAYS * 864e5 }, info);
  persist();
  return token;
}
function getSession(req) {
  const t = req.headers['x-auth'];
  const s = t && db.sessions[t];
  if (!s) return null;
  if (s.exp < Date.now()) { delete db.sessions[t]; persist(); return null; }
  return s;
}
function pruneSessions() {
  const now = Date.now();
  for (const t in db.sessions) if (db.sessions[t].exp < now) delete db.sessions[t];
}
pruneSessions();

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db, null, 1), () => {}), 200);
}
persist(); // write seeded users on first run

/* automatic database backups: on start + every 6 hours, keep the last 20 */
const BAK_DIR = path.join(ROOT, 'backups');
function backup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    fs.mkdirSync(BAK_DIR, { recursive: true });
    const name = 'db-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16) + '.json';
    fs.copyFileSync(DB_FILE, path.join(BAK_DIR, name));
    const files = fs.readdirSync(BAK_DIR).filter(f => f.startsWith('db-')).sort();
    while (files.length > 20) fs.unlinkSync(path.join(BAK_DIR, files.shift()));
  } catch (e) {}
}
setTimeout(backup, 3000);
setInterval(backup, 6 * 3600e3);

/* basic brute-force protection on auth endpoints: 30 attempts / 10 min per IP */
const rateMap = {};
function rateLimited(req) {
  const ip = req.socket.remoteAddress || '?';
  const now = Date.now();
  const r = rateMap[ip] || (rateMap[ip] = { n: 0, t: now });
  if (now - r.t > 600e3) { r.n = 0; r.t = now; }
  return ++r.n > 30;
}

const digits = s => String(s || '').replace(/\D/g, '');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon'
};
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  /* ---------- REST API ---------- */
  if (p.startsWith('/api/')) {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let data = null;
      try { data = body ? JSON.parse(body) : null; } catch (e) {}
      const session = getSession(req);

      if (p.startsWith('/api/auth/') && rateLimited(req)) return send(res, 429, { ok: false, error: 'too_many_requests' });

      /* --- public: shared data (users/sessions never leave the server) --- */
      if (req.method === 'GET' && p === '/api/db') {
        return send(res, 200, {
          farmers: db.farmers, orders: db.orders, tickets: db.tickets,
          consents: db.consents, products: db.products, config: db.config
        });
      }

      /* --- auth: farmer OTP --- */
      if (req.method === 'POST' && p === '/api/auth/otp' && data) {
        const mob = digits(data.mobile);
        if (mob.length < 10) return send(res, 200, { ok: false, error: 'bad_mobile' });
        const farmer = db.farmers.find(f => digits(f.mobile) === mob);
        if (!farmer) return send(res, 200, { ok: false, error: 'not_registered' });
        const code = String(crypto.randomInt(100000, 999999));
        otps[mob] = { code, exp: Date.now() + 5 * 60e3, tries: 0 };
        console.log('\n  ================================');
        console.log('  OTP for ' + data.mobile + '  →  ' + code);
        console.log('  ================================\n');
        sendSms(data.mobile, code);
        return send(res, 200, { ok: true, demo_otp: SMS_CONNECTED ? undefined : code });
      }
      if (req.method === 'POST' && p === '/api/auth/verify' && data) {
        const mob = digits(data.mobile), rec = otps[mob];
        if (!rec || rec.exp < Date.now()) return send(res, 200, { ok: false, error: 'expired' });
        if (++rec.tries > 5) { delete otps[mob]; return send(res, 200, { ok: false, error: 'too_many_tries' }); }
        if (String(data.otp).trim() !== rec.code) return send(res, 200, { ok: false, error: 'wrong_otp' });
        delete otps[mob];
        const farmer = db.farmers.find(f => digits(f.mobile) === mob);
        const token = makeSession({ role: 'farmer', mobile: mob, farmerId: farmer ? farmer.id : '' });
        return send(res, 200, { ok: true, token, farmer });
      }

      /* --- auth: staff/admin/fpo/agronomist email+password --- */
      if (req.method === 'POST' && p === '/api/auth/login' && data) {
        const who = String(data.user || '').trim().toLowerCase();
        const u = db.users.find(x => x.email.toLowerCase() === who || (x.empId && x.empId.toLowerCase() === who));
        const ok = u && hashPw(data.password || '', u.salt) === u.hash;
        if (!ok) return send(res, 200, { ok: false, error: 'invalid_credentials' });
        const token = makeSession({ role: u.role, email: u.email });
        return send(res, 200, { ok: true, token, user: { name: u.name, role: u.role, email: u.email } });
      }
      if (req.method === 'POST' && p === '/api/auth/logout') {
        const t = req.headers['x-auth'];
        if (t && db.sessions[t]) { delete db.sessions[t]; persist(); }
        return send(res, 200, { ok: true });
      }

      /* --- farmer self-service writes (signup creates the account + session) --- */
      if (req.method === 'POST' && data) {
        const coll = { '/api/farmers': 'farmers', '/api/orders': 'orders', '/api/tickets': 'tickets', '/api/consents': 'consents' }[p];
        if (coll) {
          data.createdAt = new Date().toISOString();
          if (data.id && db[coll].some(x => x.id === data.id)) return send(res, 200, { ok: true, dup: true });
          /* one mobile number = one farmer account (keeps OTP login unambiguous) */
          if (coll === 'farmers') {
            const mob = digits(data.mobile);
            if (mob.length < 10) return send(res, 200, { ok: false, error: 'bad_mobile' });
            if (db.farmers.some(f => digits(f.mobile) === mob)) return send(res, 200, { ok: false, error: 'mobile_exists' });
          }
          db[coll].unshift(data);
          /* order → auto-deduct product stock (multi-item carts supported) */
          if (coll === 'orders') {
            const items = Array.isArray(data.lineItems) ? data.lineItems
              : (data.productId ? [{ productId: data.productId, qty: data.qty || 1 }] : []);
            items.forEach(it => {
              const pr = db.products.find(x => x.id === it.productId);
              if (pr) pr.stk = Math.max(0, (pr.stk || 0) - (it.qty || 1));
            });
          }
          persist();
          if (coll === 'farmers') {
            const token = makeSession({ role: 'farmer', mobile: digits(data.mobile), farmerId: data.id });
            return send(res, 200, { ok: true, token });
          }
          return send(res, 200, { ok: true });
        }
      }

      /* --- everything below needs a valid login --- */
      if (!session) return send(res, 401, { ok: false, error: 'login_required' });

      if (req.method === 'POST' && p === '/api/auth/change-password' && data) {
        if (session.role === 'farmer') return send(res, 200, { ok: false, error: 'not_staff' });
        const u = db.users.find(x => x.email === session.email);
        if (!u || hashPw(data.oldPassword || '', u.salt) !== u.hash) return send(res, 200, { ok: false, error: 'wrong_password' });
        if (!data.newPassword || String(data.newPassword).length < 8) return send(res, 200, { ok: false, error: 'too_short' });
        u.salt = crypto.randomBytes(12).toString('hex');
        u.hash = hashPw(data.newPassword, u.salt);
        persist();
        return send(res, 200, { ok: true });
      }

      /* --- admin creates real staff logins from Employee Mgmt --- */
      if (req.method === 'POST' && p === '/api/users' && data) {
        if (session.role !== 'admin') return send(res, 403, { ok: false, error: 'admin_only' });
        const email = String(data.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return send(res, 200, { ok: false, error: 'bad_email' });
        if (!data.password || String(data.password).length < 8) return send(res, 200, { ok: false, error: 'password_too_short' });
        if (db.users.some(u => u.email.toLowerCase() === email)) return send(res, 200, { ok: false, error: 'exists' });
        const salt = crypto.randomBytes(12).toString('hex');
        db.users.push({ email, role: data.role || 'field', name: data.name || email, empId: data.empId || '', salt, hash: hashPw(data.password, salt) });
        persist();
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/products' && data) {
        data.createdAt = new Date().toISOString();
        if (data.id && db.products.some(x => x.id === data.id)) return send(res, 200, { ok: true, dup: true });
        db.products.unshift(data); persist();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PUT' && p === '/api/config' && data) {
        db.config = data; persist();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PATCH' && (p.startsWith('/api/orders/') || p.startsWith('/api/tickets/') || p.startsWith('/api/products/'))) {
        const coll = p.split('/')[2];
        const id = p.slice(p.lastIndexOf('/') + 1);
        const item = db[coll].find(x => x.id === id);
        if (item) {
          /* cancelling an order puts its stock back (once) */
          if (coll === 'orders' && data && data.status === 'Cancelled' && item.status !== 'Cancelled') {
            (Array.isArray(item.lineItems) ? item.lineItems : []).forEach(it => {
              const pr = db.products.find(x => x.id === it.productId);
              if (pr) pr.stk = (pr.stk || 0) + (it.qty || 1);
            });
          }
          Object.assign(item, data || {});
          persist();
        }
        return send(res, 200, { ok: !!item });
      }

      return send(res, 404, { error: 'not found' });
    });
    return;
  }

  /* ---------- Static files ---------- */
  let file = p === '/' ? '/index.html' : p;
  if (file === '/krinexa-db.json') { res.writeHead(403); return res.end('Forbidden'); }
  const fp = path.join(ROOT, path.normalize(file));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Krinexa Agri server is running');
  console.log('  ------------------------------');
  console.log('  On this computer :  http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log('  On a phone (same Wi-Fi):  http://' + i.address + ':' + PORT));
  console.log('');
  console.log('  Staff logins (default password: ' + DEFAULT_PASSWORD + ')');
  db.users.forEach(u => console.log('    ' + u.role.padEnd(11) + ' ' + u.email + (u.empId ? '  (or ' + u.empId + ')' : '')));
  console.log('');
  console.log('  Farmer login: OTPs appear in this window when requested.');
  console.log('  Database file: ' + DB_FILE);
  console.log('  Press Ctrl+C to stop.');
});
