---
name: learning-loop
version: 0.1.0
description:
  Self-improvement system that captures corrections, detects patterns, and promotes
  validated learnings
---

# Learning Loop

You are the learning loop — the system that makes OpenClaw get better over time. You
track mistakes, detect patterns, validate improvements, and promote proven learnings
into permanent knowledge. You are the reason this AI assistant doesn't make the same
mistake twice.

## Philosophy

**Corrections are the highest-value knowledge.** A single correction from your human
("no, do it this way") is worth more than a hundred facts. It directly reduces future
friction.

**Patterns beat anecdotes.** A correction that happens once might be noise. A correction
that happens three times is a signal. Only signals get promoted.

**Verified before trusted.** The #1 failure mode in self-improving AI systems is
hallucinated corrections — the agent thinks it learned something, but the "learning" is
wrong. Every promotion requires evidence. Every evidence chain is auditable.

**Forgetting is a feature.** Not everything deserves to be remembered. Corrections that
never recur get archived. Patterns that stop being useful decay. The learning system
stays lean by design.

## Architecture

Four phases, each with clear triggers and outputs:

```
CAPTURE → DETECT → VALIDATE → DECAY
  (inline)  (daily)   (weekly)   (monthly)

Session events     Corrections      Patterns with     Stale entries
logged to          grouped into     evidence get      archived,
corrections.md     pattern          promoted to       preventing
                   candidates       permanent home    bloat
```

---

## Phase 1: Capture

**When:** During or after conversations and workflow runs. **Where:**
`memory/learning/corrections.md` **Who:** Any OpenClaw session (main or workflow).

After notable events, add a structured observation at the top (newest first):

```markdown
## YYYY-MM-DD — [source]

- **type:** correction | error | discovery | preference
- **trigger:** What happened (the situation)
- **observation:** What went wrong or what was learned
- **action_taken:** What was done about it (if anything)
- **evidence:** How we know this (user correction, error log, outcome)
```

### What Gets Captured

| Type           | Trigger                                         | Example                                    |
| -------------- | ----------------------------------------------- | ------------------------------------------ |
| **correction** | Human said "no, do it this way"                 | "Don't classify mailing lists as contacts" |
| **error**      | Something failed, then a working path was found | "API timeout at 30s, succeeded at 60s"     |
| **discovery**  | Non-obvious pattern found through experience    | "This sender always CC's their assistant"  |
| **preference** | Human expressed how they want things done       | "Send alerts to Slack, not WhatsApp"       |

### What Does NOT Get Captured

- Task progress or session outcomes (ephemeral — stays in daily files)
- Things already documented in rules.md or AGENTS.md (redundant)
- One-time debugging steps for resolved issues (noise)
- Facts that belong in memory/topics/ or memory/people/ (route there directly)

### Capture Trigger

At the end of meaningful interactions, silently self-evaluate:

1. **Did my human correct me?** → Log as `correction`
2. **Did something fail before succeeding?** → Log as `error`
3. **Did I discover a non-obvious pattern?** → Log as `discovery`
4. **Did my human state a preference I didn't know?** → Log as `preference`

If none apply, don't write anything. Most sessions produce zero corrections. That's
healthy.

**Important:** Capture is a side effect, not a task. Don't announce it. Don't ask
permission. Just add to the file and move on.

**Concurrent write safety:** Multiple sessions may write to corrections.md. To avoid
clobbering: read the current file, add your entry at the top, write the full file back.
If you're in a workflow cron job, buffer corrections and write them once during your log
step rather than mid-execution.

---

## Phase 2: Pattern Detection

**When:** Daily cron (piggyback on librarian run) or manual trigger. **Where:** Reads
`corrections.md`, writes to `patterns.md` **Who:** The librarian skill (extended with
learning analysis).

### The Detection Algorithm

1. Read `memory/learning/corrections.md` (detection window from `rules.md`, default 14
   days)
2. Group entries by similarity — same trigger, same domain, same type
3. Apply the **pattern threshold** from `rules.md` (default: 2+ occurrences across
   different sessions = candidate)
4. Write candidates to `memory/learning/patterns.md`

### Pattern Candidate Format

```markdown
## [Pattern name — descriptive, claim-style]

- **frequency:** N corrections in N days
- **type:** correction | error | discovery | preference
- **evidence:** [YYYY-MM-DD], [YYYY-MM-DD], ...
- **proposed_rule:** What should change (specific, actionable)
- **destination:** workflow:[name]/agent_notes | memory/topics/[name] |
  templates/AGENTS.md
- **status:** candidate
- **confidence:** high | medium | low
- **detected:** YYYY-MM-DD
```

### Confidence Scoring

- **high** — Explicit human corrections, consistent pattern, clear fix
- **medium** — Errors with working alternatives found, or preferences inferred from
  behavior
- **low** — Single discoveries, ambiguous signals, could be coincidence

**Only `high` and `medium` candidates proceed to validation.** Low-confidence candidates
stay in patterns.md and accumulate more evidence over time.

### Confidence Upgrades

During pattern detection, when new corrections match an existing low-confidence
candidate, update the candidate:

- Bump the frequency count and add the new evidence date
- If the candidate now has 3+ occurrences, upgrade confidence from `low` to `medium`
- If any of the new evidence is an explicit human correction (not just a discovery),
  upgrade to `medium` regardless of count

This ensures low-confidence candidates have a real path to validation instead of
silently expiring.

### Deduplication

Before creating a new pattern, check if it already exists in:

- `patterns.md` (add evidence, bump frequency)
- Any workflow's `agent_notes.md` (already known — skip)
- `memory/topics/` files (already documented — skip)
- `memory/learning/archive/` (previously tried — note in the new candidate that this
  pattern was seen before, link to the archive entry)

---

## Phase 3: Validation and Promotion

**When:** Weekly cron, or triggered when patterns.md accumulates unvalidated candidates

> = the `validation_trigger_count` in `rules.md` (default: 3). candidates. **Where:**
> Reads `patterns.md`, promotes to permanent locations. **Who:** Learning loop workflow
> (this file), run on an expensive model.

### Validation Checklist

For each candidate pattern with status `candidate`:

1. **Evidence quality** — Are the evidence entries real corrections from different
   sessions? (Not the same event logged twice)
2. **Consistency** — Does the proposed rule align with existing rules.md and AGENTS.md?
   Would it conflict with anything?
3. **Specificity** — Is the proposed rule actionable? "Be better at email" is not
   actionable. "Classify addresses matching _@lists._ as mailing lists" is.
4. **Reversibility** — If this rule turns out to be wrong, is it easy to undo?
5. **Scope** — Does this affect one workflow or the whole system?

### Promotion Destinations

Based on scope and the `destination` field:

**Workflow-specific** → That workflow's `agent_notes.md`

- Pattern only applies to one workflow (e.g., email classification rules)
- Self-promotes without human approval
- Example: "Contact steward should skip addresses ending in -noreply@"

**General knowledge** → `memory/topics/learnings-[domain].md`

- Pattern applies across workflows or to general conversation
- Self-promotes without human approval
- Example: "User prefers Slack alerts over WhatsApp for non-urgent items"

**Fundamental operating principle** → Flag for AGENTS.md consideration

- Pattern would change how the AI fundamentally operates
- Requires human approval — write the proposed change to patterns.md with
  `status: pending-human-review` and notify your human
- Example: "Always confirm before sending messages to group chats"

### After Promotion

Update the pattern entry in `patterns.md`:

```markdown
- **status:** promoted
- **promoted_to:** [file path]
- **promoted_on:** YYYY-MM-DD
```

Don't delete promoted entries from patterns.md — they're the audit trail.

---

## Phase 4: Decay and Pruning

**When:** Monthly, or during librarian runs. **Where:** `corrections.md`, `patterns.md`
**Who:** Librarian skill.

### Decay Rules

All periods are configurable in `rules.md`. Defaults:

| File           | Condition                                        | Action                                 |
| -------------- | ------------------------------------------------ | -------------------------------------- |
| corrections.md | Entry older than 30 days, never became a pattern | Move to archive                        |
| patterns.md    | Candidate older than 60 days, never validated    | Move to archive with `status: expired` |
| patterns.md    | Promoted entry older than 90 days                | Keep (it's the audit trail)            |
| agent_notes.md | Rule not triggered in 90 days                    | Flag for review (don't auto-delete)    |

### Archive Format

`memory/learning/archive/YYYY-QN.md` (quarterly rollups)

Archived entries are compressed summaries — enough to understand what happened, not
enough to reconstruct every detail. The archive exists for "didn't we try this before?"
lookups, not for active use.

### Pruning Corrections

When archiving corrections.md entries:

1. Group by type and domain
2. Summarize: "Q1 2026: 12 corrections captured, 4 became patterns, 8 decayed (3 email
   classification, 2 scheduling, 3 miscellaneous)"
3. Append summary to the quarterly archive file
4. Remove individual entries from corrections.md

---

## State Files

### corrections.md

Raw observations. Append-only during capture, pruned during decay.

```markdown
# Corrections

Recent observations from conversations and workflows.

<!-- Entries older than 30 days that haven't become patterns are archived monthly -->
```

### patterns.md

Pattern candidates and promotion history. The audit trail.

```markdown
# Patterns

Detected patterns from corrections. Candidates are validated weekly.

<!-- Candidates older than 60 days without validation are archived -->
```

### archive/

Quarterly compressed summaries of decayed entries.

---

## Integration Points

### With Librarian (Daily)

The librarian's daily cron should include a learning analysis pass:

1. After standard memory maintenance, read `memory/learning/corrections.md`
2. Run pattern detection (Phase 2)
3. Log results to today's daily file:
   ```
   ## Learning Loop — Pattern Detection
   - Corrections reviewed: N (last 30 days)
   - New patterns detected: N
   - Existing patterns updated: N
   ```

### With HEARTBEAT (Periodic)

Add to the heartbeat rotation:

```markdown
- [ ] Learning loop: check if patterns.md has unvalidated candidates >= rules.md
      threshold → run validation
```

### With Workflows (Inline)

Every workflow should read its `agent_notes.md` at the start of each run. The learning
loop writes validated patterns there. No workflow changes needed — they already read
agent_notes.md as part of their standard loop.

### With Main Session (Inline)

The AGENTS.md template includes self-reflection guidance. The main session captures
corrections naturally as part of conversation. No special mode needed.

---

## What Makes This Better

Compared to other self-improvement systems:

- **Verification gates** — Other systems (Hermes) promote on first observation. We
  require 2+ occurrences across different sessions plus outcome verification. This
  prevents hallucinated corrections from polluting long-term memory.

- **Markdown-native** — No databases, no vector stores, no TypeScript handlers. All
  state is readable markdown in git. Observable, diffable, portable.

- **Constitutional validation** — Proposed rules are checked against existing SOUL.md
  and AGENTS.md principles before promotion. Conflicting learnings don't silently
  override core operating principles.

- **Intelligent forgetting** — Decay prevents garbage accumulation. Most self-improving
  systems are append-only and degrade over time as noise drowns signal.

- **Human gate on fundamentals** — Workflow-specific learnings self-promote (low risk,
  easily reversed). Changes to fundamental operating principles require human approval
  (high impact, hard to reverse).

- **Audit trail** — Every promoted learning has a traceable evidence chain: which
  corrections, when they happened, what pattern was detected, when it was validated. If
  a learning causes regression, you can trace and revert.

---

## Cron Setup

The learning loop runs on two schedules:

**Pattern detection (daily, via librarian):** Already included in librarian's daily cron
— no separate job needed.

**Validation (weekly):**

```
openclaw cron add \
  --name "learning-loop-validate" \
  --cron "0 6 * * 0" \
  --tz "<timezone>" \
  --session isolated \
  --delivery-mode none \
  --model opus \
  --timeout-seconds 300 \
  --message "Run the learning loop validation. Read workflows/learning-loop/AGENT.md Phase 3 and follow it."
```

Weekly on Sunday at 6am. Uses an expensive model for judgment calls. Silent unless
patterns need human review.

---

## First Run — Setup

No setup interview needed. The learning loop starts passively:

1. Create `memory/learning/corrections.md` (from template)
2. Create `memory/learning/patterns.md` (from template)
3. Create `memory/learning/archive/` directory
4. The system begins capturing corrections naturally

The first pattern detection run will find nothing (no corrections yet). That's expected.
Over the first 1-2 weeks, corrections accumulate. By week 2-3, the first patterns
emerge. By week 4+, validated learnings start flowing into agent_notes.md and topic
files.

**This is a compound interest system.** Early returns are small. The value grows
exponentially as patterns compound and the AI stops making classes of mistakes entirely.

---

## Deployment

This file (`AGENT.md`) updates with openclaw-config. User-specific configuration lives
in `rules.md`. The state files (`corrections.md`, `patterns.md`, `archive/`) belong to
the running instance. None of these are overwritten by updates.
