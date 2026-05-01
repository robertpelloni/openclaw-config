/**
 * OpenClaw Auth Sidecar
 *
 * Provides per-app cookie-based password auth.
 * Caddy uses forward_auth to check this service before proxying requests.
 *
 * Flow:
 *   1. Caddy sends GET /auth/verify?app=<slug> with request cookies
 *   2. If valid session cookie → 200 OK (Caddy proxies the request)
 *   3. If not → 401 (Caddy redirects to login page)
 *   4. Login form at /auth/login?app=<slug>&next=<original-url>
 *   5. POST /auth/login validates password, sets cookie, redirects back
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

// Per-app passwords — set via env vars: APP_PASSWORD_<SLUG_UPPERCASE>
// e.g. APP_PASSWORD_PRIVATE_DASHBOARD=mysecret
function getAppPassword(slug) {
  const key = `APP_PASSWORD_${slug.toUpperCase().replace(/-/g, '_')}`;
  return process.env[key] || null;
}

function getAppTitle(slug) {
  const key = `APP_TITLE_${slug.toUpperCase().replace(/-/g, '_')}`;
  return process.env[key] || slug;
}

function getAppDesc(slug) {
  const key = `APP_DESC_${slug.toUpperCase().replace(/-/g, '_')}`;
  return process.env[key] || '';
}

// Apps that require no auth
const NO_AUTH_APPS = (process.env.NO_AUTH_APPS || '').split(',').filter(Boolean);

function makeSessionToken(slug, password) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${slug}:${password}`)
    .digest('hex');
}

function cookieName(slug) {
  return `oc_auth_${slug.replace(/-/g, '_')}`;
}

app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// ── Verify endpoint (called by Caddy forward_auth) ──────────────────────────
app.get('/auth/verify', (req, res) => {
  const slug = req.query.app;
  if (!slug) return res.status(400).send('missing app');

  // No auth required for this app
  if (NO_AUTH_APPS.includes(slug)) return res.status(200).send('ok');

  const password = getAppPassword(slug);
  if (!password) return res.status(200).send('ok'); // no password configured = open

  const token = req.cookies[cookieName(slug)];
  const expected = makeSessionToken(slug, password);

  if (token === expected) {
    res.status(200).send('ok');
  } else {
    res.status(401).send('unauthorized');
  }
});

// ── Login page (GET) ─────────────────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const { app: slug, next: nextUrl = `/${slug}/` } = req.query;
  const error = req.query.error;
  const title = getAppTitle(slug);
  const desc = getAppDesc(slug);

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Access ${slug || 'App'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 2px 20px rgba(0,0,0,0.08);
    }
    .icon { font-size: 32px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 28px; }
    .slug { color: #0ea5e9; font-weight: 500; }
    label { display: block; font-size: 13px; font-weight: 500; color: #444; margin-bottom: 6px; }
    input[type=password] {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type=password]:focus { border-color: #0ea5e9; }
    .error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #dc2626;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    button {
      width: 100%;
      margin-top: 16px;
      padding: 13px;
      background: #0ea5e9;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #0284c7; }
    .footer { margin-top: 24px; font-size: 12px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔐</div>
    <h1>${title}</h1>
    <p class="subtitle">${desc ? desc + '<br>' : ''}Enter the password to continue.</p>
    ${error ? '<div class="error">Incorrect password. Try again.</div>' : ''}
    <form method="POST" action="/auth/login">
      <input type="hidden" name="app" value="${slug}">
      <input type="hidden" name="next" value="${nextUrl}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus placeholder="••••••••">
      <button type="submit">Continue →</button>
    </form>
    <div class="footer">🐾 OpenClaw App Router</div>
  </div>
</body>
</html>`);
});

// ── Login submit (POST) ──────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { app: slug, next: nextUrl = `/${slug}/`, password } = req.body;
  const correctPassword = getAppPassword(slug);

  if (!correctPassword || password === correctPassword) {
    // Set scoped session cookie (7-day expiry)
    const token = makeSessionToken(slug, correctPassword || '');
    res.cookie(cookieName(slug), token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: `/${slug}/`,
    });
    return res.redirect(nextUrl);
  }

  // Wrong password
  res.redirect(`/auth/login?app=${slug}&next=${encodeURIComponent(nextUrl)}&error=1`);
});

// ── Logout ───────────────────────────────────────────────────────────────────
app.get('/auth/logout', (req, res) => {
  const slug = req.query.app;
  if (slug) res.clearCookie(cookieName(slug), { path: `/${slug}/` });
  res.send('Logged out. <a href="/">Home</a>');
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[auth-service] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[auth-service] Registered apps: ${Object.keys(process.env).filter(k => k.startsWith('APP_PASSWORD_')).join(', ')}`);
});
