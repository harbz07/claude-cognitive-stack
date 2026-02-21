# 🧠 Claude Cognitive Runtime Service

**A biomimetic cognitive stack for persistent, user-aware AI conversations.**

Inspired by the neuroscience architecture at [basecampgrounds.com](https://www.basecampgrounds.com) — L1 (Prefrontal Cache), L2 (Parietal Overlay), L3 (Hippocampal Consolidation).

---

## Architecture

```
User Message
     │
     ▼
┌─────────────────────────────────────────┐
│  STAGE 1: INGEST                        │
│  Session bootstrap, L1 window update    │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 2: WERNICKE ROUTER               │
│  Skill activation, model selection,     │
│  RAG config, project namespace          │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 3: RAG SEARCH                    │
│  chat_index + knowledge_graph search    │
│  Returns: candidates + citations        │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 4: THALAMUS (threshold: 0.72)    │
│  6-dim scoring, greedy token packing    │
│  L1 compaction when pressure ≥ 80%      │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 5: INSULA                        │
│  PII redaction, sentiment analysis      │
│  Memory write gating                    │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 6: ASSEMBLE                      │
│  System + context + citations + history │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 7: GENERATE (OpenAI/Anthropic)   │
│  gpt-5 / gpt-5-mini / claude-*          │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  STAGE 8: CONSOLIDATE                   │
│  token_pressure (≥80%) or session_end   │
│  → key_facts[] extraction, memory_diff  │
└─────────────────────────────────────────┘
```

---

## Memory Layers

| Layer | Analog | Implementation |
|-------|--------|----------------|
| **L1** | Prefrontal Cache | `sliding_window` in SessionState — active context, compacted when pressure ≥ 80% |
| **L2** | Parietal Overlay | `memory_items` D1 table — semantic + episodic memories, project-scoped |
| **L3** | Hippocampal | `consolidation_jobs` — session summaries with `key_facts[]`, decay updates, `memory_diff` |

---

## Completed Features

### ✅ Core Pipeline (8 Stages)
- **Ingest**: Session bootstrap, message ID generation
- **Wernicke Router**: Skill activation, RAG source config, project namespace injection
- **RAG Search**: `chat_index` (L1 window) + `knowledge_graph` (L2 memory) — returns ranked `RagResult[]` with `Citation[]`
- **Thalamus**: 6-dimensional scoring (relevance 0.35, recency 0.20, scope 0.15, type 0.10, decay 0.10, skill 0.10) — threshold **0.72**, top_k_greedy packing
- **Insula**: PII detection (7 patterns), sentiment analysis (positive/negative/neutral/volatile), write gating
- **Assemble**: System + context blocks + citations + history
- **Generate**: OpenAI-compatible (Genspark proxy, gpt-5/gpt-5-mini) and Anthropic dual-backend
- **Consolidate**: session_end + token_pressure triggers, `key_facts[]`, `memory_diff`, decay updates

### ✅ Data Models (Canonical Spec)
- `MemoryItem`: id, type, scope, project_id, content, embedding, source{type,message_id}, tags, confidence, decay_score, provenance
- `MemorySummary`: id, session_id, scope, content, **key_facts[]**, token_count, **consolidation_pass**
- `SkillPackage`: id, name, **version**, trigger, system_fragment, tools, priority, token_budget, **max_context_tokens**, **compatible_models[]**
- `Loadout`: model_profile, budgets{l1_window_tokens, l2_budget_tokens, skills, response_reserve}, thresholds{thalamus_threshold=0.72, consolidation_trigger=0.80}
- `Project`: id, user_id, name, skill_loadout, thalamus_threshold, insula_mode, rag_top_k
- `Citation`: source, source_type, message_id, memory_id, relevance, content_snippet
- `MemoryDiff`: added, updated, removed, new_items[], key_facts_extracted[]

### ✅ Project Namespace Isolation
- `POST /api/projects` — create project with custom thalamus_threshold, insula_mode, rag_top_k
- Project-scoped memory queries: session ∪ project ∪ global
- Wernicke Router activates `project_scope` skill automatically
- Loadout merges project overrides at runtime

### ✅ Observability (All Spec Items)
- Full stage traces: `wernicke`, `rag`, `thalamus`, `insula`, `assemble`, `generate`, `consolidate`, `compact`
- Thalamus scores with `drop_reason` logging
- `citations[]` on every response and trace
- `memory_diff` in consolidation results
- Token breakdown: system/context/history/user_message/total/budget_remaining
- Sentiment + PII fields in Insula trace stage

---

## API Reference

```
POST   /api/chat            — Send message through cognitive pipeline
GET    /api/chat/sessions   — List user sessions
GET    /api/chat/sessions/:id
DELETE /api/chat/sessions/:id

POST   /api/memory          — Store memory item manually
GET    /api/memory          — Query memory (?scope=&type=&session_id=)
DELETE /api/memory/:id
GET    /api/memory/stats    — Memory statistics by type/scope

POST   /api/projects        — Create project namespace
GET    /api/projects        — List projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/memory

GET    /api/traces          — List request traces
GET    /api/traces/:id      — Full trace with all stages
POST   /api/traces/consolidate — Trigger manual consolidation
GET    /api/traces/system/stats

GET    /api/skills          — List skill packages
GET    /api/loadouts        — List loadout presets
GET    /api/health
GET    /api/init            — Initialize / migrate DB schema
```

### Chat Response Schema
```json
{
  "trace_id": "uuid",
  "session_id": "uuid",
  "response": "...",
  "model": "gpt-5",
  "token_breakdown": {"system":254,"context":140,"history":0,"user_message":10,"total":404},
  "skills_activated": ["Research Mode", "General Assistant"],
  "memory_items_retrieved": 5,
  "citations": [
    {
      "source": "memory_semantic_project",
      "source_type": "memory",
      "memory_id": "uuid",
      "relevance": 0.867,
      "content_snippet": "Thalamus threshold is 0.72..."
    }
  ],
  "memory_diff": null,
  "consolidation_queued": false
}
```

---

## Data Architecture

- **Storage**: Cloudflare D1 (SQLite) — sessions, memory_items, skill_packages, request_traces, consolidation_jobs, projects, api_keys
- **Model API**: OpenAI-compatible (Genspark proxy: gpt-5, gpt-5-mini) or Anthropic direct
- **Auth**: Bearer token (any `crs_*` prefix, or `dev-master-key` for dev)
- **Build**: Hono + TypeScript, Vite, Cloudflare Workers runtime

---

## Configuration

```ini
# .dev.vars
OPENAI_API_KEY=gsk-your-key
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
MASTER_KEY=dev-master-key
```

---

## Development

```bash
npm run build
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/init    # first run
curl http://localhost:3000/api/health
```

---

## GitHub

https://github.com/harbz07/claude-cognitive-stack

---

## Real Embeddings — Supabase pgvector

### Stack
```
soul-os.cc → Hono/Workers backend → Supabase (pgvector) → OpenAI text-embedding-3-small
```

### Embedding Backend (priority order)
| Priority | Backend | Dimensions | Trigger |
|----------|---------|-----------|---------|
| 1 | OpenAI `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` set |
| 2 | Cloudflare AI `bge-small-en-v1.5` | 384 | `AI` binding present |
| 3 | Keyword fallback | — | Always available |

### Supabase Setup (one-time SQL)
```sql
create extension if not exists vector;

create table if not exists documents (
  id        uuid primary key default gen_random_uuid(),
  content   text not null,
  metadata  jsonb,
  embedding vector(1536)
);

create or replace function match_documents(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language plpgsql as $$
begin
  return query
  select d.id, d.content, d.metadata,
         1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

### New Environment Variables
```ini
# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Optional: separate embed endpoint (defaults to standard OpenAI)
OPENAI_EMBED_BASE_URL=https://api.openai.com/v1
```

### New API Endpoints

**`POST /api/ingest`** — Embed and store a document
```json
{
  "content": "The thalamus threshold is 0.72 for default loadout.",
  "type": "semantic",
  "scope": "project",
  "project_id": "proj_abc",
  "tags": ["config", "thalamus"]
}
```
Response includes `embedding_backend`, `embedding_dims`, `vector_id`.

**`POST /api/search`** — Semantic search
```json
{
  "query": "what is the thalamus threshold?",
  "matchThreshold": 0.72,
  "matchCount": 5,
  "project_id": "proj_abc"
}
```
Response: `{ matches: [{ id, content, metadata, similarity }], backend }`.

### Flow: Memory Write → pgvector Sync
```
Consolidation Worker
  ├── LLM summarize transcript → key_facts[]
  ├── embed(summary)   → OpenAI 1536-dim
  ├── D1.insertMemoryItem()      (keyword fallback always written)
  └── Supabase.insert()          (pgvector, if configured)

RAG Stage 3 (knowledge_graph)
  ├── if queryEmbedding + Supabase → match_documents RPC (cosine)
  └── else → D1 keyword scoring (always available)
```

---

## Configuration

```ini
# .dev.vars
OPENAI_API_KEY=gsk-your-key
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
MASTER_KEY=dev-master-key
```

---

## Pending / Future Work

- [ ] Streaming responses via SSE (`/api/chat/stream`)
- [ ] Document indexing for `project_docs` RAG source (chunking pipeline)
- [ ] Cross-session identity graph (user_profile table)
- [ ] Memory audit endpoints (`/api/memory/:id/provenance`)
- [ ] Multi-agent loadouts (planner + executor sharing memory scope)
- [ ] Explainability endpoints (why was this memory retrieved?)
- [ ] Claude-specific prompt tuning for Anthropic backend

---

**Version**: 3.0 — Real embeddings + Supabase pgvector  
**Last Updated**: 2026-02-21  
**Spec Reference**: https://www.basecampgrounds.com
