# Embeddings Setup Guide

How to configure memory search embeddings across the OpenClaw fleet. Based on empirical
benchmark testing conducted March 17, 2026.

## Test Methodology

- **Corpus:** 714 chunks across 202 markdown memory files (~1.2MB source)
- **Queries:** 25 test queries across 5 categories: factual recall, semantic
  understanding, people lookup, temporal/recent context, and needle-in-haystack
- **Scoring:** Hit rate (answer in top 5), Precision@1 (correct file ranked #1), keyword
  recall (fraction of expected keywords found in top 5)
- **Two passes:** Pass 1 tested 7 embedding models head-to-head. Pass 2 tested 6 search
  config variants (hybrid weights, temporal decay, MMR) on the winning local model.

## Model Shootout

Tested against the same memory corpus. All models used pure vector (cosine similarity)
search for fair comparison:

| Model                      | Provider   | Hit%      | P@1%      | KW Recall | Query Latency | Index Time | Cost   |
| -------------------------- | ---------- | --------- | --------- | --------- | ------------- | ---------- | ------ |
| **gemini-embedding-001**   | OpenRouter | **96.0%** | 44.0%     | **83.3%** | 111ms         | **1.5s**   | ~Free  |
| **bge-m3**                 | Ollama     | 92.0%     | **48.0%** | 76.3%     | **107ms**     | 116.0s     | Free   |
| **text-embedding-3-small** | OpenAI     | 92.0%     | **48.0%** | 79.7%     | 322ms         | 10.7s      | $0.006 |
| text-embedding-3-large     | OpenAI     | 92.0%     | **48.0%** | 80.7%     | 394ms         | 8.7s       | $0.037 |
| embeddinggemma             | Ollama     | 84.0%     | 40.0%     | 70.2%     | 89ms          | 109.7s     | Free   |
| nomic-embed-text           | Ollama     | 68.0%     | 8.0%      | 42.3%     | 42ms          | 38.9s      | Free   |

**Key takeaways:**

- `bge-m3` and `text-embedding-3-small` tie on Hit% and P@1%, with OpenAI slightly
  better on keyword recall (+3.4pp)
- `gemini-embedding-001` via OpenRouter has the highest hit rate (96%) and fastest
  indexing (1.3s), but clutters OpenRouter logs with embedding calls — use only if the
  quality delta matters for your use case
- `text-embedding-3-large` offers marginal KW recall improvement (+1pp) over small at 6x
  the cost — not worth it
- `embeddinggemma` (Google's local 300M model via Ollama) is **significantly worse**
  than its cloud sibling `gemini-embedding-001` — 84% vs 96% hit rate. Not recommended.
- `nomic-embed-text` is dramatically worse across all metrics — do not use

## Search Config Tuning (bge-m3)

Tested OpenClaw's hybrid search features on top of bge-m3 embeddings using the actual
BM25 + vector merge algorithm, temporal decay, and MMR re-ranking:

| Config                        | Hit%  | P@1%      | KW Recall |
| ----------------------------- | ----- | --------- | --------- |
| **Vector only**               | 92.0% | **44.0%** | **79.8%** |
| Hybrid 70/30 (BM25 + vector)  | 92.0% | 28.0%     | 78.6%     |
| Hybrid 50/50                  | 92.0% | 24.0%     | 76.2%     |
| Hybrid 70/30 + temporal decay | 92.0% | 16.0%     | 71.4%     |
| Hybrid 70/30 + MMR            | 92.0% | 28.0%     | 71.4%     |
| Hybrid 70/30 + both           | 92.0% | 16.0%     | 71.4%     |

**Key takeaways:**

- **Every added feature made results worse, not better.** Pure vector search won.
- BM25 keyword matching introduced noise that pulled wrong results up and right results
  down (P@1 dropped from 44% → 28%).
- Temporal decay penalized recent-but-relevant content. With only ~2 months of memory
  files, most content is recent enough that decay just hurts.
- MMR diversity re-ranking pushed out relevant results in favor of "different" ones —
  harmful when you only have 5 result slots.
- **Recommendation: disable hybrid search features for bge-m3.** The embedding quality
  is sufficient that BM25/decay/MMR add noise rather than signal.

> **Note:** These results may change as the memory corpus grows. Temporal decay becomes
> more valuable with 6+ months of daily logs. MMR helps when many files contain similar
> content. Re-evaluate after the corpus doubles in size.

## Fleet Strategy

### EC2 Instances (no GPU): OpenAI `text-embedding-3-small`

Machines without local GPU use the OpenAI API. Cost is negligible ($0.006 per full
reindex) and quality matches the best local model. Uses a **dedicated OpenAI API key**
separate from chat/completions routing.

**Applies to:** Shelly, Hex, and any future EC2/cloud instances

### Apple Silicon Machines (GPU): Ollama `bge-m3`

Machines with Apple Silicon run Ollama locally for zero-cost, zero-dependency
embeddings. `bge-m3` (1.2GB, 1024 dimensions) is the best local model — ties OpenAI
small on quality with faster query latency (107ms vs 322ms). Indexing is slower (116s vs
11s) but only happens on first run or model change.

**Use pure vector search (disable hybrid/BM25).** Pass 2 testing showed hybrid features
degrade results for bge-m3.

**Applies to:** Nick's Mac Studio, and any future Mac Mini fleet machines (Julianna,
Gil, Ali, Thomas, etc.)

## Configuration

### OpenAI (EC2 instances)

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "openai",
        model: "text-embedding-3-small",
        remote: {
          apiKey: "<DEDICATED_OPENAI_EMBEDDINGS_KEY>",
        },
        query: {
          hybrid: {
            enabled: false,
          },
        },
      },
    },
  },
}
```

The `remote.apiKey` is used **only** for embeddings — it does not affect LLM routing,
which continues through the existing auth profiles (Anthropic, OpenRouter, etc). Use a
dedicated API key for cost tracking and rate limit isolation.

### Ollama bge-m3 (Apple Silicon machines)

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "openai",
        model: "bge-m3",
        remote: {
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "ollama",
        },
        fallback: "none",
        query: {
          hybrid: {
            enabled: false,
          },
        },
      },
    },
  },
}
```

No external fallback — if Ollama is down, memory search is down. Keep Ollama healthy.

#### Ollama setup (required on each machine)

```bash
# Install
brew install ollama

# Pull the embedding model
ollama pull bge-m3

# Enable auto-start on login
brew services start ollama

# Verify
brew services list | grep ollama   # should show "started"
ollama list | grep bge-m3          # should show the model
```

This creates a macOS launch agent (`~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`)
that starts `ollama serve` automatically on login.

## After Changing Models

Changing the embedding model changes the vector dimensions (e.g., bge-m3 = 1024 dims,
text-embedding-3-small = 1536 dims). Existing vectors become incompatible.

**Always reindex after changing models:**

```bash
# Restart gateway to pick up config change
systemctl --user restart openclaw-gateway   # Linux
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway  # macOS

# Force full reindex
openclaw memory index --force

# Verify
openclaw memory status
```

Expected output should show the new provider, model, and correct dimension count.

## Troubleshooting

**"Config path not found: embeddings"** — The config key is
`agents.defaults.memorySearch`, not `embeddings`. Use
`openclaw config get agents.defaults.memorySearch`.

**Dimensions mismatch after model change** — Run `openclaw memory index --force` to
rebuild all vectors with the new model's dimensions.

**Provider shows "auto" in status** — The `requestedProvider` field shows what's in
config. If it says "auto", no explicit provider is set — OpenClaw is guessing. Set it
explicitly.
