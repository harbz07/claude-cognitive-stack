// ============================================================
// MAIN ENTRY — Cognitive Runtime Service
// ============================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'
import { authMiddleware, optionalAuth } from './middleware/auth'
import { chat } from './routes/chat'
import { memory } from './routes/memory'
import { traces } from './routes/traces'
import { projects } from './routes/projects'
import { StorageService } from './services/storage'

export type Env = {
  DB: D1Database
  AI: Ai                       // Cloudflare AI binding (embeddings)
  ANTHROPIC_API_KEY: string    // optional — Anthropic direct
  OPENAI_API_KEY: string       // OpenAI-compatible (Genspark proxy)
  OPENAI_BASE_URL: string      // e.g. https://www.genspark.ai/api/llm_proxy/v1
  MASTER_KEY: string
  ENVIRONMENT: string
}

type Variables = {
  user_id: string
  rate_limit_rpm: number
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// ── Global Middleware ─────────────────────────────────────────
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}))

app.use('/api/*', logger())

// ── Health / Meta ─────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'Cognitive Runtime Service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    db: !!c.env.DB,
    model_configured: !!(c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY),
    backend: c.env.OPENAI_API_KEY ? 'openai-compatible' : c.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none',
  })
})

// ── DB Init (auto-migrate on first call) ─────────────────────
app.get('/api/init', async (c) => {
  if (!c.env.DB) return c.json({ error: 'No DB binding' }, 503)
  const storage = new StorageService(c.env.DB)
  await storage.initialize()
  return c.json({ initialized: true, message: 'Schema created + skills seeded.' })
})

// ── API Routes (authenticated) ────────────────────────────────
app.use('/api/chat/*', authMiddleware)
app.use('/api/memory/*', authMiddleware)
app.use('/api/traces/*', authMiddleware)
app.use('/api/projects/*', authMiddleware)

app.route('/api/chat', chat)
app.route('/api/memory', memory)
app.route('/api/traces', traces)
app.route('/api/projects', projects)

// ── Skills list (public) ──────────────────────────────────────
app.get('/api/skills', async (c) => {
  const { BUILTIN_SKILLS } = await import('./config')
  return c.json({
    skills: BUILTIN_SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      priority: s.priority,
      token_budget: s.token_budget,
      enabled: s.enabled,
    })),
  })
})

// ── Loadouts list (public) ────────────────────────────────────
app.get('/api/loadouts', async (c) => {
  const { LOADOUT_MAP } = await import('./config')
  return c.json({ loadouts: Object.values(LOADOUT_MAP) })
})

// ── Favicon ───────────────────────────────────────────────────
app.get('/favicon.ico', (c) => {
  // Return a minimal brain emoji SVG as favicon
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🧠</text></svg>`
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  })
})

// ── Static files ──────────────────────────────────────────────
app.use('/static/*', serveStatic({ root: './' }))

// ── Frontend: Silly Tavern (multi-agent chat) ────────────────
app.get('/', (c) => {
  return c.html(getTavernHTML())
})

app.get('/tavern', (c) => {
  return c.html(getTavernHTML())
})

// ── Legacy Dashboard ─────────────────────────────────────────
app.get('/legacy', (c) => {
  return c.html(getLegacyDashboardHTML())
})

app.get('/playground', (c) => {
  return c.html(getLegacyDashboardHTML())
})

function getTavernHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Soul OS — Silly Tavern</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/htm@3/dist/htm.umd.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <link rel="stylesheet" href="/static/tavern.css"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</head>
<body>
  <div id="root"></div>
  <script src="/static/tavern.js"></script>
</body>
</html>`
}

function getLegacyDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Cognitive Runtime Service</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <style>
    :root { --accent: #6366f1; --accent-dark: #4f46e5; }
    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); }
    .accent-glow { box-shadow: 0 0 20px rgba(99,102,241,0.3); }
    pre { white-space: pre-wrap; word-break: break-word; }
    .tab-btn.active { background: var(--accent); color: white; }
    .tab-btn { background: rgba(255,255,255,0.05); color: #94a3b8; }
    .score-bar { height: 6px; border-radius: 3px; background: rgba(99,102,241,0.8); }
    @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .pulse { animation: pulse-dot 1.5s ease-in-out infinite; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
    .msg-user { background: rgba(99,102,241,0.15); border-left: 3px solid #6366f1; }
    .msg-assistant { background: rgba(255,255,255,0.04); border-left: 3px solid #10b981; }
    .token-bar { background: linear-gradient(90deg, #6366f1, #10b981); height: 4px; border-radius: 2px; }
    .skill-badge { background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.4); }
    .memory-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
    .stage-done { color: #10b981; }
    .stage-line { border-left: 2px solid rgba(99,102,241,0.3); padding-left: 12px; margin-left: 6px; }
    textarea:focus, input:focus { outline: 2px solid var(--accent); outline-offset: 0; }
  </style>
</head>
<body class="min-h-screen">

<!-- Top Nav -->
<nav class="glass border-b border-white/5 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
  <div class="flex items-center gap-3">
    <div class="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
      <i class="fas fa-brain text-indigo-400 text-sm"></i>
    </div>
    <div>
      <span class="font-bold text-white text-sm">Cognitive Runtime</span>
      <span class="text-xs text-slate-500 ml-2">v1.0</span>
    </div>
  </div>
  <div class="flex items-center gap-4">
    <div id="health-dot" class="w-2 h-2 rounded-full bg-slate-600 pulse" title="Checking..."></div>
    <span id="health-label" class="text-xs text-slate-500">connecting...</span>
    <div class="flex gap-1">
      <input id="api-key-input" type="password" placeholder="API Key (crs_...)" 
             class="glass text-xs px-3 py-1.5 rounded text-slate-300 w-40 placeholder-slate-600"/>
      <button onclick="saveApiKey()" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition">Save</button>
    </div>
  </div>
</nav>

<!-- Main Layout -->
<div class="flex h-[calc(100vh-52px)]">
  <!-- Sidebar -->
  <aside class="glass border-r border-white/5 w-52 flex-shrink-0 flex flex-col">
    <div class="p-3 space-y-1">
      <button onclick="showTab('chat')" class="tab-btn w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2 active" id="tab-chat">
        <i class="fas fa-comments w-4"></i> Chat
      </button>
      <button onclick="showTab('memory')" class="tab-btn w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2" id="tab-memory">
        <i class="fas fa-memory w-4"></i> Memory
      </button>
      <button onclick="showTab('traces')" class="tab-btn w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2" id="tab-traces">
        <i class="fas fa-route w-4"></i> Traces
      </button>
      <button onclick="showTab('inspector')" class="tab-btn w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2" id="tab-inspector">
        <i class="fas fa-microscope w-4"></i> Inspector
      </button>
      <button onclick="showTab('skills')" class="tab-btn w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2" id="tab-skills">
        <i class="fas fa-puzzle-piece w-4"></i> Skills
      </button>
      <button onclick="showTab('api')" class="tab-btn w-full text-left px-3 py-2 rounded text-sm transition flex items-center gap-2" id="tab-api">
        <i class="fas fa-book w-4"></i> API Docs
      </button>
    </div>

    <!-- Session Info -->
    <div class="mt-auto p-3 border-t border-white/5">
      <div class="text-xs text-slate-600 mb-1">Session</div>
      <div id="session-id-display" class="text-xs text-slate-500 font-mono break-all">—</div>
      <button onclick="newSession()" class="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition">
        <i class="fas fa-plus mr-1"></i>New Session
      </button>
    </div>
  </aside>

  <!-- Content Area -->
  <main class="flex-1 overflow-hidden flex flex-col">

    <!-- CHAT TAB -->
    <div id="view-chat" class="flex flex-col h-full">
      <!-- Token Usage Bar -->
      <div class="glass border-b border-white/5 px-4 py-2 flex items-center gap-4">
        <div class="flex-1">
          <div class="flex justify-between text-xs text-slate-500 mb-1">
            <span>Token Usage</span>
            <span id="token-summary">—</span>
          </div>
          <div class="bg-white/5 rounded-full h-1.5">
            <div id="token-bar-fill" class="token-bar" style="width:0%"></div>
          </div>
        </div>
        <div class="flex gap-3 text-xs text-slate-500">
          <span id="skills-active-display">No skills</span>
          <select id="loadout-select" class="glass text-xs px-2 py-1 rounded text-slate-300 cursor-pointer">
            <option value="default">Default</option>
            <option value="fast">Fast</option>
            <option value="deep">Deep</option>
          </select>
        </div>
      </div>
      
      <!-- Messages -->
      <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-3">
        <div class="text-center text-slate-600 text-sm mt-8">
          <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
            <i class="fas fa-brain text-indigo-500 text-lg"></i>
          </div>
          <div class="font-medium text-slate-400">Cognitive Runtime Service</div>
          <div class="text-xs mt-1">Claude is the cortex. This service is the nervous system.</div>
          <div class="text-xs mt-3 text-slate-600">Set your API key, then start chatting. Memory persists across turns.</div>
        </div>
      </div>

      <!-- Input Area -->
      <div class="glass border-t border-white/5 p-4">
        <div class="flex gap-3">
          <textarea id="chat-input" 
            placeholder="Message the cognitive runtime..." 
            class="glass flex-1 px-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-600 resize-none"
            rows="2"
            onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendMessage()}"></textarea>
          <button onclick="sendMessage()" id="send-btn"
            class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 rounded-lg text-sm font-medium transition accent-glow flex items-center gap-2">
            <i class="fas fa-paper-plane"></i>
          </button>
        </div>
        <div class="flex gap-2 mt-2 text-xs text-slate-600">
          <span>Shift+Enter for newline</span>
          <span>•</span>
          <span id="last-trace-id">No trace yet</span>
        </div>
      </div>
    </div>

    <!-- MEMORY TAB -->
    <div id="view-memory" class="hidden flex-col h-full">
      <div class="glass border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <div class="flex gap-2">
          <select id="memory-scope-filter" class="glass text-xs px-2 py-1 rounded text-slate-300" onchange="loadMemory()">
            <option value="">All Scopes</option>
            <option value="session">Session</option>
            <option value="project">Project</option>
            <option value="global">Global</option>
          </select>
          <select id="memory-type-filter" class="glass text-xs px-2 py-1 rounded text-slate-300" onchange="loadMemory()">
            <option value="">All Types</option>
            <option value="episodic">Episodic</option>
            <option value="semantic">Semantic</option>
            <option value="summary">Summary</option>
          </select>
          <button onclick="loadMemory()" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition">Refresh</button>
        </div>
        <div id="memory-stats" class="text-xs text-slate-500">Loading stats...</div>
      </div>
      <div id="memory-list" class="flex-1 overflow-y-auto p-4">
        <div class="text-center text-slate-600 text-sm mt-8">Click Refresh to load memories</div>
      </div>
    </div>

    <!-- TRACES TAB -->
    <div id="view-traces" class="hidden flex-col h-full">
      <div class="glass border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <div class="flex gap-2">
          <button onclick="loadTraces()" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition">Refresh</button>
          <button onclick="triggerConsolidation()" class="text-xs bg-emerald-600/50 hover:bg-emerald-600 text-white px-3 py-1 rounded transition">Run Consolidation</button>
        </div>
        <div id="traces-count" class="text-xs text-slate-500">—</div>
      </div>
      <div id="traces-list" class="flex-1 overflow-y-auto p-4 space-y-2">
        <div class="text-center text-slate-600 text-sm mt-8">Click Refresh to load traces</div>
      </div>
    </div>

    <!-- INSPECTOR TAB -->
    <div id="view-inspector" class="hidden flex-col h-full">
      <div class="glass border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <input id="inspector-trace-id" type="text" placeholder="Paste trace_id..." 
               class="glass flex-1 px-3 py-1.5 rounded text-sm text-white placeholder-slate-600"/>
        <button onclick="inspectTrace()" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded transition">Inspect</button>
      </div>
      <div id="inspector-content" class="flex-1 overflow-y-auto p-4">
        <div class="text-center text-slate-600 text-sm mt-8">
          <i class="fas fa-microscope text-2xl mb-3 block text-slate-700"></i>
          Enter a trace ID to inspect the full cognitive pipeline
        </div>
      </div>
    </div>

    <!-- SKILLS TAB -->
    <div id="view-skills" class="hidden flex-col h-full">
      <div class="glass border-b border-white/5 px-4 py-3">
        <button onclick="loadSkills()" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition">Load Skills</button>
      </div>
      <div id="skills-list" class="flex-1 overflow-y-auto p-4">
        <div class="text-center text-slate-600 text-sm mt-8">Click Load Skills to view registered skill packages</div>
      </div>
    </div>

    <!-- API DOCS TAB -->
    <div id="view-api" class="hidden flex-col h-full overflow-y-auto">
      <div class="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="text-lg font-bold text-white mb-1">API Reference</h2>
          <p class="text-sm text-slate-400">Cognitive Runtime Service — REST API</p>
        </div>
        
        <div class="glass rounded-lg p-4">
          <div class="font-mono text-xs text-indigo-400 mb-2">Authentication</div>
          <pre class="text-xs text-slate-300">Authorization: Bearer &lt;api_key&gt;
X-API-Key: &lt;api_key&gt;

# Demo: any key starting with "crs_" works
# e.g. crs_demo123</pre>
        </div>

        ${renderApiEndpoint('POST', '/api/chat', 'Send a message through the cognitive pipeline', `{
  "message": "string (required)",
  "session_id": "uuid (optional, creates new if omitted)",
  "project_id": "string (optional)",
  "loadout_id": "default|fast|deep (default: default)",
  "skill_hints": ["code", "research"] (optional),
  "metadata": {} (optional)
}`, `{
  "trace_id": "uuid",
  "session_id": "uuid",
  "response": "Claude's response",
  "model": "claude-opus-4-5",
  "token_breakdown": {
    "system": 450, "context": 820,
    "history": 340, "user_message": 12, "total": 1622
  },
  "skills_activated": ["General Assistant", "Code Assistant"],
  "memory_items_retrieved": 3,
  "consolidation_queued": false
}`)}

        ${renderApiEndpoint('GET', '/api/chat/sessions', 'List user sessions', null, `[{ "session_id": "...", "tokens_used": 1234, ... }]`)}
        ${renderApiEndpoint('GET', '/api/memory', 'Query memory items', 'Query: scope, type, session_id, limit', `{ "items": [...], "count": 5 }`)}
        ${renderApiEndpoint('POST', '/api/memory', 'Store a memory item manually', `{
  "content": "User prefers TypeScript",
  "type": "semantic",
  "scope": "global",
  "tags": ["preference"],
  "confidence": 0.9
}`, `{ "id": "uuid", "created": true }`)}
        ${renderApiEndpoint('GET', '/api/traces', 'List request traces (observability)', 'Query: session_id, limit', `{ "traces": [...], "count": N }`)}
        ${renderApiEndpoint('GET', '/api/traces/:id', 'Full trace with Thalamus scores, dropped context, token breakdown', null, 'Full trace object')}
        ${renderApiEndpoint('POST', '/api/traces/consolidate', 'Manually trigger consolidation worker', null, `{ "processed": 2, "errors": 0 }`)}
        ${renderApiEndpoint('GET', '/api/health', 'Health check', null, `{ "status": "ok", "db": true, "model_configured": true }`)}
        ${renderApiEndpoint('GET', '/api/init', 'Initialize DB schema (run once)', null, `{ "initialized": true }`)}
      </div>
    </div>

  </main>
</div>

<script>
// ── State ─────────────────────────────────────────────────────
let state = {
  apiKey: localStorage.getItem('crs_api_key') || 'crs_demo',
  sessionId: localStorage.getItem('crs_session_id') || null,
  isStreaming: false,
  lastTraceId: null,
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('api-key-input').value = state.apiKey
  updateSessionDisplay()
  checkHealth()
  setInterval(checkHealth, 30000)
})

function saveApiKey() {
  state.apiKey = document.getElementById('api-key-input').value.trim()
  localStorage.setItem('crs_api_key', state.apiKey)
  showToast('API key saved')
}

function newSession() {
  state.sessionId = null
  localStorage.removeItem('crs_session_id')
  updateSessionDisplay()
  document.getElementById('chat-messages').innerHTML = \`
    <div class="text-center text-slate-600 text-sm mt-8">
      <i class="fas fa-circle-notch text-indigo-500 mb-3 text-2xl block"></i>
      New session started. Send a message to begin.
    </div>\`
  showToast('New session started')
}

function updateSessionDisplay() {
  const el = document.getElementById('session-id-display')
  el.textContent = state.sessionId ? state.sessionId.slice(0,16) + '...' : 'None (auto)'
}

// ── Health Check ──────────────────────────────────────────────
async function checkHealth() {
  try {
    const r = await fetch('/api/health')
    const d = await r.json()
    const dot = document.getElementById('health-dot')
    const label = document.getElementById('health-label')
    if (d.status === 'ok') {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400'
      label.textContent = d.model_configured ? 'Ready' : 'No API key'
      label.className = d.model_configured ? 'text-xs text-emerald-400' : 'text-xs text-yellow-400'
    }
  } catch {
    document.getElementById('health-dot').className = 'w-2 h-2 rounded-full bg-red-500 pulse'
    document.getElementById('health-label').textContent = 'offline'
  }
}

// ── Tab Navigation ────────────────────────────────────────────
function showTab(name) {
  ['chat','memory','traces','inspector','skills','api'].forEach(t => {
    document.getElementById('view-' + t).classList.add('hidden')
    document.getElementById('view-' + t).classList.remove('flex')
    document.getElementById('tab-' + t).classList.remove('active')
  })
  document.getElementById('view-' + name).classList.remove('hidden')
  document.getElementById('view-' + name).classList.add('flex')
  document.getElementById('tab-' + name).classList.add('active')
}

// ── Chat ──────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chat-input')
  const msg = input.value.trim()
  if (!msg || state.isStreaming) return

  state.isStreaming = true
  input.value = ''
  document.getElementById('send-btn').disabled = true
  document.getElementById('send-btn').innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>'

  // Add user message
  appendMessage('user', msg)

  // Add thinking indicator
  const thinkingId = 'thinking-' + Date.now()
  appendThinking(thinkingId)

  const loadoutId = document.getElementById('loadout-select').value

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.apiKey,
      },
      body: JSON.stringify({
        message: msg,
        session_id: state.sessionId || undefined,
        loadout_id: loadoutId,
        metadata: {},
      })
    })

    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error || 'Request failed')
    }

    const data = await r.json()

    // Update session
    if (data.session_id) {
      state.sessionId = data.session_id
      localStorage.setItem('crs_session_id', data.session_id)
      updateSessionDisplay()
    }

    // Remove thinking
    document.getElementById(thinkingId)?.remove()

    // Add response
    appendMessage('assistant', data.response, {
      skills: data.skills_activated,
      memory: data.memory_items_retrieved,
      tokens: data.token_breakdown,
      trace_id: data.trace_id,
      consolidation: data.consolidation_queued,
    })

    // Update trace
    state.lastTraceId = data.trace_id
    document.getElementById('last-trace-id').innerHTML = 
      \`<span class="cursor-pointer text-indigo-400 hover:text-indigo-300" onclick="inspectTraceId('\${data.trace_id}')">\${data.trace_id.slice(0,8)}...</span>\`

    // Update token bar
    if (data.token_breakdown) {
      const total = data.token_breakdown.total
      const pct = Math.min(100, (total / 8000) * 100)
      document.getElementById('token-bar-fill').style.width = pct + '%'
      document.getElementById('token-summary').textContent = 
        \`\${total} tokens (sys:\${data.token_breakdown.system} ctx:\${data.token_breakdown.context} hist:\${data.token_breakdown.history})\`
    }

    // Update skills
    if (data.skills_activated?.length) {
      document.getElementById('skills-active-display').textContent = data.skills_activated.join(', ')
    }

  } catch (err) {
    document.getElementById(thinkingId)?.remove()
    appendMessage('system', '⚠️ Error: ' + err.message)
  } finally {
    state.isStreaming = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('send-btn').innerHTML = '<i class="fas fa-paper-plane"></i>'
  }
}

function appendMessage(role, content, meta) {
  const container = document.getElementById('chat-messages')
  const div = document.createElement('div')
  const roleClass = role === 'user' ? 'msg-user' : role === 'assistant' ? 'msg-assistant' : 'glass'
  const roleIcon = role === 'user' ? '👤' : role === 'assistant' ? '🧠' : '⚙️'
  
  let metaHtml = ''
  if (meta) {
    const skillBadges = (meta.skills || []).map(s => 
      \`<span class="skill-badge text-xs px-1.5 py-0.5 rounded text-indigo-300">\${s}</span>\`
    ).join('')
    
    metaHtml = \`<div class="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/5">
      \${skillBadges}
      <span class="text-xs text-slate-600">\${meta.memory || 0} memories retrieved</span>
      \${meta.consolidation ? '<span class="text-xs text-amber-500"><i class="fas fa-layer-group mr-1"></i>consolidating</span>' : ''}
    </div>\`
  }

  div.className = \`\${roleClass} rounded-lg p-3\`
  div.innerHTML = \`
    <div class="flex items-start gap-2">
      <span class="text-base">\${roleIcon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-xs text-slate-500 mb-1">\${role === 'user' ? 'You' : role === 'assistant' ? 'Cognitive Runtime' : 'System'}</div>
        <div class="text-sm text-slate-200 leading-relaxed">\${escapeHtml(content).replace(/\\n/g,'<br>')}</div>
        \${metaHtml}
      </div>
    </div>\`

  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

function appendThinking(id) {
  const container = document.getElementById('chat-messages')
  const div = document.createElement('div')
  div.id = id
  div.className = 'glass rounded-lg p-3 msg-assistant'
  div.innerHTML = \`<div class="flex items-center gap-2 text-slate-400 text-sm">
    <i class="fas fa-brain text-indigo-400"></i>
    <span>Processing through cognitive pipeline...</span>
    <div class="flex gap-1">
      <div class="w-1.5 h-1.5 bg-indigo-400 rounded-full pulse"></div>
      <div class="w-1.5 h-1.5 bg-indigo-400 rounded-full pulse" style="animation-delay:0.3s"></div>
      <div class="w-1.5 h-1.5 bg-indigo-400 rounded-full pulse" style="animation-delay:0.6s"></div>
    </div>
  </div>\`
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

// ── Memory ────────────────────────────────────────────────────
async function loadMemory() {
  const scope = document.getElementById('memory-scope-filter').value
  const type = document.getElementById('memory-type-filter').value
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (type) params.set('type', type)
  if (state.sessionId) params.set('session_id', state.sessionId)
  params.set('limit', '30')

  const container = document.getElementById('memory-list')
  container.innerHTML = '<div class="text-slate-600 text-sm">Loading...</div>'

  try {
    const [memR, statsR] = await Promise.all([
      apiGet('/api/memory?' + params),
      apiGet('/api/memory/stats')
    ])

    // Stats
    const statsEl = document.getElementById('memory-stats')
    if (statsR.stats) {
      const total = statsR.stats.reduce((s, r) => s + (r.total || 0), 0)
      const totalTokens = statsR.stats.reduce((s, r) => s + (r.total_tokens || 0), 0)
      statsEl.textContent = \`\${total} items · \${totalTokens} tokens\`
    }

    if (!memR.items || memR.items.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-600 text-sm mt-8">No memories found for the selected filters.</div>'
      return
    }

    container.innerHTML = ''
    memR.items.forEach(item => {
      const card = document.createElement('div')
      card.className = 'memory-card rounded-lg p-3 mb-2'
      const decayColor = item.decay_score > 0.5 ? 'text-red-400' : item.decay_score > 0.2 ? 'text-yellow-400' : 'text-emerald-400'
      const typeColor = item.type === 'summary' ? 'text-purple-400' : item.type === 'semantic' ? 'text-blue-400' : 'text-slate-400'
      card.innerHTML = \`
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs px-1.5 py-0.5 rounded bg-white/5 \${typeColor}">\${item.type}</span>
            <span class="text-xs text-slate-600">\${item.scope}</span>
            \${(item.tags || []).map(t => \`<span class="text-xs text-indigo-400 bg-indigo-500/10 px-1.5 rounded">\${t}</span>\`).join('')}
          </div>
          <div class="flex items-center gap-2 text-xs flex-shrink-0">
            <span class="\${decayColor}">decay:\${(item.decay_score || 0).toFixed(2)}</span>
            <span class="text-slate-600">conf:\${(item.confidence || 0).toFixed(2)}</span>
            <button onclick="deleteMemory('\${item.id}')" class="text-red-400/50 hover:text-red-400 transition"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div class="text-sm text-slate-300">\${escapeHtml(item.content)}</div>
        <div class="text-xs text-slate-600 mt-1">\${new Date(item.created_at).toLocaleString()} · \${item.token_count || 0} tokens</div>
      \`
      container.appendChild(card)
    })
  } catch (err) {
    container.innerHTML = \`<div class="text-red-400 text-sm">\${err.message}</div>\`
  }
}

async function deleteMemory(id) {
  await apiDelete('/api/memory/' + id)
  await loadMemory()
  showToast('Memory deleted')
}

// ── Traces ────────────────────────────────────────────────────
async function loadTraces() {
  const params = state.sessionId ? '?session_id=' + state.sessionId : '?limit=20'
  const container = document.getElementById('traces-list')
  container.innerHTML = '<div class="text-slate-600 text-sm">Loading...</div>'

  try {
    const data = await apiGet('/api/traces' + params)
    document.getElementById('traces-count').textContent = (data.count || 0) + ' traces'

    if (!data.traces || data.traces.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-600 text-sm mt-8">No traces yet. Send a message first.</div>'
      return
    }

    container.innerHTML = ''
    data.traces.forEach(trace => {
      const card = document.createElement('div')
      card.className = 'glass rounded-lg p-3 cursor-pointer hover:border-indigo-500/30 transition'
      card.onclick = () => inspectTraceId(trace.trace_id)
      const tb = trace.token_breakdown || {}
      const error = trace.error
      card.innerHTML = \`
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full \${error ? 'bg-red-400' : 'bg-emerald-400'}"></span>
            <span class="font-mono text-xs text-indigo-400">\${trace.trace_id?.slice(0,12)}...</span>
          </div>
          <span class="text-xs text-slate-500">\${new Date(trace.request_at).toLocaleTimeString()}</span>
        </div>
        <div class="text-xs text-slate-500 flex gap-3">
          <span>tokens: \${tb.total || '—'}</span>
          <span>session: \${trace.session_id?.slice(0,8) || '—'}...</span>
          \${trace.consolidation_queued ? '<span class="text-amber-400">consolidated</span>' : ''}
          \${error ? \`<span class="text-red-400">error</span>\` : ''}
        </div>
      \`
      container.appendChild(card)
    })
  } catch (err) {
    container.innerHTML = \`<div class="text-red-400 text-sm">\${err.message}</div>\`
  }
}

async function triggerConsolidation() {
  try {
    const data = await apiPost('/api/traces/consolidate', {})
    showToast(\`Consolidation: \${data.processed} processed, \${data.errors} errors\`)
    await loadTraces()
  } catch (err) {
    showToast('Consolidation error: ' + err.message, true)
  }
}

// ── Inspector ─────────────────────────────────────────────────
function inspectTraceId(id) {
  document.getElementById('inspector-trace-id').value = id
  showTab('inspector')
  inspectTrace()
}

async function inspectTrace() {
  const traceId = document.getElementById('inspector-trace-id').value.trim()
  if (!traceId) return

  const container = document.getElementById('inspector-content')
  container.innerHTML = '<div class="text-slate-600 text-sm">Loading trace...</div>'

  try {
    const trace = await apiGet('/api/traces/' + traceId)
    container.innerHTML = renderTraceDetail(trace)
  } catch (err) {
    container.innerHTML = \`<div class="text-red-400 text-sm">Error: \${err.message}</div>\`
  }
}

function renderTraceDetail(trace) {
  const tb = trace.token_breakdown || {}
  const stages = (trace.stages || [])
  const dropped = (trace.dropped_context || [])
  const scored = (trace.thalamus_scores || [])
  
  const stageHtml = stages.map(s => \`
    <div class="stage-line mb-3">
      <div class="flex items-center gap-2 mb-1">
        <i class="fas fa-check-circle stage-done text-xs"></i>
        <span class="text-xs font-bold text-white">\${s.stage.toUpperCase()}</span>
        <span class="text-xs text-slate-600">\${s.duration_ms}ms</span>
      </div>
      <pre class="text-xs text-slate-400 bg-black/20 rounded p-2 overflow-x-auto">\${JSON.stringify(s.data, null, 2)}</pre>
    </div>
  \`).join('')

  const droppedHtml = dropped.length === 0 
    ? '<div class="text-xs text-slate-600">None dropped</div>'
    : dropped.map(d => \`
        <div class="flex items-center gap-2 text-xs py-1 border-b border-white/5">
          <i class="fas fa-times text-red-400"></i>
          <span class="text-slate-400 flex-1">\${d.label}</span>
          <span class="text-slate-600">\${d.reason}</span>
          <span class="text-red-400">\${(d.score || 0).toFixed(3)}</span>
        </div>
      \`).join('')

  const scoredHtml = scored.slice(0, 10).map(c => \`
    <div class="mb-2 text-xs">
      <div class="flex justify-between mb-0.5">
        <span class="text-slate-300">\${c.label}</span>
        <span class="text-indigo-400 font-mono">\${(c.scores?.final || 0).toFixed(3)}</span>
      </div>
      <div class="bg-white/5 rounded h-1.5">
        <div class="score-bar" style="width:\${Math.min(100,(c.scores?.final||0)*100)}%"></div>
      </div>
    </div>
  \`).join('')

  return \`
    <div class="space-y-4">
      <!-- Header -->
      <div class="glass rounded-lg p-4">
        <div class="font-mono text-sm text-indigo-400 mb-1">\${trace.trace_id}</div>
        <div class="text-xs text-slate-500 flex gap-4">
          <span>Session: \${trace.session_id?.slice(0,12)}...</span>
          <span>\${new Date(trace.request_at).toLocaleString()}</span>
          \${trace.error ? \`<span class="text-red-400">Error: \${trace.error}</span>\` : '<span class="text-emerald-400">Success</span>'}
        </div>
      </div>

      <!-- Token Breakdown -->
      <div class="glass rounded-lg p-4">
        <div class="text-xs font-bold text-white mb-3 flex items-center gap-2"><i class="fas fa-coins text-yellow-400"></i> Token Breakdown</div>
        <div class="grid grid-cols-4 gap-2">
          \${[['System', tb.system],['Context', tb.context],['History', tb.history],['User Msg', tb.user_message]].map(([k,v]) => \`
            <div class="bg-black/20 rounded p-2 text-center">
              <div class="text-xs text-slate-500">\${k}</div>
              <div class="text-sm font-mono text-white">\${v || 0}</div>
            </div>
          \`).join('')}
        </div>
        <div class="mt-2 text-xs text-slate-400 text-center">Total: <span class="text-white font-mono">\${tb.total || 0}</span> tokens</div>
      </div>

      <!-- Pipeline Stages -->
      <div class="glass rounded-lg p-4">
        <div class="text-xs font-bold text-white mb-3 flex items-center gap-2"><i class="fas fa-route text-indigo-400"></i> Pipeline Stages</div>
        \${stageHtml}
      </div>

      <!-- Thalamus Scores -->
      <div class="glass rounded-lg p-4">
        <div class="text-xs font-bold text-white mb-3 flex items-center gap-2"><i class="fas fa-chart-bar text-purple-400"></i> Thalamus Context Scores (top 10)</div>
        \${scoredHtml || '<div class="text-xs text-slate-600">No scored items</div>'}
      </div>

      <!-- Dropped Context -->
      <div class="glass rounded-lg p-4">
        <div class="text-xs font-bold text-white mb-3 flex items-center gap-2"><i class="fas fa-trash text-red-400"></i> Dropped Context (\${dropped.length})</div>
        \${droppedHtml}
      </div>
    </div>
  \`
}

// ── Skills ────────────────────────────────────────────────────
async function loadSkills() {
  const container = document.getElementById('skills-list')
  container.innerHTML = '<div class="text-slate-600 text-sm">Loading...</div>'
  try {
    const data = await apiGet('/api/skills')
    container.innerHTML = ''
    ;(data.skills || []).forEach(skill => {
      const card = document.createElement('div')
      card.className = 'glass rounded-lg p-4 mb-2'
      card.innerHTML = \`
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="font-medium text-white text-sm">\${skill.name}</span>
            <span class="text-xs text-indigo-400 font-mono">\${skill.id}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-600">priority: \${skill.priority}</span>
            <span class="text-xs text-slate-600">\${skill.token_budget} tokens</span>
            <span class="text-xs \${skill.enabled ? 'text-emerald-400' : 'text-red-400'}">\${skill.enabled ? 'active' : 'disabled'}</span>
          </div>
        </div>
      \`
      container.appendChild(card)
    })
  } catch (err) {
    container.innerHTML = \`<div class="text-red-400 text-sm">\${err.message}</div>\`
  }
}

// ── API Helpers ───────────────────────────────────────────────
function getHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.apiKey }
}

async function apiGet(path) {
  const r = await fetch(path, { headers: getHeaders() })
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText) }
  return r.json()
}

async function apiPost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: getHeaders(), body: JSON.stringify(body) })
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText) }
  return r.json()
}

async function apiDelete(path) {
  const r = await fetch(path, { method: 'DELETE', headers: getHeaders() })
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText) }
  return r.json()
}

// ── Utils ─────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(text || ''))
  return div.innerHTML
}

function showToast(msg, isError = false) {
  const toast = document.createElement('div')
  toast.className = \`fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg text-sm shadow-xl transition \${isError ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'}\`
  toast.textContent = msg
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}
</script>
</body>
</html>`
}

function renderApiEndpoint(method: string, path: string, desc: string, body: string | null, response: string): string {
  const methodColor = method === 'POST' ? 'text-emerald-400' : method === 'DELETE' ? 'text-red-400' : 'text-blue-400'
  return `
    <div class="glass rounded-lg p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="font-mono text-xs font-bold ${methodColor}">${method}</span>
        <span class="font-mono text-xs text-white">${path}</span>
      </div>
      <div class="text-xs text-slate-400 mb-2">${desc}</div>
      ${body ? `<div class="mb-2"><div class="text-xs text-slate-600 mb-1">Request:</div><pre class="text-xs text-slate-300 bg-black/30 rounded p-2 overflow-x-auto">${body}</pre></div>` : ''}
      <div><div class="text-xs text-slate-600 mb-1">Response:</div><pre class="text-xs text-slate-300 bg-black/30 rounded p-2 overflow-x-auto">${response}</pre></div>
    </div>`
}

export default app
