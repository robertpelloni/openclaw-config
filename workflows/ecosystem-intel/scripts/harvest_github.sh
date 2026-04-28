#!/usr/bin/env bash
# harvest_github.sh — Pull latest releases and trending repos for ecosystem-intel.
#
# Appends JSON lines to memory/ecosystem-intel/inbox.jsonl. Idempotent: the
# filter phase dedupes against seen.json, so this script can run as often as
# the configured cadence without risk of duplicate findings.
#
# Requires: gh (authenticated), jq, date.
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/.openclaw/workspace}"
STATE_DIR="$WORKSPACE_ROOT/memory/ecosystem-intel"
INBOX="$STATE_DIR/inbox.jsonl"

mkdir -p "$STATE_DIR/findings" "$STATE_DIR/briefs" "$STATE_DIR/proposals"
touch "$INBOX"

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Releases: repo list comes from rules.md → sources (github_releases kind).
# For now we keep a small hardcoded allowlist; rules.md is the source of truth
# and a future iteration should parse it directly.
REPOS=(
  "openclaw/openclaw"
  "TechNickAI/openclaw-config"
  "anthropics/claude-code"
  "modelcontextprotocol/servers"
  "modelcontextprotocol/python-sdk"
  "openai/openai-agents-python"
  "langchain-ai/langgraph"
)

FAILED_REPOS=()

emit_release() {
  local repo="$1"
  # gh stderr passes through so cron mail captures the actual auth/rate-limit/API error.
  # Pipefail catches gh/jq failures so we can report rather than silently swallow them.
  if ! gh api "repos/$repo/releases?per_page=3" \
    | jq -c --arg repo "$repo" --arg discovered "$(now_iso)" '
        .[] | {
          id: ("gh-release:" + $repo + ":" + .tag_name),
          source_id: ("gh-release:" + $repo),
          kind: "github_release",
          repo: $repo,
          title: (.name // .tag_name),
          url: .html_url,
          published_at: .published_at,
          discovered_at: $discovered
        }
      ' >> "$INBOX"; then
    echo "[ecosystem-intel/harvest_github] WARN: harvest failed for $repo (gh stderr above shows the cause)" >&2
    FAILED_REPOS+=("$repo")
  fi
}

for repo in "${REPOS[@]}"; do
  emit_release "$repo"
done

# Report summary to stderr so cron logs stay readable. Failures first so the issue
# is the first thing visible if the cron-healthcheck workflow scans this output.
if [ "${#FAILED_REPOS[@]}" -gt 0 ]; then
  echo "[ecosystem-intel/harvest_github] WARN: ${#FAILED_REPOS[@]} of ${#REPOS[@]} repos failed: ${FAILED_REPOS[*]}" >&2
fi

total_lines=$(wc -l <"$INBOX" | tr -d ' ')
echo "[ecosystem-intel/harvest_github] wrote to $INBOX ($total_lines total lines)" >&2

# Total failure is a hard error — cron-healthcheck should escalate. Partial failure
# is acceptable (some sources harvested) and exits 0.
if [ "${#FAILED_REPOS[@]}" -eq "${#REPOS[@]}" ]; then
  echo "[ecosystem-intel/harvest_github] FATAL: all repos failed — likely auth, network, or systemic issue" >&2
  exit 1
fi
