// ============================================================
// SOUL OS — Silly Tavern Multi-Agent Chat
// React 18 + htm (no build step)
// ============================================================

const html = htm.bind(React.createElement)
const { useState, useEffect, useRef, useCallback, useMemo } = React

// ── Default Agents ─────────────────────────────────────────────
const DEFAULT_AGENTS = [
  { id: 'sophia', name: 'Sophia', role: 'Philosopher', avatar: '\u{1F3DB}\uFE0F', color: '#6366f1',
    personality: 'You are Sophia, a thoughtful philosopher. Analyze ideas deeply, question assumptions, and draw from diverse philosophical traditions. Speak with wisdom and nuance.' },
  { id: 'jester', name: 'Jester', role: 'Comedian', avatar: '\u{1F3AD}', color: '#f59e0b',
    personality: 'You are Jester, a witty comedian. Find humor in everything, make clever observations, use wordplay and satire. Keep things light but surprisingly insightful.' },
  { id: 'contrarius', name: 'Contrarius', role: "Devil's Advocate", avatar: '\u{1F608}', color: '#ef4444',
    personality: "You are Contrarius, the devil's advocate. Challenge every assumption, poke holes in arguments, and present the strongest counterpoint. Be provocative but fair." },
  { id: 'newton', name: 'Newton', role: 'Scientist', avatar: '\u{1F52C}', color: '#10b981',
    personality: 'You are Newton, an empirical scientist. Approach everything with evidence and data. Demand proof, suggest experiments, and think in falsifiable hypotheses.' },
  { id: 'lyrica', name: 'Lyrica', role: 'Poet', avatar: '\u2728', color: '#ec4899',
    personality: 'You are Lyrica, a poetic soul. Express ideas through metaphor, imagery, and emotion. Find beauty in complexity and render abstract ideas into vivid language.' },
  { id: 'magnus', name: 'Magnus', role: 'Strategist', avatar: '\u265F\uFE0F', color: '#8b5cf6',
    personality: 'You are Magnus, a master strategist. Think in systems, second-order effects, and long-term consequences. Plan methodically and see the bigger picture.' },
  { id: 'chaos', name: 'Chaos', role: 'Wildcard', avatar: '\u{1F300}', color: '#06b6d4',
    personality: 'You are Chaos, the wildcard. Be unpredictable, creative, and lateral in your thinking. Make surprising connections, break patterns, and inject creative entropy.' },
]

const AVATAR_OPTIONS = [
  '\u{1F3DB}\uFE0F','\u{1F3AD}','\u{1F608}','\u{1F52C}','\u2728','\u265F\uFE0F','\u{1F300}',
  '\u{1F9E0}','\u{1F47B}','\u{1F916}','\u{1F525}','\u{1F308}','\u{1F48E}','\u26A1',
  '\u{1F33F}','\u{1F3B5}','\u{1FA90}','\u{1F30D}','\u{1F3AF}','\u{1F680}',
  '\u{1F9D9}','\u{1F47E}','\u{1F43A}','\u{1F985}','\u{1F419}','\u{1F40D}','\u{1F989}'
]

const COLOR_OPTIONS = [
  '#6366f1','#f59e0b','#ef4444','#10b981','#ec4899',
  '#8b5cf6','#06b6d4','#f97316','#84cc16','#14b8a6',
  '#e11d48','#7c3aed','#0ea5e9','#d946ef','#facc15'
]

const ROLE_OPTIONS = [
  'Philosopher','Comedian',"Devil's Advocate",'Scientist','Poet',
  'Strategist','Wildcard','Historian','Therapist','Engineer',
  'Artist','Detective','Mystic','Critic','Optimist'
]

const REACTIONS = ['\u{1F525}','\u{1F4AF}','\u{1F914}','\u{1F602}','\u{1F440}','\u2764\uFE0F']

// ── Utilities ──────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function escapeHtml(text) {
  const el = document.createElement('div')
  el.appendChild(document.createTextNode(text || ''))
  return el.innerHTML
}

function renderContent(text) {
  if (!text) return ''
  let s = escapeHtml(text)
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\n/g, '<br/>')
  return s
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// ── API Helpers ────────────────────────────────────────────────
function apiHeaders(apiKey) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
}

async function apiPost(path, body, apiKey) {
  const r = await fetch(path, { method: 'POST', headers: apiHeaders(apiKey), body: JSON.stringify(body) })
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })); throw new Error(e.error || r.statusText) }
  return r.json()
}

async function apiGet(path, apiKey) {
  const r = await fetch(path, { headers: apiHeaders(apiKey) })
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })); throw new Error(e.error || r.statusText) }
  return r.json()
}

// ── Build Context for Agent ────────────────────────────────────
function buildAgentContext(agent, allAgents, messages, currentMessage) {
  const otherActive = allAgents.filter(a => a.enabled && a.id !== agent.id)
  const recent = messages.slice(-30)

  let ctx = `[MULTI-AGENT CONVERSATION — You are ${agent.name}, the ${agent.role}]\n`
  ctx += `Personality: ${agent.personality}\n\n`

  if (otherActive.length > 0) {
    ctx += 'Other participants: ' + otherActive.map(a => `${a.name} (${a.role})`).join(', ') + '\n\n'
  }

  if (recent.length > 0) {
    ctx += '=== Recent Conversation ===\n'
    for (const msg of recent) {
      if (msg.role === 'user') {
        ctx += `User: ${msg.content}\n`
      } else if (msg.role === 'agent') {
        const a = allAgents.find(x => x.id === msg.agentId)
        ctx += `${a ? a.name : 'Agent'} (${a ? a.role : '?'}): ${msg.content}\n`
      }
    }
    ctx += '\n'
  }

  ctx += `=== Current Message ===\nUser: ${currentMessage}\n\n`
  ctx += `Respond in character as ${agent.name}. Be concise (2-4 paragraphs max) and engaging. Build on what others have said if relevant.`
  return ctx
}

// ── Components ─────────────────────────────────────────────────

function HealthDot({ apiKey }) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const r = await fetch('/api/health')
        const d = await r.json()
        if (mounted) setStatus(d.status === 'ok' ? (d.model_configured ? 'ok' : 'warn') : 'err')
      } catch { if (mounted) setStatus('err') }
    }
    check()
    const iv = setInterval(check, 30000)
    return () => { mounted = false; clearInterval(iv) }
  }, [apiKey])

  const labels = { ok: 'Connected', warn: 'No model key', err: 'Offline', checking: 'Checking...' }
  return html`<div className="flex items-center gap-2">
    <div className=${'health-dot ' + status} title=${labels[status]}></div>
    <span className="text-xxs text-muted">${labels[status]}</span>
  </div>`
}

function ThemeSelect({ value, onChange }) {
  const themes = [
    { id: 'neon', label: '\u{1F7E2} Neon' },
    { id: 'cyberpunk', label: '\u{1F7E0} Cyberpunk' },
    { id: 'haunted', label: '\u{1F47B} Haunted' },
    { id: 'midnight', label: '\u{1F319} Midnight' },
  ]
  return html`<select className="input-sm" value=${value}
    onChange=${e => onChange(e.target.value)}>
    ${themes.map(t => html`<option key=${t.id} value=${t.id}>${t.label}</option>`)}
  </select>`
}

function ModeSelect({ value, onChange }) {
  return html`<select className="input-sm" value=${value}
    onChange=${e => onChange(e.target.value)}>
    <option value="roundtable">\u{1F465} Roundtable</option>
    <option value="targeted">\u{1F3AF} Targeted</option>
    <option value="solo">\u{1F464} Solo</option>
  </select>`
}

function Toggle({ on, onChange, color }) {
  return html`<div className=${'toggle' + (on ? ' on' : '')}
    style=${{ '--primary': color || undefined }}
    onClick=${e => { e.stopPropagation(); onChange(!on) }}>
    <div className="toggle-knob"></div>
  </div>`
}

// ── Agent Edit Modal ───────────────────────────────────────────
function AgentEditModal({ agent, onSave, onClose }) {
  const [form, setForm] = useState({ ...agent })

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return html`<div className="modal-backdrop" onClick=${onClose}>
    <div className="modal-card" onClick=${e => e.stopPropagation()}>
      <h2>Edit ${form.name}</h2>

      <div className="modal-field">
        <label>Name</label>
        <input value=${form.name} onChange=${e => update('name', e.target.value)} />
      </div>

      <div className="modal-field">
        <label>Role</label>
        <select value=${form.role} onChange=${e => update('role', e.target.value)}>
          ${ROLE_OPTIONS.map(r => html`<option key=${r} value=${r}>${r}</option>`)}
        </select>
      </div>

      <div className="modal-field">
        <label>Personality</label>
        <textarea rows="4" value=${form.personality}
          onChange=${e => update('personality', e.target.value)} />
      </div>

      <div className="modal-field">
        <label>Avatar</label>
        <div className="avatar-picker">
          ${AVATAR_OPTIONS.map(a => html`
            <div key=${a} className=${'avatar-option' + (form.avatar === a ? ' selected' : '')}
              onClick=${() => update('avatar', a)}>${a}</div>
          `)}
        </div>
      </div>

      <div className="modal-field">
        <label>Color</label>
        <div className="color-picker">
          ${COLOR_OPTIONS.map(c => html`
            <div key=${c}
              className=${'color-option' + (form.color === c ? ' selected' : '')}
              style=${{ background: c, color: c }}
              onClick=${() => update('color', c)} />
          `)}
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn" onClick=${onClose}>Cancel</button>
        <button className="btn btn-primary" onClick=${() => { onSave(form); onClose() }}>Save</button>
      </div>
    </div>
  </div>`
}

// ── Agent Card ─────────────────────────────────────────────────
function AgentCard({ agent, onToggle, onEdit, isProcessing }) {
  return html`<div className=${'agent-card' + (agent.enabled ? ' active' : ' disabled')}>
    ${isProcessing && html`<div className="agent-processing" style=${{ background: agent.color }}></div>`}
    <div className="agent-avatar" style=${{ background: agent.color + '20', border: '1px solid ' + agent.color + '40' }}>
      ${agent.avatar}
    </div>
    <div className="agent-info">
      <div className="agent-name" style=${{ color: agent.enabled ? agent.color : undefined }}>${agent.name}</div>
      <div className="agent-role">${agent.role}</div>
    </div>
    <div className="agent-controls">
      <button className="btn-icon" onClick=${e => { e.stopPropagation(); onEdit(agent) }}
        title="Edit agent">
        <i className="fas fa-pen"></i>
      </button>
      <${Toggle} on=${agent.enabled} onChange=${() => onToggle(agent.id)} color=${agent.color} />
    </div>
  </div>`
}

// ── Agent Sidebar ──────────────────────────────────────────────
function AgentSidebar({ agents, onToggle, onEdit, onUpdate, processing, onNewSession }) {
  const enabledCount = agents.filter(a => a.enabled).length

  return html`<aside className="agent-sidebar">
    <div className="sidebar-header">
      <h3>\u{1F3AD} Agents (${enabledCount}/${agents.length})</h3>
      <button className="btn btn-sm" onClick=${onNewSession} title="Reset all sessions">
        <i className="fas fa-redo"></i>
      </button>
    </div>
    <div className="agent-list">
      ${agents.map(a => html`
        <${AgentCard} key=${a.id} agent=${a}
          onToggle=${onToggle} onEdit=${onEdit}
          isProcessing=${!!processing[a.id]} />
      `)}
    </div>
    <div className="sidebar-footer">
      <div className="text-xxs text-muted" style=${{ lineHeight: '1.4' }}>
        Toggle agents on/off. Each agent maintains its own memory session.
      </div>
    </div>
  </aside>`
}

// ── Message Bubble ─────────────────────────────────────────────
function MessageBubble({ message, agents }) {
  const [reactions, setReactions] = useState({})
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const agent = !isUser && !isSystem ? agents.find(a => a.id === message.agentId) : null

  const toggleReaction = (emoji) => {
    setReactions(prev => {
      const next = { ...prev }
      next[emoji] = !next[emoji]
      return next
    })
  }

  if (isSystem) {
    return html`<div className="message-bubble system-msg">
      <span>${message.content}</span>
    </div>`
  }

  const bubbleColor = isUser ? undefined : agent?.color
  const bubbleStyle = bubbleColor ? { borderLeft: '3px solid ' + bubbleColor } : { borderRight: '3px solid var(--primary)' }

  return html`<div className=${'message-bubble ' + (isUser ? 'user-msg' : 'agent-msg')} style=${bubbleStyle}>
    <div className="message-avatar"
      style=${{ background: (isUser ? 'var(--primary)' : (agent?.color || '#666')) + '20' }}>
      ${isUser ? '\u{1F464}' : (agent?.avatar || '\u{1F916}')}
    </div>
    <div className="message-meta">
      <div className="message-meta-header">
        <span className="message-sender" style=${{ color: isUser ? 'var(--primary)' : agent?.color }}>
          ${isUser ? 'You' : (agent?.name || 'Agent')}
        </span>
        ${agent && html`<span className="message-role-badge"
          style=${{ background: agent.color + '20', color: agent.color, border: '1px solid ' + agent.color + '30' }}>
          ${agent.role}
        </span>`}
        <span className="message-time">${formatTime(message.timestamp)}</span>
      </div>
      <div className="message-content" dangerouslySetInnerHTML=${{ __html: renderContent(message.content) }}></div>
      ${message.skills && message.skills.length > 0 && html`
        <div className="message-footer">
          ${message.skills.map(s => html`<span key=${s} className="message-skill-badge">${s}</span>`)}
          ${message.tokenBreakdown && html`<span className="text-xxs text-dim">${message.tokenBreakdown.total} tokens</span>`}
        </div>
      `}
      <div className="message-reaction-bar">
        ${REACTIONS.map(emoji => html`
          <button key=${emoji} className=${'reaction-btn' + (reactions[emoji] ? ' reacted' : '')}
            onClick=${() => toggleReaction(emoji)}>${emoji}</button>
        `)}
      </div>
    </div>
  </div>`
}

// ── Typing Indicator ───────────────────────────────────────────
function TypingIndicator({ agent }) {
  return html`<div className="typing-indicator">
    <span style=${{ fontSize: '14px' }}>${agent.avatar}</span>
    <div className="typing-dots">
      <div className="typing-dot" style=${{ background: agent.color }}></div>
      <div className="typing-dot" style=${{ background: agent.color }}></div>
      <div className="typing-dot" style=${{ background: agent.color }}></div>
    </div>
    <span className="typing-label">${agent.name} is thinking...</span>
  </div>`
}

// ── Welcome Screen ─────────────────────────────────────────────
function WelcomeScreen({ agents }) {
  return html`<div className="welcome-screen">
    <div className="welcome-icon">\u{1F3ED}</div>
    <div className="welcome-title">Soul OS \u2014 Silly Tavern</div>
    <div className="welcome-subtitle">
      A multi-agent conversation engine. Enable your agents, type a message,
      and watch them discuss, debate, and riff off each other.
    </div>
    <div className="welcome-agents">
      ${agents.filter(a => a.enabled).map(a => html`
        <div key=${a.id} className="welcome-agent-chip">
          <span>${a.avatar}</span>
          <span>${a.name}</span>
        </div>
      `)}
    </div>
    <div className="text-xxs text-dim" style=${{ marginTop: '12px' }}>
      Set your API key in the header, then send a message to begin.
    </div>
  </div>`
}

// ── Message List ───────────────────────────────────────────────
function MessageList({ messages, agents, processing }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, processing])

  const processingAgents = agents.filter(a => processing[a.id])

  if (messages.length === 0 && processingAgents.length === 0) {
    return html`<div className="chat-messages"><${WelcomeScreen} agents=${agents} /></div>`
  }

  return html`<div className="chat-messages">
    ${messages.map(msg => html`<${MessageBubble} key=${msg.id} message=${msg} agents=${agents} />`)}
    ${processingAgents.map(a => html`<${TypingIndicator} key=${a.id + '-typing'} agent=${a} />`)}
    <div ref=${bottomRef}></div>
  </div>`
}

// ── Chat Input ─────────────────────────────────────────────────
function ChatInput({ onSend, isDisabled, agents, mode, targetAgents, setTargetAgents }) {
  const [text, setText] = useState('')
  const textareaRef = useRef(null)

  const handleSend = () => {
    const msg = text.trim()
    if (!msg || isDisabled) return
    onSend(msg)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = '42px'
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e) => {
    setText(e.target.value)
    const ta = e.target
    ta.style.height = '42px'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }

  const toggleTarget = (agentId) => {
    setTargetAgents(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    )
  }

  const enabledAgents = agents.filter(a => a.enabled)
  const modeLabel = mode === 'roundtable' ? 'All agents respond' :
    mode === 'targeted' ? `${targetAgents.length} agent(s) targeted` : 'Pick one agent'

  return html`<div className="chat-input-area">
    ${mode === 'targeted' && html`
      <div className="chat-input-meta" style=${{ marginBottom: '8px' }}>
        ${enabledAgents.map(a => html`
          <div key=${a.id}
            className=${'agent-target-chip' + (targetAgents.includes(a.id) ? ' selected' : '')}
            style=${{ borderColor: targetAgents.includes(a.id) ? a.color + '60' : undefined }}
            onClick=${() => toggleTarget(a.id)}>
            <span>${a.avatar}</span> <span>${a.name}</span>
          </div>
        `)}
      </div>
    `}
    <div className="chat-input-row">
      <textarea
        ref=${textareaRef}
        value=${text}
        onInput=${handleInput}
        onKeyDown=${handleKeyDown}
        placeholder="Message the tavern..."
        rows="1"
        disabled=${isDisabled}
      />
      <button className="send-btn" onClick=${handleSend} disabled=${isDisabled || !text.trim()}>
        ${isDisabled
          ? html`<i className="fas fa-circle-notch spinner"></i>`
          : html`<i className="fas fa-paper-plane"></i>`
        }
      </button>
    </div>
    <div className="chat-input-meta">
      <span className="text-xxs text-dim">${modeLabel}</span>
      <span className="text-xxs text-dim">\u00B7</span>
      <span className="text-xxs text-dim">Shift+Enter for newline</span>
    </div>
  </div>`
}

// ── Context Panel ──────────────────────────────────────────────
function ContextPanel({ messages, agents, contextSummary, onRecap, isRecapping, show }) {
  const agentSessions = agents.filter(a => a.enabled && a.sessionId)
  const messageCount = messages.length
  const agentMsgCounts = {}
  messages.forEach(m => {
    if (m.role === 'agent' && m.agentId) {
      agentMsgCounts[m.agentId] = (agentMsgCounts[m.agentId] || 0) + 1
    }
  })

  return html`<div className=${'context-panel' + (show ? '' : ' collapsed')}>
    <div className="context-panel-header">
      <h3>\u{1F9E0} Context</h3>
      <span className="text-xxs text-muted">${messageCount} msgs</span>
    </div>
    <div className="context-panel-body">
      <div>
        <div className="flex items-center justify-between" style=${{ marginBottom: '6px' }}>
          <span className="text-xxs text-muted" style=${{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Summary</span>
          <button className="btn btn-sm" onClick=${onRecap} disabled=${isRecapping || messages.length < 2}>
            ${isRecapping ? html`<i className="fas fa-circle-notch spinner"></i>` : '\u{1F504}'} Recap
          </button>
        </div>
        <div className="context-summary-box">
          ${contextSummary || 'No summary yet. Send some messages, then hit Recap.'}
        </div>
      </div>

      <div>
        <div className="text-xxs text-muted" style=${{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
          Agent Activity
        </div>
        ${agents.filter(a => a.enabled).map(a => html`
          <div key=${a.id} className="context-agent-session" style=${{ marginBottom: '4px' }}>
            <span style=${{ fontSize: '14px' }}>${a.avatar}</span>
            <div style=${{ flex: 1, minWidth: 0 }}>
              <div className="text-xs" style=${{ color: a.color, fontWeight: 600 }}>${a.name}</div>
              <div className="session-id">${a.sessionId ? a.sessionId.slice(0, 16) + '...' : 'No session yet'}</div>
            </div>
            <span className="text-xxs text-dim">${agentMsgCounts[a.id] || 0} msgs</span>
          </div>
        `)}
      </div>

      ${messages.length > 0 && html`<div>
        <div className="text-xxs text-muted" style=${{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
          Topics Mentioned
        </div>
        <div className="flex flex-wrap gap-1">
          ${extractTopics(messages).map(t => html`
            <span key=${t} className="text-xxs"
              style=${{ padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              ${t}
            </span>
          `)}
        </div>
      </div>`}
    </div>
  </div>`
}

function extractTopics(messages) {
  const text = messages.map(m => m.content).join(' ').toLowerCase()
  const words = text.split(/\s+/).filter(w => w.length > 5)
  const freq = {}
  words.forEach(w => {
    const clean = w.replace(/[^a-z]/g, '')
    if (clean.length > 5) freq[clean] = (freq[clean] || 0) + 1
  })
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w)
}

// ── Header ─────────────────────────────────────────────────────
function Header({ theme, setTheme, mode, setMode, apiKey, setApiKey, showContext, setShowContext }) {
  const [keyInput, setKeyInput] = useState(apiKey)
  const [saved, setSaved] = useState(false)

  const saveKey = () => {
    const k = keyInput.trim()
    if (k) {
      setApiKey(k)
      localStorage.setItem('crs_api_key', k)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return html`<header className="tavern-header">
    <div className="logo">
      <div className="logo-icon">\u{1F3ED}</div>
      <span className="logo-text">Soul OS</span>
      <span className="logo-sub">Silly Tavern</span>
    </div>
    <div className="header-controls">
      <${ThemeSelect} value=${theme} onChange=${setTheme} />
      <${ModeSelect} value=${mode} onChange=${setMode} />
      <div className="flex items-center gap-1">
        <input className="input-sm" type="password" placeholder="API Key (crs_...)"
          value=${keyInput} onChange=${e => setKeyInput(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && saveKey()}
          style=${{ width: '140px' }} />
        <button className="btn btn-sm btn-primary" onClick=${saveKey}>
          ${saved ? '\u2713' : 'Save'}
        </button>
      </div>
      <${HealthDot} apiKey=${apiKey} />
      <button className=${'btn-icon' + (showContext ? '' : '')}
        onClick=${() => setShowContext(p => !p)} title="Toggle context panel">
        <i className=${'fas fa-' + (showContext ? 'chevron-right' : 'brain')}></i>
      </button>
    </div>
  </header>`
}

// ── Main App ───────────────────────────────────────────────────
function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('tavern_theme') || 'neon')
  const [agents, setAgents] = useState(() => {
    try {
      const saved = localStorage.getItem('tavern_agents')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return DEFAULT_AGENTS.map(a => ({ ...a, enabled: true, sessionId: null }))
  })
  const [messages, setMessages] = useState([])
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('crs_api_key') || 'crs_demo')
  const [processing, setProcessing] = useState({})
  const [mode, setMode] = useState('roundtable')
  const [targetAgents, setTargetAgents] = useState([])
  const [showContext, setShowContext] = useState(true)
  const [contextSummary, setContextSummary] = useState('')
  const [isRecapping, setIsRecapping] = useState(false)
  const [editingAgent, setEditingAgent] = useState(null)
  const abortRef = useRef(null)

  // Persist theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tavern_theme', theme)
  }, [theme])

  // Persist agents (but not sessionId)
  useEffect(() => {
    const toSave = agents.map(({ sessionId, ...rest }) => rest)
    localStorage.setItem('tavern_agents', JSON.stringify(toSave))
  }, [agents])

  const isAnyProcessing = Object.values(processing).some(Boolean)

  const addMessage = useCallback((msg) => {
    setMessages(prev => [...prev, { ...msg, id: msg.id || generateId(), timestamp: msg.timestamp || new Date().toISOString() }])
  }, [])

  const updateAgent = useCallback((agentId, updates) => {
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, ...updates } : a))
  }, [])

  const toggleAgent = useCallback((agentId) => {
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, enabled: !a.enabled } : a))
  }, [])

  const handleEditSave = useCallback((updated) => {
    setAgents(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
  }, [])

  const resetSessions = useCallback(() => {
    setAgents(prev => prev.map(a => ({ ...a, sessionId: null })))
    setMessages([])
    setContextSummary('')
    setProcessing({})
  }, [])

  // ── Send Message ─────────────────────────────────────────────
  const sendMessage = useCallback(async (userMessage) => {
    addMessage({ role: 'user', content: userMessage })

    const enabledAgents = agents.filter(a => a.enabled)
    let respondingAgents

    if (mode === 'roundtable') {
      respondingAgents = enabledAgents
    } else if (mode === 'targeted') {
      respondingAgents = enabledAgents.filter(a => targetAgents.includes(a.id))
      if (respondingAgents.length === 0) respondingAgents = enabledAgents.slice(0, 1)
    } else {
      respondingAgents = enabledAgents.slice(0, 1)
    }

    const currentMessages = [...messages, { role: 'user', content: userMessage }]

    for (const agent of respondingAgents) {
      setProcessing(prev => ({ ...prev, [agent.id]: true }))

      try {
        const contextMsg = buildAgentContext(agent, agents, currentMessages, userMessage)

        const data = await apiPost('/api/chat', {
          message: contextMsg,
          session_id: agent.sessionId || undefined,
          loadout_id: 'default',
          metadata: { agent_id: agent.id, agent_role: agent.role, multi_agent: true },
        }, apiKey)

        if (data.session_id && !agent.sessionId) {
          updateAgent(agent.id, { sessionId: data.session_id })
        }

        const agentMsg = {
          role: 'agent',
          agentId: agent.id,
          content: data.response,
          traceId: data.trace_id,
          tokenBreakdown: data.token_breakdown,
          skills: data.skills_activated,
        }
        addMessage(agentMsg)
        currentMessages.push(agentMsg)

      } catch (err) {
        addMessage({
          role: 'system',
          content: `${agent.name} error: ${err.message}`,
        })
      }

      setProcessing(prev => ({ ...prev, [agent.id]: false }))
    }
  }, [agents, messages, mode, targetAgents, apiKey, addMessage, updateAgent])

  // ── Recap ────────────────────────────────────────────────────
  const generateRecap = useCallback(async () => {
    if (messages.length < 2) return
    setIsRecapping(true)

    const recentMsgs = messages.slice(-40)
    let transcript = 'Summarize this multi-agent conversation in 3-5 bullet points:\n\n'
    for (const m of recentMsgs) {
      if (m.role === 'user') transcript += `User: ${m.content}\n`
      else if (m.role === 'agent') {
        const a = agents.find(x => x.id === m.agentId)
        transcript += `${a?.name || 'Agent'}: ${m.content}\n`
      }
    }
    transcript += '\nProvide a concise summary with key points, areas of agreement/disagreement, and unresolved questions.'

    try {
      const data = await apiPost('/api/chat', {
        message: transcript,
        loadout_id: 'fast',
        metadata: { recap: true },
      }, apiKey)
      setContextSummary(data.response)
    } catch (err) {
      setContextSummary('Failed to generate recap: ' + err.message)
    }

    setIsRecapping(false)
  }, [messages, agents, apiKey])

  return html`
    <${Header}
      theme=${theme} setTheme=${setTheme}
      mode=${mode} setMode=${setMode}
      apiKey=${apiKey} setApiKey=${setApiKey}
      showContext=${showContext} setShowContext=${setShowContext} />
    <div className="tavern-layout">
      <${AgentSidebar}
        agents=${agents}
        onToggle=${toggleAgent}
        onEdit=${setEditingAgent}
        onUpdate=${handleEditSave}
        processing=${processing}
        onNewSession=${resetSessions} />
      <div className="chat-area">
        <div className="chat-header">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">
              ${agents.filter(a => a.enabled).length} active agents
            </span>
            <span className="text-xxs text-dim">\u00B7</span>
            <span className="text-xxs text-dim">${messages.length} messages</span>
          </div>
          <div className="flex items-center gap-2">
            ${messages.length > 0 && html`
              <button className="btn btn-sm btn-danger" onClick=${resetSessions}>
                <i className="fas fa-trash" style=${{ marginRight: '4px' }}></i> Clear
              </button>
            `}
          </div>
        </div>
        <${MessageList} messages=${messages} agents=${agents} processing=${processing} />
        <${ChatInput}
          onSend=${sendMessage}
          isDisabled=${isAnyProcessing}
          agents=${agents}
          mode=${mode}
          targetAgents=${targetAgents}
          setTargetAgents=${setTargetAgents} />
      </div>
      <${ContextPanel}
        messages=${messages}
        agents=${agents}
        contextSummary=${contextSummary}
        onRecap=${generateRecap}
        isRecapping=${isRecapping}
        show=${showContext} />
    </div>
    ${editingAgent && html`<${AgentEditModal}
      agent=${editingAgent}
      onSave=${handleEditSave}
      onClose=${() => setEditingAgent(null)} />`}
  `
}

// ── Mount ──────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`)
