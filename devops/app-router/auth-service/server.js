/**
 * OpenClaw App Router — Auth Sidecar
 *
 * Per-app cookie-based password auth. Caddy uses `forward_auth` to consult this
 * service before proxying requests for protected paths.
 *
 * Flow:
 *   1. Caddy → GET /auth/verify?app=<slug> with the request's cookies attached
 *   2. Cookie valid → 200 (Caddy proxies the request through to the app)
 *   3. Cookie missing/invalid → 401 (Caddy redirects to /auth/login?app=<slug>&next=…)
 *   4. POST /auth/login validates the password, sets a path-scoped cookie,
 *      and redirects back to `next` (validated to stay within /<slug>/).
 *
 * Per-app config comes from env vars:
 *   APP_PASSWORD_<SLUG>   — required to enable auth for an app
 *   APP_TITLE_<SLUG>      — friendly name shown on the login form
 *   APP_DESC_<SLUG>       — optional one-liner shown under the title
 *
 * <SLUG> is the app's URL segment, uppercased with '-' replaced by '_'.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Slugs become cookie names, env-var keys, and parts of redirect URLs. Lock the
// alphabet down so a hostile query string can't escape into any of those.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const NO_AUTH_APPS = new Set(
  (process.env.NO_AUTH_APPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const isValidSlug = (slug) => typeof slug === "string" && SLUG_RE.test(slug);

const envFor = (prefix, slug) =>
  process.env[`${prefix}_${slug.toUpperCase().replace(/-/g, "_")}`];

const getAppPassword = (slug) => envFor("APP_PASSWORD", slug) || null;
const getAppTitle = (slug) => envFor("APP_TITLE", slug) || slug;
const getAppDesc = (slug) => envFor("APP_DESC", slug) || "";

const cookieName = (slug) => `oc_auth_${slug.replace(/-/g, "_")}`;

const makeSessionToken = (slug, password) =>
  crypto.createHmac("sha256", SECRET).update(`${slug}:${password}`).digest("hex");

// Constant-time compare; returns false if lengths differ instead of throwing.
const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

// Only allow redirects that stay within the app's own path. Anything else
// (absolute URLs, protocol-relative URLs, paths into other apps) collapses to
// the app root.
const safeNext = (slug, next) => {
  const fallback = `/${slug}/`;
  if (typeof next !== "string" || !next.startsWith(fallback)) return fallback;
  // Reject scheme-relative URLs like "//evil.com/path" that happen to pass the
  // prefix test if slug were ever permissive (belt-and-suspenders given SLUG_RE).
  if (next.startsWith("//")) return fallback;
  return next;
};

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const renderLoginPage = ({ slug, title, desc, nextUrl, error }) => {
  const safeSlug = escapeHtml(slug);
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(desc);
  const safeNextUrl = escapeHtml(nextUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Access ${safeTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
      box-shadow: 0 2px 20px rgba(0, 0, 0, 0.08);
    }
    .icon { font-size: 32px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 28px; }
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
    <h1>${safeTitle}</h1>
    <p class="subtitle">${safeDesc ? safeDesc + "<br>" : ""}Enter the password to continue.</p>
    ${error ? '<div class="error">Incorrect password. Try again.</div>' : ""}
    <form method="POST" action="/auth/login">
      <input type="hidden" name="app" value="${safeSlug}">
      <input type="hidden" name="next" value="${safeNextUrl}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus placeholder="••••••••">
      <button type="submit">Continue →</button>
    </form>
    <div class="footer">🐾 OpenClaw App Router</div>
  </div>
</body>
</html>`;
};

const buildApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));

  // Caddy hits this for every protected request.
  app.get("/auth/verify", (req, res) => {
    const slug = req.query.app;
    if (!isValidSlug(slug)) return res.status(400).send("invalid app");

    if (NO_AUTH_APPS.has(slug)) return res.status(200).send("ok");

    const password = getAppPassword(slug);
    // No password configured = app is open. Caddy still calls verify because
    // the operator wired up forward_auth, but we let it through.
    if (!password) return res.status(200).send("ok");

    const token = req.cookies[cookieName(slug)];
    const expected = makeSessionToken(slug, password);
    return safeEqual(token, expected)
      ? res.status(200).send("ok")
      : res.status(401).send("unauthorized");
  });

  app.get("/auth/login", (req, res) => {
    const slug = req.query.app;
    if (!isValidSlug(slug)) return res.status(400).send("invalid app");
    const nextUrl = safeNext(slug, req.query.next);
    res
      .status(200)
      .type("html")
      .send(
        renderLoginPage({
          slug,
          title: getAppTitle(slug),
          desc: getAppDesc(slug),
          nextUrl,
          error: req.query.error === "1",
        })
      );
  });

  app.post("/auth/login", (req, res) => {
    const slug = req.body.app;
    if (!isValidSlug(slug)) return res.status(400).send("invalid app");

    const nextUrl = safeNext(slug, req.body.next);
    const submitted = typeof req.body.password === "string" ? req.body.password : "";
    const correct = getAppPassword(slug);

    // Only auth-protected apps land here in practice; if a slug has no password
    // configured we treat the submission as accepted (mirrors verify behavior).
    if (!correct || safeEqual(submitted, correct)) {
      const token = makeSessionToken(slug, correct || "");
      res.cookie(cookieName(slug), token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: SESSION_TTL_MS,
        path: `/${slug}/`,
      });
      return res.redirect(303, nextUrl);
    }

    return res.redirect(
      303,
      `/auth/login?app=${encodeURIComponent(slug)}&next=${encodeURIComponent(nextUrl)}&error=1`
    );
  });

  app.get("/auth/logout", (req, res) => {
    const slug = req.query.app;
    if (isValidSlug(slug)) res.clearCookie(cookieName(slug), { path: `/${slug}/` });
    res.status(200).type("html").send("Logged out. <a href=\"/\">Home</a>");
  });

  return app;
};

module.exports = {
  buildApp,
  // Exported for tests; not part of the HTTP surface.
  _internals: {
    isValidSlug,
    safeNext,
    escapeHtml,
    safeEqual,
    cookieName,
    makeSessionToken,
  },
};

if (require.main === module) {
  const app = buildApp();
  app.listen(PORT, "127.0.0.1", () => {
    const registered = Object.keys(process.env)
      .filter((k) => k.startsWith("APP_PASSWORD_"))
      .map((k) => k.slice("APP_PASSWORD_".length).toLowerCase().replace(/_/g, "-"))
      .sort();
    console.log(`[auth-service] listening on http://127.0.0.1:${PORT}`);
    console.log(`[auth-service] protected apps: ${registered.join(", ") || "(none)"}`);
    if (!process.env.AUTH_SECRET) {
      console.warn("[auth-service] WARNING: AUTH_SECRET not set — sessions reset on restart");
    }
  });
}
