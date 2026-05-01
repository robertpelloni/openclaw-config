# App Router

A lightweight system for spinning up named web apps on any fleet machine and serving
them at a clean URL — with optional per-app password protection. No cloud required.
Works from a phone.

## What It Does

Every app gets a path like `/my-app/` on a single Tailscale HTTPS URL. A visitor who
hits a password-protected app sees a clean login form asking for a password by the app's
friendly name — not a technical slug. Entering the correct password sets a scoped cookie
that grants access only to that app, not any other.

Under the hood: PM2 keeps all the Node processes alive. Caddy sits in front of them as a
path router and handles the auth challenge via `forward_auth`. A small Express sidecar
(the auth service) issues and validates the session cookies. Tailscale Serve provides
HTTPS with no certificate management.

## First-Time Setup on a New Machine

Install Caddy via Homebrew and PM2 via npm globally. Create `~/openclaw-apps/` as the
working directory for all apps on this machine. Copy the `auth-service/` folder from
this directory into `~/openclaw-apps/auth-service/` and run `npm install` inside it.

Create `~/openclaw-apps/ecosystem.config.js` using the template below. Create
`~/openclaw-apps/_registry/Caddyfile` using the Caddyfile template below. Create
`~/openclaw-apps/_registry/logs/` for log output.

Start everything with `pm2 start ~/openclaw-apps/ecosystem.config.js` then `pm2 save`.
Run `pm2 startup` and execute the sudo command it prints — this makes PM2 survive
reboots via launchd.

Start Caddy under PM2 rather than as a standalone process, so it stays up across
sessions:

```
pm2 start /opt/homebrew/bin/caddy --name caddy --interpreter none -- run --config /Users/<user>/openclaw-apps/_registry/Caddyfile --adapter caddyfile
```

Point Tailscale Serve at Caddy:

```
tailscale serve --bg --https=4242 http://127.0.0.1:8080
```

Tailscale Serve config does not survive reboots on its own. Install the launchd plist
from `devops/app-router/launchd/` (see that file for instructions) to re-apply it
automatically on boot.

Verify everything is working by hitting
`https://<machine>.tailae0f4b.ts.net:4242/health` — it should return `ok`.

## Adding an App

Each app is a process (Node, Python, anything that binds to localhost) and a slot in two
files: `ecosystem.config.js` and the Caddyfile.

**In `ecosystem.config.js`**, add an entry to the `apps` array with the process name,
script path, working directory, and env vars including `PORT`. If the app is
password-protected, also add `APP_PASSWORD_<SLUG>`, `APP_TITLE_<SLUG>`, and
`APP_DESC_<SLUG>` to the auth-service env block. The slug is the app's URL path segment
in uppercase with hyphens replaced by underscores.

**In the Caddyfile**, add a `handle` block for the new path. For open apps, just strip
the prefix and reverse proxy to the port. For password-protected apps, add a
`forward_auth` block pointing to `127.0.0.1:3000/auth/verify?app=<slug>` that redirects
to `/auth/login?app=<slug>` on a 401 response, then strip the prefix and proxy.

After editing both files: run `pm2 restart ecosystem.config.js` (or just
`pm2 restart auth-service` if only passwords changed) and
`caddy reload --config ~/openclaw-apps/_registry/Caddyfile --adapter caddyfile`.

The app is immediately live at `https://<machine>.tailae0f4b.ts.net:4242/<slug>/`.

## Removing an App

Stop and delete the process with `pm2 delete <name>`. Remove its `handle` block from the
Caddyfile and its entry from `ecosystem.config.js`. Remove its password/title/desc env
vars from the auth-service block. Reload Caddy and restart the auth-service. Run
`pm2 save` to persist the updated process list.

## Auth Model

Apps have three auth modes:

**Open** — no password, anyone with the URL can access it. Omit the app from the
auth-service env entirely and use a plain `handle` block in the Caddyfile.

**Password-protected** — a single shared password for the app. Set `APP_PASSWORD_<SLUG>`
in the auth-service env. Anyone who knows the password gets a 7-day cookie scoped to
that app's path only. Knowing one app's password grants no access to any other app.

**No-password configured** — if `APP_PASSWORD_<SLUG>` is absent, the auth service treats
the app as open even if it has a `forward_auth` block. Use this during development.

The auth service signs cookies with an `AUTH_SECRET` env var. If not set, it generates a
random secret on startup — meaning all sessions are invalidated on auth-service restart.
Set a stable secret in production.

## Public Access

Tailscale Serve is tailnet-only. To make an app accessible from outside the tailnet
(sharing with people who aren't on Tailscale), use Tailscale Funnel on a separate port:

```
tailscale funnel --bg --https=4243 http://127.0.0.1:8080
```

All apps on the router become accessible at the funnel URL. Use password protection for
anything sensitive before enabling funnel.

Cloudflare Tunnel is the better option for permanent public URLs with a custom domain.
See `devops/cloudflare-tunnel.md` if that's been set up.

## Fleet Notes

Each machine runs its own independent app router. There is no central router. If an app
needs data from a specific machine, it runs on that machine. The Tailscale hostname
makes it obvious which machine you're hitting.

The auth-service `AUTH_SECRET` should be different per machine — just don't set it and
let it randomize, or generate one with `openssl rand -hex 32` and store it in the
ecosystem config.

Passwords live only in `ecosystem.config.js` on the machine. That file should not be
committed to version control. Add it to `.gitignore`.

## ecosystem.config.js Template

```javascript
module.exports = {
  apps: [
    {
      name: "auth-service",
      script: "./auth-service/server.js",
      cwd: "/Users/<user>/openclaw-apps",
      env: {
        PORT: 3000,
        AUTH_SECRET: "<generate with: openssl rand -hex 32>",
        // Add one set of these per protected app:
        APP_PASSWORD_MY_APP: "the-password",
        APP_TITLE_MY_APP: "My App",
        APP_DESC_MY_APP: "What this app is for",
      },
    },
    {
      name: "my-app",
      script: "./my-app/server.js",
      cwd: "/Users/<user>/openclaw-apps",
      env: { PORT: 3001 },
    },
  ],
};
```

## Caddyfile Template

```
:8080 {

  handle /auth/* {
    reverse_proxy 127.0.0.1:3000
  }

  handle /health {
    respond "ok" 200
  }

  # Open app example
  handle /my-open-app/* {
    uri strip_prefix /my-open-app
    reverse_proxy 127.0.0.1:3001
  }

  # Password-protected app example
  handle /my-private-app/* {
    forward_auth 127.0.0.1:3000 {
      uri /auth/verify?app=my-private-app
      copy_headers Cookie
      @unauthorized status 401
      handle_response @unauthorized {
        redir * /auth/login?app=my-private-app&next={http.request.uri} 302
      }
    }
    uri strip_prefix /my-private-app
    reverse_proxy 127.0.0.1:3002
  }

  handle {
    header Content-Type "text/html; charset=utf-8"
    respond `<html>... your index page ...</html>` 200
  }
}
```

## Port Conventions

Reserve port 3000 for the auth service and 8080 for Caddy. Apps start at 3001 and
increment. Keep a comment in your ecosystem.config.js noting which port each app uses to
avoid collisions.
