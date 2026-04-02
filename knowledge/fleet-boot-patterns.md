# Fleet Boot Patterns for Multi-Agent Coordination

**Date:** 2026-03-21 **Source:** alpha's research from active multi-gateway setup
(alpha, bravo, charlie) **Status:** Production-ready patterns documented

---

## Overview

This guide covers how to **boot and scale a fleet of independent OpenClaw agents** that
coordinate via Slack @-mentions. It includes architecture patterns, session persistence,
boot runbooks, and troubleshooting.

---

## Architecture Patterns

### Pattern 1: Single-Gateway Multi-Agent (Recommended for Local Teams)

**When to use:** All agents live on the same machine, need sub-second coordination,
shared workspace/auth acceptable.

**Setup:**

```bash
openclaw agents add agent2
openclaw agents add agent3
openclaw gateway start
```

**Session storage:**

```
~/.openclaw/agents/agent1/sessions/
~/.openclaw/agents/agent2/sessions/
~/.openclaw/agents/agent3/sessions/
```

**Inter-agent communication:** Direct via `sessions_send()` (no Slack involved), <10ms
latency.

**Pros:**

- Low latency coordination
- Single process easier to debug
- Shared auth/creds simplify management

**Cons:**

- If gateway crashes, all agents go down
- Shared state dir = potential contention
- Harder to isolate resource limits

---

### Pattern 2: Multi-Gateway Fleet (Current Production Setup)

**When to use:** Agents on different machines/VPS, need fault isolation, independent
teams own separate gateways.

**Setup (per gateway):**

```bash
export OPENCLAW_PROFILE=alpha
export OPENCLAW_STATE_DIR=~/.openclaw-alpha
export OPENCLAW_CONFIG_PATH=~/.openclaw/openclaw-alpha.json
openclaw onboard
openclaw gateway install  # systemd/launchd service
```

**Session storage (distributed):**

```
Gateway 1 (alpha):   ~/.openclaw-alpha/agents/alpha/sessions/
Gateway 2 (bravo): ~/.openclaw-bravo/agents/bravo/sessions/
Gateway 3 (charlie):    ~/.openclaw-charlie/agents/charlie/sessions/
```

**Inter-agent communication:** Via Slack @-mentions (the bus), 1-3s latency per hop.

**Pros:**

- Complete isolation (each gateway independent)
- Resilient (one crash doesn't affect others)
- Independent scaling and updates
- Clear ownership/responsibility per gateway

**Cons:**

- Slack round-trip latency (1-3s)
- Requires Slack channel setup with proper ACLs
- More complex to debug (need logs from multiple hosts)

---

## Fleet Boot Runbook (Multi-Gateway)

### Prerequisites

1. **Three machines** (or three ports on same machine)
2. **Slack workspace** with shared channel `#multi-agent-comms` (or any channel ID)
3. **Three Slack bot tokens** (one per agent, created via Slack app UI)
4. **User account** on all three machines (or one machine with three isolated
   directories)

### Step 1: Create Workspace Directories

```bash
# Host 1 (alpha)
mkdir -p ~/.openclaw-alpha/agents/alpha
mkdir -p ~/.openclaw/workspace-alpha

# Host 2 (bravo)
mkdir -p ~/.openclaw-bravo/agents/bravo
mkdir -p ~/.openclaw/workspace-bravo

# Host 3 (charlie)
mkdir -p ~/.openclaw-charlie/agents/charlie
mkdir -p ~/.openclaw/workspace-charlie
```

### Step 2: Initialize Each Agent's Workspace

```bash
# Host 1: Create alpha's workspace
export OPENCLAW_PROFILE=alpha
export OPENCLAW_STATE_DIR=~/.openclaw-alpha
export OPENCLAW_CONFIG_PATH=~/.openclaw/openclaw-alpha.json

openclaw onboard --workspace ~/.openclaw/workspace-alpha
# This creates AGENTS.md, SOUL.md, USER.md

# Repeat for bravo and charlie with their respective profiles/workspaces
```

### Step 3: Create Config Files (Per Gateway)

**File: `~/.openclaw/openclaw-alpha.json`**

```json
{
  "gateway": {
    "port": 18789
  },
  "agents": {
    "list": [
      {
        "id": "alpha",
        "workspace": "~/.openclaw/workspace-alpha",
        "agentDir": "~/.openclaw-alpha/agents/alpha/agent"
      }
    ]
  },
  "channels": {
    "slack": {
      "accounts": [
        {
          "accountId": "alpha-bot",
          "token": "<SLACK_BOT_TOKEN>"
        }
      ],
      "channels": {
        "<SLACK_CHANNEL_ID>": {
          "allowBots": true,
          "requireMention": true
        }
      }
    }
  },
  "tools": {
    "agentToAgent": {
      "enabled": true
    },
    "sessions": {
      "visibility": "all"
    },
    "loopDetection": {
      "enabled": true,
      "genericRepeat": {
        "windowSize": 3,
        "threshold": 0.8
      }
    }
  },
  "session": {
    "agentToAgent": {
      "maxPingPongTurns": 5
    },
    "maintenance": {
      "mode": "enforce",
      "pruneAfter": "30d",
      "maxEntries": 500
    }
  }
}
```

**Port allocation (spread across hosts):**

```
alpha (Host 1):   18789 (browser: 18791, canvas: 18790)
bravo (Host 2): 18890 (browser: 18892, canvas: 18891)
charlie (Host 3):    18991 (browser: 18993, canvas: 18992)
```

### Step 4: Start Gateway Services

```bash
# Host 1
openclaw --profile alpha gateway install
systemctl --user start openclaw-alpha-gateway

# Host 2
openclaw --profile bravo gateway install
systemctl --user start openclaw-bravo-gateway

# Host 3
openclaw --profile charlie gateway install
systemctl --user start openclaw-charlie-gateway
```

### Step 5: Verify Boot

```bash
# Check each gateway is running
openclaw --profile alpha status
openclaw --profile bravo status
openclaw --profile charlie status

# Each should output: Running: true, Agents: ["alpha"/"bravo"/"charlie"]

# Deep probe (checks Slack connectivity)
openclaw --profile alpha health --json
openclaw --profile bravo health --json
openclaw --profile charlie health --json
```

### Step 6: Test Agent-to-Agent Communication

In Slack channel <SLACK_CHANNEL_ID>:

```
User: @alpha test coordination
alpha: @bravo what's your status?
bravo: @charlie verify system health
charlie: @alpha all systems nominal
alpha: Coordination successful!
```

---

## Session Persistence & Recovery

### Single-Gateway (Multi-Agent)

On restart:

```bash
openclaw gateway restart
```

- Gateway loads `agents.list[]` from config
- Each agent loads its session store: `~/.openclaw/agents/<id>/sessions/`
- Conversation history resumes automatically in main session
- **No data loss** (sessions survive gateway crashes)

### Multi-Gateway Fleet

On restart of Gateway 1 (alpha):

```bash
openclaw --profile alpha gateway restart
```

- **alpha comes back online** in its main session
- **bravo and charlie remain active** on their gateways (no interruption to them)
- Users can @-mention alpha again immediately
- Session history for alpha is restored from local store

**Key insight:** Each agent's session is isolated, so restarting one gateway doesn't
cascade failures.

---

## Loop Detection & Safety

### Why Important

Multi-agent systems can trap themselves in loops:

```
alpha: @bravo, what do you think?
bravo: @alpha, I'm not sure, you decide
alpha: @bravo, let me ask again...
[infinite loop]
```

### OpenClaw's Safeguards (Built-in)

**1. Generic Repeat Detection**

- Detects if an agent repeats the same idea 3+ times
- Injects system message: "You seem to be repeating. Summarize and conclude."

**2. Ping-Pong Limiter**

- Caps alternating two-agent exchanges at 5 turns (default)
- After limit, agents must summarize and resolve

**Config:**

```json
{
  "tools": {
    "loopDetection": {
      "enabled": true,
      "genericRepeat": {
        "windowSize": 3,
        "threshold": 0.8
      }
    }
  },
  "session": {
    "agentToAgent": {
      "maxPingPongTurns": 5
    }
  }
}
```

**Test loop detection:**

```bash
# In Slack: deliberately trigger a loop by having agents ask each other ambiguous questions
# Observe: System injects "you seem to be repeating" message
# Agents should then summarize and move on
```

---

## Troubleshooting

### "Agent B doesn't see Agent A's mentions"

**Check:**

1. `allowBots: true` in channel config
2. Agent B's Slack token has `chat:write` + `reactions:write` permissions
3. `tools.agentToAgent.enabled: true` in both configs
4. Loop detection hasn't prematurely ended the conversation

**Debug:**

```bash
tail -f ~/.openclaw-bravo/logs/openclaw.log | grep -i mention
# Should show: "Received mention: @alpha"
```

### "Slack mentions not matching agent name"

**Check mentionPatterns:**

```json
{
  "agents": {
    "list": [
      {
        "id": "bravo",
        "groupChat": {
          "mentionPatterns": [
            "\\bbravo\\b", // Case-insensitive word boundary
            "\\b@bravo\\b", // With @
            "brav" // Partial match
          ]
        }
      }
    ]
  }
}
```

**Test in Slack:**

```
@bravo test
bravo test
@bravo test
Shell test (if partial enabled)
```

Check logs for which pattern matched.

### "Gateway won't start (port in use)"

```bash
lsof -i :18789
# Kill the process
kill -9 <pid>

# Or use different port:
openclaw --profile alpha gateway --port 18850
```

### "Session history lost on restart"

**Should not happen** if config is correct. Check:

```bash
# Sessions exist?
ls -la ~/.openclaw-alpha/agents/alpha/sessions/
# Should have: sessions.json + *.jsonl transcript files

# Config pointing to correct state dir?
echo $OPENCLAW_STATE_DIR
# Should be: ~/.openclaw-alpha

# Restart gateway
openclaw --profile alpha gateway restart

# Check logs for session load errors
tail -100 ~/.openclaw-alpha/logs/openclaw.log | grep -i session
```

---

## Monitoring & Operations

### Weekly Health Checks

```bash
for profile in alpha bravo charlie; do
  echo "=== $profile ==="
  openclaw --profile $profile health --json | jq '.agents[] | {id, status, lastActivity}'
done
```

### Log Aggregation (Multi-Host)

```bash
# Collect logs from all three hosts to one place for analysis
rsync -av host1:~/.openclaw-alpha/logs/openclaw.log /local/logs/alpha.log
rsync -av host2:~/.openclaw-bravo/logs/openclaw.log /local/logs/bravo.log
rsync -av host3:~/.openclaw-charlie/logs/openclaw.log /local/logs/charlie.log

# Search for errors across all logs
grep -i error /local/logs/*.log
```

### Update Rolling (Zero Downtime)

```bash
# Update Gateway 1 (alpha) while others stay online
openclaw --profile alpha gateway stop
npm install -g @openclaw/gateway@latest  # or git pull + npm install
openclaw --profile alpha gateway start

# Other agents continue unaffected
```

---

## Best Practices

1. **One agent per gateway** in multi-gateway fleets (clean isolation)
2. **@-mentions only for critical coordination** (Slack has 1-3s latency per mention)
3. **Test loop detection before production** (intentionally trigger a loop and verify
   recovery)
4. **Version-pin agent workspaces** (changes to SOUL.md affect behavior)
5. **Use Slack threads** to isolate multi-agent coordination from main channel noise
6. **Monitor ping-pong counts** in logs (high counts = agents struggling to reach
   consensus)
7. **Document fleet topology** in version control (all three `openclaw-*.json` files
   together)
8. **Health-check weekly** with `openclaw health --json` across all profiles

---

## References

- **OpenClaw Multi-Agent Routing:** `concepts/multi-agent.md` in OpenClaw docs
- **Session Management:** `concepts/session.md`
- **Multiple Gateways:** `gateway/multiple-gateways.md`
- **Health Checks:** `gateway/health.md`
- **Active Config Example:** See `templates/multi-agent-slack-bus.json` in this repo

---

**Maintained by:** alpha (Research) **Last Updated:** 2026-03-21 **Status:**
Production-tested ✅
