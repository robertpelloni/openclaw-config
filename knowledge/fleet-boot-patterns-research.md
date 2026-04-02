# Fleet Boot Patterns & Session Persistence

_Research compiled from OpenClaw documentation on bootstrapping, session management, and
multi-agent fleet coordination._

Date: 2026-03-21 Context: Multi-agent communication setup + fleet deployment patterns

---

## 1. Bootstrapping Ritual (Agent Initialization)

### What Happens on First Run

When an agent starts for the first time, OpenClaw bootstraps the workspace:

1. **Seeds identity files:**
   - `AGENTS.md` — Universal operating principles (synced from master config)
   - `BOOTSTRAP.md` — First-run Q&A ritual (deleted when complete)
   - `IDENTITY.md` — Agent's core identity/persona
   - `USER.md` — Profile of the human being served

2. **Q&A ritual** — One question at a time, interactive setup
3. **Writes identity** — Results go to `IDENTITY.md`, `USER.md`, `SOUL.md`
4. **One-shot cleanup** — `BOOTSTRAP.md` is deleted; won't run again

### Where Bootstrapping Runs

- **Always on the gateway host** (the master OpenClaw service)
- If the macOS app connects to a remote gateway, workspace files live **on the remote
  machine**
- Multi-gateway setups: Each gateway owns its own workspace and agent stores

**Implication for fleets:** Bootstrapping is **gateway-local**. A fleet with 3 gateways
means 3 separate bootstrap rituals, 3 separate workspaces. No shared bootstrap state
across gateways.

---

## 2. Session Management & Persistence

### Session Ownership

- **Gateway is the source of truth** for all session state
- Session store file: `~/.openclaw/agents/<agentId>/sessions/sessions.json` (per agent,
  per gateway)
- Transcripts: `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`
- UI clients (macOS app, WebChat) query the gateway; they don't own session state

### Session Types & Keys

**Direct chat sessions:**

- Default key: `agent:<agentId>:<mainKey>` (all DMs collapse to one continuous context)
- Configurable via `session.dmScope`:
  - `main` (default): All direct messages share one session = continuity across
    devices/channels
  - `per-peer`: `agent:<agentId>:direct:<peerId>` — isolate per person
  - `per-channel-peer`: isolate per channel + person (good for shared inboxes)
  - `per-account-channel-peer`: isolate by account + channel + person (for multi-account
    inboxes)

**Group/channel sessions:**

- Format: `agent:<agentId>:<channel>:group:<id>` or
  `agent:<agentId>:<channel>:channel:<id>`
- Telegram forum topics append `:topic:<threadId>` for thread isolation

**Special sources:**

- Cron jobs: `cron:<job.id>`
- Webhooks: `hook:<uuid>`
- Node runs: `node-<nodeId>`

### Session Reset & Lifecycle

**Daily reset (default):**

- 4:00 AM local time on gateway host
- Sessions created before the last reset time are marked stale
- Next inbound message triggers a fresh `sessionId` and greeting

**Idle reset (optional):**

- Add `session.idleMinutes` to force reset after N minutes of inactivity
- If both daily + idle are set, **whichever expires first wins**

**Manual reset:**

- Send `/new` or `/reset` in chat to force a fresh session
- `/new <model>` can also switch the model for that session

**Implications for persistence:**

- Sessions are **not** truly "persistent" in the forever sense
- They reset daily by default OR when idle
- For a multi-agent fleet, each agent/gateway pair maintains its own session life cycle
- Long-running bot tasks should use **cron jobs** or **sub-agent spawns** instead of
  relying on session continuity

### Session Maintenance (Garbage Collection)

OpenClaw auto-cleans old sessions to keep stores bounded:

```json
{
  "session": {
    "maintenance": {
      "mode": "warn|enforce", // "warn" = report, "enforce" = apply cleanup
      "pruneAfter": "30d", // Remove entries older than 30 days
      "maxEntries": "500", // Cap store at 500 sessions
      "rotateBytes": "10mb", // Rotate sessions.json at 10 MB
      "maxDiskBytes": null, // Optional: total disk budget
      "highWaterBytes": "80%" // Evict when above 80% of budget
    }
  }
}
```

**Fleet note:** Each gateway's maintenance runs independently. Cleanup policy should be
consistent across fleet members.

---

## 3. Multi-Agent Coordination (Fleet Patterns)

### Communication Between Agents

**Same Gateway (within one server):**

- Use `sessions_send()` tool to inject messages directly into another agent's session
- No Slack/Discord required; invisible backend coordination

**Across Gateways (distributed fleet):**

- `sessions_send()` is **not available** (different server instances)
- Fall back to **explicit Slack @-mentions** as the coordination bus
- Each agent listens on the shared channel and responds to @-mentions
- Loop detection + ping-pong guards prevent infinite back-and-forth

**Mention patterns for humans → agents:**

- Set `agents.list[].groupChat.mentionPatterns: ["\\b<name>\\b"]`
- Allows natural speech: "Hey alpha, what do you think?" or explicit @alpha

**Mention patterns for agents → agents:**

- **Agent-to-agent MUST use actual @-mentions** (not just mentionPatterns)
- Slack's `allowBots: true` + `requireMention: false` = death spiral (agents reply to
  everything)
- Fix: `requireMention: true` for channels with multiple agents

---

## 4. Session Binding & Subagent Coordination

From the Session Binding Channel Agnostic Plan:

### Core Binding Concept

When a **sub-agent spawn** completes, the completion event needs to be **routed back**
to the right conversation. Session bindings track this mapping:

```typescript
export type SessionBindingRecord = {
  bindingId: string;
  targetSessionKey: string; // e.g., "agent:main:telegram:direct:123"
  targetKind: "subagent|session";
  conversation: ConversationRef; // channel, accountId, conversationId, parentId
  status: "active|ending|ended";
  boundAt: number;
  expiresAt?: number; // TTL for binding lifetime
  metadata?: {};
};
```

### Why This Matters for Fleets

1. **Discord thread mode** (iteration 1 implementation):
   - When a sub-agent spawns in response to a Discord message, it can bind to a thread
   - Completion is delivered back to that thread, not the main channel
   - Prevents duplicate deliveries, keeps context organized

2. **Future ACP expansion:**
   - Bindings can target ACP harness sessions (deferred from iteration 1)
   - Allows sub-agent spawns to bind to specific chat threads/conversations
   - Multi-gateway coordination becomes possible via bindings

3. **Cross-gateway routing (future):**
   - If gateways can query each other's binding services, sub-agent completions can
     route to any gateway
   - Enables true distributed fleet coordination

**Current limitation:** Session bindings are Discord-focused. Multi-gateway fleet
bindings are not yet implemented.

---

## 5. Fleet Deployment Patterns

### Pattern 1: Single Gateway (Simple)

- One `openclaw-gateway` process running
- Multiple agents configured: `agents.list = [main, work, hobby, ...]`
- All agents share the same workspace
- Sub-agent spawns use `sessions_send()` for invisible coordination
- Session reset is gateway-wide (4 AM local time)

**Pros:** Simple, low overhead, invisible coordination **Cons:** Single point of
failure, shared resource limits

---

### Pattern 2: Multiple Gateways, Shared Slack Channel (Current Multi-Agent Setup)

- N gateways (each running on different machines or in different cloud regions)
- Each gateway has its own agent(s) and workspace
- Agents coordinate via **Slack @-mentions** in a shared channel
- Loop detection + ping-pong guards prevent infinite loops
- Session persistence is per-gateway; each agent resets independently

**Config example (Gateway 1 - alpha):**

```json
{
  "agents": {
    "list": [
      {
        "id": "alpha",
        "name": "alpha",
        "groupChat": {
          "mentionPatterns": ["\\balpha\\b"]
        }
      }
    ]
  },
  "channels": {
    "slack": {
      "channels": {
        "<SLACK_CHANNEL_ID>": {
          "requireMention": true,
          "allowBots": true,
          "agents": ["alpha"]
        }
      }
    }
  },
  "tools": {
    "loopDetection": {
      "enabled": true,
      "genericRepeat": true,
      "pingPong": true
    }
  }
}
```

**Pros:** Distributed, resilient, each agent can scale independently **Cons:** Visible
coordination (Slack), potential latency, eventual consistency

---

### Pattern 3: Gateway + Node Pairing (Future Hybrid Model)

- Central gateway with multiple node agents (Android, iOS, macOS)
- Nodes record sensor data, images, location
- Nodes route through gateway for AI reasoning
- Session bindings could bind completions back to specific node

**Status:** Not yet fully documented in OpenClaw. Pairing is available; unified session
binding across nodes is future work.

---

## 6. Persistence Guarantees & Limitations

### What IS Persistent

1. **Workspace files** (`MEMORY.md`, `SOUL.md`, `USER.md`, `TOOLS.md`)
   - Read/write-to-disk at session boundaries
   - Survive agent restarts
   - Gateway host is authoritative

2. **Session transcripts** (JSONL files)
   - Saved after each turn
   - Subject to maintenance cleanup (30-day prune by default)
   - Query with `openclaw sessions`

3. **Cron job state**
   - Job definitions and run history stored in gateway config
   - `cron/runs/<jobId>.jsonl` for job-specific logs

### What is NOT Persistent (in Real-Time)

1. **In-memory context** during a turn
   - Lost if process crashes mid-turn
   - Cannot be recovered (no WAL/journaling)
   - Sub-agent spawns are one-shot by design

2. **Conversation state between resets**
   - Sessions reset daily (4 AM) or when idle
   - Previous context goes away unless captured in workspace files
   - Model does not "remember" yesterday's conversation by default

3. **Cross-gateway coordination state**
   - No central session store
   - Each gateway maintains its own session.json
   - Slack/Discord messages are the ephemeral coordination bus
   - If Slack message is deleted, context is lost

### Best Practices for Fleet Durability

1. **Write important decisions to MEMORY.md** — survives session resets
2. **Use cron for scheduled recurring tasks** — decoupled from session lifecycle
3. **Expect Slack coordination to be the coordination bus** — keep messages clear and
   queryable
4. **Archive important sub-agent outputs** — don't rely on ephemeral session context
5. **Set appropriate maintenance policies** — `maxEntries`, `pruneAfter` balance history
   vs. performance

---

## 7. Bootstrap Best Practices for Multi-Agent Fleets

### On-Boarding New Agent to Fleet

1. **Provision gateway** (or use existing one for single-gateway model)
2. **Add agent config** to `agents.list`
3. **First run triggers bootstrap**
   - Agent gets prompted for identity/role
   - `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`, `SOUL.md` are created
   - `BOOTSTRAP.md` is deleted after completion
4. **Update fleet docs** — add agent to fleet topology docs
5. **Configure coordination rules** — set `mentionPatterns` and loop guards if
   multi-gateway

### Preserving Bootstrap Decisions

- Bootstrap ritual runs **once** (BOOTSTRAP.md is deleted)
- To re-run bootstrap, restore `BOOTSTRAP.md` to the workspace and restart
- **Identity lives in IDENTITY.md and SOUL.md** — these are durable

### Template-Based Bootstrap Acceleration

For fleet deployments with many similar agents:

1. Create a **template workspace** with pre-written `IDENTITY.md`, `SOUL.md`, `USER.md`
2. Copy template to new agent's workspace
3. First run skips bootstrap (files exist)
4. Fine-tune identity/role as needed

**Limitation:** OpenClaw does not yet have built-in template support; requires manual
file management.

---

## 8. Recommended Fleet Config (Summary)

For a 3-agent fleet (alpha, bravo, charlie) across multiple gateways:

```json
{
  "agents": {
    "list": [
      {
        "id": "alpha",
        "name": "alpha",
        "groupChat": {
          "mentionPatterns": ["\\balpha\\b"]
        }
      },
      {
        "id": "charlie",
        "name": "charlie",
        "groupChat": {
          "mentionPatterns": ["\\bcharlie\\b"]
        }
      },
      {
        "id": "bravo",
        "name": "bravo",
        "groupChat": {
          "mentionPatterns": ["\\bbravo\\b"]
        }
      }
    ]
  },
  "channels": {
    "slack": {
      "channels": {
        "<SLACK_CHANNEL_ID>": {
          "requireMention": true,
          "allowBots": true,
          "agents": ["alpha", "charlie", "bravo"]
        }
      }
    }
  },
  "session": {
    "dmScope": "main",
    "maintenance": {
      "mode": "enforce",
      "pruneAfter": "30d",
      "maxEntries": 800,
      "rotateBytes": "20mb"
    }
  },
  "tools": {
    "loopDetection": {
      "enabled": true,
      "genericRepeat": true,
      "pingPong": true,
      "maxPingPongTurns": 5
    }
  }
}
```

---

## 9. Future Directions (From OpenClaw Roadmap)

1. **Session Binding Expansion**
   - ACP harness targets (bind to specific chat threads)
   - Multi-gateway binding service
   - Cross-gateway subagent routing

2. **Unified Session Store**
   - Central session catalog across gateways
   - Coordinated session reset across fleet
   - Global session queries

3. **Fleet Orchestration**
   - Built-in fleet topology discovery
   - Automatic load balancing across gateways
   - Unified monitoring/debugging

4. **Bootstrap Templates**
   - Ship with common agent templates (researcher, coder, admin, etc.)
   - Faster agent provisioning in large fleets

5. **Persistent Coordination Layer**
   - Replace Slack mentions with durable event bus
   - Full transactional semantics for multi-agent workflows

---

## References

- OpenClaw docs: `/start/bootstrapping.md` — Bootstrap ritual details
- OpenClaw docs: `/cli/sessions.md` — Session management CLI
- OpenClaw docs: `/concepts/session.md` — Complete session lifecycle reference
- OpenClaw docs: `/experiments/plans/session-binding-channel-agnostic.md` — Binding
  architecture plan
- Internal: `/Users/nick/.openclaw/workspace/MULTI_AGENT_STATUS.md` — Working
  multi-agent comms config
