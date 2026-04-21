---
name: librarian
version: 0.5.0
version: 0.3.0
description: >
  DEPRECATED — Use the `cortex` skill instead. Cortex v2 absorbs all librarian
  functionality (memory maintenance, knowledge organization, learning analysis) into a
  unified knowledge compiler. This skill is kept for backwards compatibility but all
  triggers now route to Cortex.
triggers:
  - organize memories
  - clean up knowledge base
  - tidy up memory
  - run the librarian
  - memory maintenance
  - organize my notes
  - review daily files
metadata:
  openclaw:
    emoji: "\U0001F4DA"
    deprecated: true
    replacement: cortex
---

# Librarian — DEPRECATED

**This skill has been replaced by [Cortex](../cortex/SKILL.md).**

Cortex v2 absorbs all librarian functionality:

- Memory maintenance → Cortex MEMORY.md routing table
- Knowledge organization → Cortex category indexes + entity pages
- Learning analysis → Cortex `learning/` directory (corrections → patterns → how-to)
- Progressive elaboration → Cortex handles organically as sources accumulate
- Daily journals → Cortex `daily/` directory

If you're seeing this, invoke Cortex instead:

```
cortex lint          # Health-check and organize
cortex status        # See current state
```

Or tell the AI: "organize my knowledge base" — Cortex will handle it.
This creates an audit trail and helps the next run know where the last one left off.

### Step 8: Learning Analysis (Pattern Detection)

After standard memory maintenance, run the learning loop's pattern detection pass. This
is how corrections compound into improvements over time.

1. **Read** `memory/learning/corrections.md` — scan entries from the last 30 days
2. **Group** entries by similarity — same domain, same kind of learning
3. **Detect patterns** — if 2+ corrections share the same root cause across different
   sessions, that's a pattern candidate. Synthesize the corrections into a single
   operating rule (see `workflows/learning-loop/AGENT.md` Phase 2 for format)
4. **Check for duplicates** — before creating a new pattern, check if it already exists
   in `memory/learning/patterns.md` or in any workflow's `agent_notes.md`
5. **Write candidates** to `memory/learning/patterns.md` as complete, self-contained
   rules with pipeline metadata in HTML comments
6. **Prune stale corrections** — archive entries older than 30 days that never became
   patterns (move to `memory/learning/archive/YYYY-QN.md`). **Exception:** do not
   archive corrections that informed a pattern still marked `candidate` in its HTML
   comment — those entries must survive until the pattern is promoted or expired
7. **Prune stale pattern candidates** — archive entries in `patterns.md` whose HTML
   comment has `status: candidate` and is older than 60 days (move to archive)

Log the results to today's daily file:

```
## Learning Loop — Pattern Detection

- Corrections reviewed: N (last 30 days)
- New patterns detected: N
- Existing patterns updated: N
- Stale corrections archived: N
- Stale pattern candidates expired: N
```

If `memory/learning/corrections.md` doesn't exist or is empty, skip this step silently.

See `workflows/learning-loop/AGENT.md` for the full learning loop architecture.

## Wiki-Links (Knowledge Graph)

Use `[[wiki-links]]` to connect information across memory files. This builds an implicit
knowledge graph that makes relationships visible and improves retrieval.

### Syntax

- **People:** `[[firstname-lastname]]` → links to `memory/people/firstname-lastname.md`
- **Projects:** `[[project-name]]` → links to `memory/projects/project-name.md`
- **Topics:** `[[topic-name]]` → links to `memory/topics/topic-name.md`
- **Decisions:** `[[YYYY-MM-DD-topic]]` → links to
  `memory/decisions/YYYY-MM-DD-topic.md`

### When to Link

Add wiki-links when writing or updating any memory file:

- Mention a person → `[[alex-chen]]`
- Reference a project → `[[openclaw-config]]`
- Cite a decision → `[[2026-01-15-database-choice]]`
- Reference a topic → `[[restaurants]]`

**Example daily file entry:**

```markdown
Met with [[alex-chen]] about [[project-atlas]]. He's leaning toward Postgres — see
[[2026-02-18-database-choice]] for the decision. Grabbed dinner at a new spot worth
adding to [[restaurants]].
```

### Link Maintenance (during librarian runs)

As part of each maintenance loop:

1. **Add links to new content** — When promoting daily file content to structured files,
   add wiki-links to entities mentioned
2. **Check for orphan links** — Links pointing to files that don't exist yet. If the
   entity is substantive enough, create the file. If not, remove the brackets.
3. **Backlink awareness** — When updating a person/project/topic file, note what other
   files link to it. This reveals connections that might not be obvious.

### Rules

- Link filenames must match the target's kebab-case filename (without `.md`)
- Don't over-link — link on first mention per section, not every occurrence
- Don't link to files you're not going to create (no aspirational links)
- Wiki-links are for cross-referencing, not a replacement for prose

## File Conventions

- All filenames: **kebab-case** (`alex-chen.md`, not `Alex Chen.md`)
- People files: `firstname-lastname.md`; if last name unknown, use
  `firstname-unknown.md` as a placeholder (never bare `firstname.md`); if multiple
  people share a first name with unknown last names, add a brief descriptor:
  `john-unknown-contractor.md`, `john-unknown-neighbor.md`
- Date files: `YYYY-MM-DD.md`
- Decision files: `YYYY-MM-DD-topic.md`
- All files are markdown
- Include `*Last updated: YYYY-MM-DD*` at the bottom of structured files

## What NOT to Do

- Don't delete daily files — they're the raw journal, kept for reference
- Don't reorganize the directory structure itself (people/, projects/, topics/,
  decisions/ are fixed)
- Don't create files for people mentioned once in passing
- Don't store sensitive data (API keys, passwords, tokens) in memory files
- Don't create empty placeholder files "just in case"
- Don't merge unrelated topics into one file for convenience
- Don't add frontmatter or YAML to memory files — plain markdown only

## Quality Checks

Before finishing, verify:

- [ ] MEMORY.md is under ~100 lines of curated content
- [ ] No duplicate information across files
- [ ] All pointers in MEMORY.md point to files that exist
- [ ] People files have current-state information (not outdated)
- [ ] Today's daily file has a librarian run summary
- [ ] No orphaned topic files (mentioned nowhere, serve no purpose)
- [ ] Wiki-links added to promoted content (people, projects, topics, decisions)
- [ ] No orphan wiki-links pointing to nonexistent files
