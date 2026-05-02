#!/bin/bash
# Restore Tailscale Serve config for the OpenClaw app router on boot.
#
# Tailscale Serve forgets its config across reboots. This script re-applies it
# once tailscaled is responsive. Wire it up via launchd so it runs at login.
#
# Override defaults via env in the launchd plist if needed.

set -euo pipefail

PORT="${APP_ROUTER_PORT:-4242}"
UPSTREAM="${APP_ROUTER_UPSTREAM:-http://127.0.0.1:8080}"
TAILSCALE_BIN="${TAILSCALE_BIN:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}"
MAX_WAIT="${TAILSCALE_MAX_WAIT_SECS:-60}"

if [ ! -x "$TAILSCALE_BIN" ]; then
    # Fall back to PATH-resolved tailscale (Linux, Homebrew on Mac, etc.).
    TAILSCALE_BIN="$(command -v tailscale || true)"
fi

if [ -z "${TAILSCALE_BIN:-}" ]; then
    echo "[app-router-serve] tailscale binary not found" >&2
    exit 1
fi

echo "[app-router-serve] waiting up to ${MAX_WAIT}s for tailscaled"
for ((i = 0; i < MAX_WAIT; i++)); do
    if "$TAILSCALE_BIN" status >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! "$TAILSCALE_BIN" status >/dev/null 2>&1; then
    echo "[app-router-serve] tailscaled never came up; giving up" >&2
    exit 1
fi

echo "[app-router-serve] applying serve: --https=${PORT} → ${UPSTREAM}"
"$TAILSCALE_BIN" serve --bg "--https=${PORT}" "$UPSTREAM"
