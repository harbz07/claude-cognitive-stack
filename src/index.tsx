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

// ── Frontend Dashboard ────────────────────────────────────────
app.get('/', (c) => {
  return c.html(getDashboardHTML())
})

app.get('/playground', (c) => {
  return c.html(getDashboardHTML())
})

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="neon">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Soul OS — Tavern Mode</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/static/tavern.css"/>
</head>
<body>

<div class="tavern-layout">

  <!-- ── Top Bar ──────────────────────────────────────────── -->
  <header class="topbar" role="banner">
    <div class="topbar-brand">
      <div class="logo">\u{1F9E0}</div>
      <span class="brand-text">Soul OS</span>
      <span class="brand-sub">Tavern Mode</span>
    </div>
    <div class="topbar-controls">
      <button class="mobile-toggle" onclick="toggleMobileSidebar()" aria-label="Toggle agents">\u{2630}</button>
      <button class="mobile-toggle" onclick="toggleMobileContext()" aria-label="Toggle context">\u{1F4CB}</button>
      <div class="health-dot" id="health-dot" title="Connection status"></div>
      <span id="health-label" style="font-size:11px;color:var(--text-muted)">connecting...</span>
      <select id="theme-select" class="select" onchange="applyTheme(this.value)" aria-label="Theme" style="width:120px">
        <option value="neon">Neon Nights</option>
        <option value="cyberpunk">Cyberpunk</option>
        <option value="terminal">Haunted Terminal</option>
        <option value="midnight">Midnight Classic</option>
      </select>
      <div class="key-group">
        <input id="api-key-input" type="password" class="input" placeholder="API Key (crs_...)" style="width:150px;font-size:11px" aria-label="API Key"/>
        <button class="btn btn-primary" onclick="saveApiKey()">Save</button>
      </div>
      <button class="btn btn-ghost" onclick="toggleSettings()" aria-label="Settings">\u{2699}\u{FE0F}</button>
    </div>
  </header>

  <!-- ── Agent Sidebar ────────────────────────────────────── -->
  <aside class="agent-sidebar" role="complementary" aria-label="Agent management">
    <div class="sidebar-header">
      <h3>Agents</h3>
      <span style="font-size:11px;color:var(--text-muted)" id="agent-count-label">0 active</span>
    </div>
    <div class="agent-list" id="agent-list" role="list" aria-label="Agent list"></div>
    <div class="sidebar-footer">
      <div class="session-info">Session</div>
      <div class="session-id" id="session-id-display">None (auto-created)</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-ghost" onclick="newSession()" style="flex:1">New Session</button>
        <select id="loadout-select" class="select" onchange="changeLoadout(this.value)" style="flex:1" aria-label="Loadout">
          <option value="default">Default</option>
          <option value="fast">Fast</option>
          <option value="deep">Deep</option>
        </select>
      </div>
    </div>
  </aside>

  <!-- ── Chat Panel ───────────────────────────────────────── -->
  <main class="chat-panel" role="main">
    <div class="chat-toolbar">
      <div class="token-meter">
        <div class="token-meter-label">
          <span>Token Usage</span>
          <span id="token-summary">&mdash;</span>
        </div>
        <div class="token-meter-bar">
          <div class="token-meter-fill" id="token-meter-fill"></div>
        </div>
      </div>
      <div id="target-selector" class="target-selector" role="radiogroup" aria-label="Target agent"></div>
    </div>

    <div class="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>

    <div class="chat-input-area">
      <div class="chat-input-row">
        <textarea id="chat-input" placeholder="Message the tavern..." rows="1" aria-label="Chat message input"></textarea>
        <button id="send-btn" class="btn btn-primary send-btn" onclick="sendMessage()" aria-label="Send message">\u{27A4}</button>
      </div>
      <div class="chat-input-hints">
        <span>Shift+Enter for newline &middot; Ctrl+/ to focus &middot; Esc to close modals</span>
        <span id="last-trace-id" style="cursor:pointer;color:var(--accent)"></span>
      </div>
    </div>
  </main>

  <!-- ── Context Panel ────────────────────────────────────── -->
  <aside class="context-panel" role="complementary" aria-label="Context and memory">
    <div class="context-header">
      <h3>Context</h3>
      <button class="btn btn-ghost" onclick="generateRecap()" title="Generate conversation recap">Recap</button>
    </div>
    <div class="context-body">
      <div class="context-section">
        <h4>\u{1F3AF} Active Agents</h4>
        <div id="context-agents"></div>
      </div>
      <div class="context-section">
        <h4>\u{1F4AC} Topics</h4>
        <div id="context-topics"></div>
      </div>
      <div class="context-section">
        <h4>\u{1F4CA} Stats</h4>
        <div id="context-stats"></div>
      </div>
      <div class="context-section">
        <h4>\u{1F4DD} Recap</h4>
        <div class="recap-content" id="recap-content" style="font-size:11px;color:var(--text-muted)">
          Send a few messages, then click Recap to summarize the conversation.
        </div>
      </div>
    </div>
  </aside>

</div>

<!-- ── Modal Overlay ──────────────────────────────────────── -->
<div id="modal-overlay" class="modal-overlay" style="display:none" role="dialog" aria-modal="true"></div>

<!-- ── Settings Drawer ────────────────────────────────────── -->
<div id="settings-drawer" class="settings-drawer" role="dialog" aria-label="Settings">
  <div class="drawer-head">
    <h3 style="font-size:14px;font-weight:600">Settings</h3>
    <button class="modal-close" onclick="toggleSettings()" aria-label="Close settings">&times;</button>
  </div>
  <div class="drawer-body">
    <div class="field">
      <label>API Key</label>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Any key starting with "crs_" works for demo mode.</p>
    </div>
    <div class="field">
      <label>API Endpoints</label>
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.8;font-family:monospace">
        POST /api/chat — Send message<br/>
        GET /api/chat/sessions — List sessions<br/>
        GET /api/memory — Query memories<br/>
        POST /api/memory — Store memory<br/>
        GET /api/traces — List traces<br/>
        GET /api/traces/:id — Inspect trace<br/>
        POST /api/traces/consolidate — Run consolidation<br/>
        GET /api/health — Health check<br/>
        GET /api/init — Initialize DB schema
      </div>
    </div>
    <div class="field">
      <label>Multi-Agent Notes</label>
      <p style="font-size:11px;color:var(--text-muted);line-height:1.6">
        Agents share the same session context. Each agent's response is tagged with their name in the conversation history, so subsequent agents can reference what others said. Toggle agents on/off in the sidebar. Click an agent's name to customize their persona.
      </p>
    </div>
    <div class="field">
      <label>Keyboard Shortcuts</label>
      <div style="font-size:11px;color:var(--text-secondary);line-height:2">
        <kbd style="background:var(--bg-surface);padding:2px 6px;border-radius:3px;border:1px solid var(--border)">Enter</kbd> Send message<br/>
        <kbd style="background:var(--bg-surface);padding:2px 6px;border-radius:3px;border:1px solid var(--border)">Shift+Enter</kbd> New line<br/>
        <kbd style="background:var(--bg-surface);padding:2px 6px;border-radius:3px;border:1px solid var(--border)">Ctrl+/</kbd> Focus input<br/>
        <kbd style="background:var(--bg-surface);padding:2px 6px;border-radius:3px;border:1px solid var(--border)">Esc</kbd> Close modals
      </div>
    </div>
  </div>
</div>

<script src="/static/tavern.js"></script>
</body>
</html>`
}

export default app
