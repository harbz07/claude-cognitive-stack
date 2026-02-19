# 🧠 Cognitive Runtime Service

> Claude is the cortex. This service is the nervous system.

A full cognitive layer that sits between users and Claude — maintaining multi-layer memory, scoring context, assembling curated prompts, and consolidating intelligence across sessions.

## 🏗️ Architecture

```
Request → Gateway API → Cognitive Orchestrator → Claude API
                              ↕
                    Memory Service (L1/L2/L3)
                              ↕
                    Worker Service (Consolidation)
```

### Pipeline Stages (per request)

| Stage | Component | What it does |
|-------|-----------|--------------|
| 1 | **Ingest** | Store message, update L1 sliding window |
| 2 | **Router** | Activate skills, select memory scopes, choose model profile |
| 3 | **Retrieve** | Semantic + keyword search across L2/L3 memory |
| 4 | **Thalamus** | Score every context item, pack within token budgets |
| 5 | **Insula** | PII redaction, privacy directives, write permissions |
| 6 | **Assemble** | Build curated prompt (system + context + history + message) |
| 7 | **Generate** | Call Claude with assembled prompt |
| 8 | **Consolidate** | Queue background summarization & semantic extraction |

### Memory Layers

| Layer | Type | Scope | Managed by |
|-------|------|-------|------------|
| L1 | Sliding window | Session | In-request (Thalamus) |
| L2 | Episodic / Semantic | Session / Project / Global | RetrievalService |
| L3 | Summaries | Session | ConsolidationWorker |

### Thalamus Scoring Formula

```
final_score =
  0.35 × relevance       (keyword overlap)
+ 0.20 × recency         (exponential decay from last access)
+ 0.15 × scope_match     (session > project > global)
+ 0.10 × type_priority   (summary > semantic > episodic)
+ 0.10 × (1 - decay)     (age-based decay)
+ 0.10 × skill_weight    (tag-to-active-skill overlap)
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers (Edge) |
| Framework | Hono v4 + TypeScript |
| Storage | Cloudflare D1 (SQLite) |
| Build | Vite + @hono/vite-cloudflare-pages |
| Model | Claude (via Anthropic API) |
| Auth | API key / Bearer token |

## 📡 API Reference

### Base URL
```
https://your-deployment.pages.dev
```

### Authentication
```
Authorization: Bearer <api_key>
X-API-Key: <api_key>

# Demo: any key starting with "crs_" works without DB lookup
# Master key: set MASTER_KEY env var for dev access
```

### Endpoints

#### `POST /api/chat` — Main cognitive endpoint
```json
{
  "message": "Explain how the Thalamus scores context",
  "session_id": "uuid (optional)",
  "project_id": "my-project (optional)",
  "loadout_id": "default | fast | deep",
  "skill_hints": ["code", "research"],
  "metadata": {}
}
```
Response:
```json
{
  "trace_id": "uuid",
  "session_id": "uuid",
  "response": "Claude's response...",
  "model": "claude-opus-4-5",
  "token_breakdown": {
    "system": 450, "context": 820, "history": 340,
    "user_message": 12, "total": 1622, "budget_remaining": 426
  },
  "skills_activated": ["General Assistant", "Research Mode"],
  "memory_items_retrieved": 3,
  "consolidation_queued": false
}
```

#### `GET /api/chat/sessions` — List sessions
#### `GET /api/chat/sessions/:id` — Session detail
#### `DELETE /api/chat/sessions/:id` — Clear session

#### `POST /api/memory` — Store memory manually
```json
{
  "content": "User prefers TypeScript",
  "type": "episodic | semantic | summary",
  "scope": "session | project | global",
  "tags": ["preference"],
  "confidence": 0.9
}
```
#### `GET /api/memory` — Query memories (`?scope=&type=&limit=`)
#### `DELETE /api/memory/:id` — Delete memory item
#### `GET /api/memory/stats` — Memory statistics

#### `GET /api/traces` — List request traces
#### `GET /api/traces/:id` — Full trace (Thalamus scores, dropped context, token breakdown)
#### `GET /api/traces/session/:id` — All traces for a session
#### `POST /api/traces/consolidate` — Trigger consolidation worker

#### `GET /api/health` — Health check
#### `GET /api/init` — Initialize DB schema (run once)
#### `GET /api/skills` — List skill packages
#### `GET /api/loadouts` — List loadout configs

## ⚙️ Configuration

### Loadouts

| Loadout | Model | L1 Budget | L2 Budget | Use Case |
|---------|-------|-----------|-----------|----------|
| `default` | claude-opus-4-5 | 2000 | 3000 | General use |
| `fast` | claude-haiku-4-5 | 1000 | 1000 | Quick replies |
| `deep` | claude-opus-4-5 | 4000 | 8000 | Research / analysis |

### Skill Packages (auto-activated)

| Skill | Trigger | Priority |
|-------|---------|----------|
| `general` | Always | 0 |
| `code` | code, function, debug, typescript... | 10 |
| `research` | analyze, compare, explain, why... | 5 |
| `memory_aware` | remember, recall, earlier, before... | 15 |

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...     # Required for generation
MASTER_KEY=your-dev-key          # Dev bypass key
ENVIRONMENT=development
```

## 🚀 Development Setup

```bash
# 1. Clone and install
npm install

# 2. Set environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your ANTHROPIC_API_KEY

# 3. Build
npm run build

# 4. Start (with D1 local SQLite)
pm2 start ecosystem.config.cjs

# 5. Initialize DB
curl http://localhost:3000/api/init

# 6. Test
curl -H "Authorization: Bearer crs_demo" http://localhost:3000/api/health
```

## 🌐 Production Deployment (Cloudflare Pages)

```bash
# 1. Create D1 database
npx wrangler d1 create cognitive-runtime-production

# 2. Update wrangler.jsonc with database_id

# 3. Set secrets
npx wrangler pages secret put ANTHROPIC_API_KEY
npx wrangler pages secret put MASTER_KEY

# 4. Deploy
npm run deploy
```

## 📊 Data Models

### MemoryItem
```typescript
{
  id: string
  type: 'episodic' | 'semantic' | 'summary'
  scope: 'session' | 'project' | 'global'
  content: string
  embedding: number[] | null
  tags: string[]
  confidence: number    // 0..1
  decay_score: number   // 0..1 (higher = more decayed)
  provenance: { session_id, source }
  token_count: number
}
```

### SessionState (L1)
```typescript
{
  session_id: string
  token_budget: number
  sliding_window: SlidingWindowEntry[]
  running_state: { goals, active_skills, last_tool_results }
}
```

## 🔍 Observability

Every request creates a full `RequestTrace` in D1:
- **Thalamus scores** — every context candidate with all 6 scoring dimensions
- **Dropped context** — what was cut and why (budget exceeded / below threshold)
- **Token breakdown** — system / context / history / user / total
- **Stage timings** — ms per pipeline stage
- **Consolidation writes** — what got extracted to long-term memory

Query with: `GET /api/traces/:id` or browse in the Inspector tab of the dashboard.

## 🧭 Dashboard

The UI at `/` provides:
- **Chat** — Full conversational interface with skill indicators and token bars
- **Memory** — Browse/filter/delete L2/L3 memory items
- **Traces** — Request history with click-through to full pipeline inspection
- **Inspector** — Per-trace deep dive: Thalamus scores, dropped context, stage log
- **Skills** — View registered skill packages
- **API Docs** — Live reference

## 🔮 Next Steps

- [ ] Vector embeddings (OpenAI embeddings API or Cloudflare AI)
- [ ] Cross-session identity graphs
- [ ] Skill-scoped memory namespaces
- [ ] Multi-agent loadouts
- [ ] Memory audit + explainability endpoints
- [ ] Claude-specific prompt tuning per skill
- [ ] Streaming responses (SSE)
- [ ] Custom skill package API (CRUD)

## 📁 Source Structure

```
src/
├── types/index.ts          # All TypeScript contracts
├── config/index.ts         # Loadouts, skills, model map
├── services/
│   ├── storage.ts          # D1 storage layer
│   ├── router.ts           # Skill + scope routing
│   ├── retrieval.ts        # Memory retrieval + scoring
│   ├── thalamus.ts         # Context packing engine
│   ├── insula.ts           # Privacy + PII redaction
│   ├── model-adapter.ts    # Claude API abstraction
│   └── orchestrator.ts     # Full pipeline coordinator
├── workers/
│   └── consolidation.ts    # Background memory worker
├── routes/
│   ├── chat.ts             # /api/chat/*
│   ├── memory.ts           # /api/memory/*
│   └── traces.ts           # /api/traces/*
├── middleware/
│   └── auth.ts             # API key auth + rate limits
└── index.tsx               # App entry + dashboard HTML
```

---

*Built with Hono + Cloudflare Workers + D1 + Anthropic Claude*
