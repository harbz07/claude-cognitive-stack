/* ============================================================
   SOUL OS — Tavern Mode
   Multi-agent chat with shared context and persona management
   ============================================================ */

const AGENT_PRESETS = [
  {
    id: 'oracle', name: 'Oracle', emoji: '\u{1F52E}', color: '#a855f7',
    role: 'Wise Advisor',
    persona: 'You are Oracle, a wise and contemplative advisor. Speak with measured authority, drawing on deep knowledge. Reference historical parallels and philosophical frameworks. Your tone is calm, authoritative, and slightly mystical. Keep responses focused and insightful.',
    enabled: true,
  },
  {
    id: 'jester', name: 'Jester', emoji: '\u{1F0CF}', color: '#22c55e',
    role: 'Comedian',
    persona: 'You are Jester, a quick-witted comedian who finds humor in everything. Use wordplay, pop culture references, and unexpected analogies. Despite the humor, your insights are surprisingly sharp. Keep it fun but substantive.',
    enabled: true,
  },
  {
    id: 'advocate', name: 'Advocate', emoji: '\u{1F608}', color: '#ef4444',
    role: "Devil's Advocate",
    persona: "You are Devil's Advocate. Challenge assumptions, poke holes in arguments, and present contrarian viewpoints. You're not mean, but relentless in questioning. Start with 'But have you considered...' or 'The problem with that is...' when appropriate.",
    enabled: false,
  },
  {
    id: 'analyst', name: 'Analyst', emoji: '\u{1F52C}', color: '#3b82f6',
    role: 'Data Analyst',
    persona: 'You are Analyst, a precise, data-driven thinker. Break problems into components, use structured reasoning, cite evidence. Prefer bullet points, numbered lists, and clear frameworks. Qualify claims with confidence levels.',
    enabled: false,
  },
  {
    id: 'muse', name: 'Muse', emoji: '\u{1F3A8}', color: '#ec4899',
    role: 'Creative Thinker',
    persona: 'You are Muse, a creative and artistic thinker. Approach problems through metaphor, storytelling, and imagination. See connections others miss and express ideas through vivid imagery. Enthusiastic and slightly dreamy.',
    enabled: false,
  },
  {
    id: 'coder', name: 'Coder', emoji: '\u{1F4BB}', color: '#06b6d4',
    role: 'Programmer',
    persona: 'You are Coder, an expert programmer and systems architect. Think in algorithms, data structures, and system design. Provide code examples when relevant, suggest optimizations, think about edge cases. Appreciate elegance in solutions.',
    enabled: false,
  },
  {
    id: 'dreamer', name: 'Dreamer', emoji: '\u{1F30C}', color: '#f59e0b',
    role: 'Visionary',
    persona: "You are Dreamer, a visionary who thinks in grand, ambitious ideas. You're not constrained by current limitations. Imagine what could be, propose wild innovations, and inspire others. Optimistic and forward-looking.",
    enabled: false,
  },
];

// ── State ─────────────────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem('tavern_api_key') || 'crs_demo',
  sessionId: localStorage.getItem('tavern_session_id') || null,
  agents: JSON.parse(localStorage.getItem('tavern_agents') || 'null') || structuredClone(AGENT_PRESETS),
  messages: [],
  theme: localStorage.getItem('tavern_theme') || 'neon',
  targetAgent: 'all',
  loadout: 'default',
  isProcessing: false,
  contextTopics: [],
  contextStats: { totalTokens: 0, messageCount: 0, agentCalls: 0 },
  recapText: '',
  settingsOpen: false,
  editingAgent: null,
  modalOpen: false,
};

function saveState() {
  localStorage.setItem('tavern_api_key', state.apiKey);
  localStorage.setItem('tavern_session_id', state.sessionId || '');
  localStorage.setItem('tavern_agents', JSON.stringify(state.agents));
  localStorage.setItem('tavern_theme', state.theme);
}

// ── Initialize ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(state.theme);
  renderAgentList();
  renderContextPanel();
  renderTargetSelector();
  renderMessages();
  updateSessionDisplay();

  document.getElementById('api-key-input').value = state.apiKey;
  document.getElementById('loadout-select').value = state.loadout;

  checkHealth();
  setInterval(checkHealth, 30000);

  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('input', autoResizeTextarea);
});

function autoResizeTextarea(e) {
  const ta = e.target;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

// ── Theme ─────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  saveState();
  const sel = document.getElementById('theme-select');
  if (sel) sel.value = theme;
}

// ── Health Check ──────────────────────────────────────────────
async function checkHealth() {
  const dot = document.getElementById('health-dot');
  const label = document.getElementById('health-label');
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    if (d.status === 'ok') {
      dot.className = 'health-dot ok';
      label.textContent = d.model_configured ? 'Connected' : 'No model key';
    }
  } catch {
    dot.className = 'health-dot err';
    label.textContent = 'Offline';
  }
}

// ── API Key ───────────────────────────────────────────────────
function saveApiKey() {
  state.apiKey = document.getElementById('api-key-input').value.trim();
  saveState();
  toast('API key saved', 'success');
}

// ── Session ───────────────────────────────────────────────────
function newSession() {
  state.sessionId = null;
  state.messages = [];
  state.contextTopics = [];
  state.contextStats = { totalTokens: 0, messageCount: 0, agentCalls: 0 };
  state.recapText = '';
  saveState();
  updateSessionDisplay();
  renderMessages();
  renderContextPanel();
  toast('New session started', 'info');
}

function updateSessionDisplay() {
  const el = document.getElementById('session-id-display');
  el.textContent = state.sessionId ? state.sessionId.slice(0, 18) + '...' : 'None (auto-created)';
}

// ── Agent Management ──────────────────────────────────────────
function renderAgentList() {
  const list = document.getElementById('agent-list');
  list.innerHTML = '';
  state.agents.forEach((agent, idx) => {
    const card = document.createElement('div');
    card.className = `agent-card ${agent.enabled ? 'active' : 'disabled'}`;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `${agent.name} - ${agent.role} - ${agent.enabled ? 'enabled' : 'disabled'}`);
    card.innerHTML = `
      <div class="agent-avatar" style="background:${agent.color}22">
        <span>${agent.emoji}</span>
      </div>
      <div class="agent-info" data-edit="${idx}" style="cursor:pointer" title="Click to edit">
        <div class="agent-name" style="color:${agent.color}">${esc(agent.name)}</div>
        <div class="agent-role">${esc(agent.role)}</div>
      </div>
      <div class="agent-toggle ${agent.enabled ? 'on' : ''}" data-toggle="${idx}"
           role="switch" aria-checked="${agent.enabled}" aria-label="Toggle ${agent.name}"
           tabindex="0"></div>
    `;
    card.querySelector('[data-toggle]').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAgent(idx);
    });
    card.querySelector('[data-toggle]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAgent(idx); }
    });
    card.querySelector('[data-edit]').addEventListener('click', () => openAgentEditor(idx));
    list.appendChild(card);
  });
  renderTargetSelector();
}

function toggleAgent(idx) {
  state.agents[idx].enabled = !state.agents[idx].enabled;
  saveState();
  renderAgentList();
  renderContextPanel();
}

function getEnabledAgents() {
  return state.agents.filter(a => a.enabled);
}

// ── Agent Editor Modal ────────────────────────────────────────
function openAgentEditor(idx) {
  state.editingAgent = idx;
  const agent = state.agents[idx];
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h2>${agent.emoji} Edit ${esc(agent.name)}</h2>
        <button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label for="edit-name">Name</label>
          <input id="edit-name" class="input" value="${esc(agent.name)}" maxlength="20"/>
        </div>
        <div class="field">
          <label for="edit-emoji">Emoji Avatar</label>
          <input id="edit-emoji" class="input" value="${agent.emoji}" maxlength="4"/>
        </div>
        <div class="field">
          <label for="edit-role">Role</label>
          <input id="edit-role" class="input" value="${esc(agent.role)}" maxlength="40"/>
        </div>
        <div class="field">
          <label for="edit-color">Color</label>
          <input id="edit-color" type="color" class="input" value="${agent.color}" style="height:36px;padding:2px"/>
        </div>
        <div class="field">
          <label for="edit-persona">Persona (system prompt)</label>
          <textarea id="edit-persona" class="input" rows="5">${esc(agent.persona)}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="resetAgentPreset(${idx})">Reset to Default</button>
        <button class="btn btn-primary" onclick="saveAgentEdit()">Save</button>
      </div>
    </div>
  `;
  overlay.style.display = 'flex';
}

function saveAgentEdit() {
  const idx = state.editingAgent;
  if (idx === null) return;
  state.agents[idx].name = document.getElementById('edit-name').value.trim() || state.agents[idx].name;
  state.agents[idx].emoji = document.getElementById('edit-emoji').value || state.agents[idx].emoji;
  state.agents[idx].role = document.getElementById('edit-role').value.trim() || state.agents[idx].role;
  state.agents[idx].color = document.getElementById('edit-color').value;
  state.agents[idx].persona = document.getElementById('edit-persona').value.trim() || state.agents[idx].persona;
  saveState();
  closeModal();
  renderAgentList();
  toast('Agent updated', 'success');
}

function resetAgentPreset(idx) {
  if (AGENT_PRESETS[idx]) {
    state.agents[idx] = structuredClone(AGENT_PRESETS[idx]);
    state.agents[idx].enabled = state.agents[idx].enabled;
    saveState();
    closeModal();
    renderAgentList();
    toast('Agent reset to default', 'info');
  }
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  state.editingAgent = null;
}

// ── Target Agent Selector ─────────────────────────────────────
function renderTargetSelector() {
  const container = document.getElementById('target-selector');
  const enabled = getEnabledAgents();
  let html = `<button class="target-option ${state.targetAgent === 'all' ? 'active' : ''}"
                      onclick="setTarget('all')" aria-label="Send to all agents">All (${enabled.length})</button>`;
  enabled.forEach(a => {
    html += `<button class="target-option ${state.targetAgent === a.id ? 'active' : ''}"
                     onclick="setTarget('${a.id}')" aria-label="Send to ${esc(a.name)}"
                     style="${state.targetAgent === a.id ? 'background:' + a.color : ''}">${a.emoji}</button>`;
  });
  container.innerHTML = html;
}

function setTarget(id) {
  state.targetAgent = id;
  renderTargetSelector();
}

// ── Message Rendering ─────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (state.messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">\u{1F9E0}</div>
        <h2>Soul OS &mdash; Tavern Mode</h2>
        <p>Multi-agent conversations with shared context. Enable agents in the sidebar, type a message, and watch the tavern come alive.</p>
        <p style="margin-top:12px;font-size:11px;color:var(--text-muted)">Shift+Enter for newline &middot; Pick agents or send to all</p>
      </div>`;
    return;
  }
  container.innerHTML = '';
  state.messages.forEach(msg => {
    container.appendChild(createMessageEl(msg));
  });
  container.scrollTop = container.scrollHeight;
}

function createMessageEl(msg) {
  const div = document.createElement('div');
  const isUser = msg.role === 'user';
  div.className = `message ${isUser ? 'from-user' : 'from-agent'}`;

  const agentColor = msg.agentColor || 'var(--agent-user)';
  const avatarBg = isUser ? 'var(--accent-dim)' : `${agentColor}22`;

  let metaHtml = '';
  if (msg.meta) {
    const badges = (msg.meta.skills || []).map(s => `<span class="skill-badge">${esc(s)}</span>`).join('');
    metaHtml = `<div class="message-meta">
      ${badges}
      ${msg.meta.memory ? `<span class="skill-badge">${msg.meta.memory} memories</span>` : ''}
    </div>`;
  }

  const contentHtml = formatContent(msg.content);

  div.innerHTML = `
    <div class="message-avatar" style="background:${avatarBg}">${msg.emoji || (isUser ? '\u{1F464}' : '\u{1F916}')}</div>
    <div class="message-body">
      <div class="message-header">
        <span class="agent-label" style="color:${agentColor}">${esc(msg.sender)}</span>
        <span class="msg-time">${msg.time || ''}</span>
      </div>
      <div class="message-content">${contentHtml}</div>
      ${metaHtml}
    </div>
  `;
  return div;
}

function formatContent(text) {
  let html = esc(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function appendThinking(agentName, agentEmoji, agentColor) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'thinking-indicator';
  div.id = 'thinking-' + agentName;
  div.innerHTML = `
    <div class="message-avatar" style="background:${agentColor}22">${agentEmoji}</div>
    <div style="font-size:12px;color:var(--text-muted)">
      <span style="color:${agentColor};font-weight:600">${esc(agentName)}</span> is thinking...
    </div>
    <div class="thinking-dots"><span></span><span></span><span></span></div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeThinking(agentName) {
  const el = document.getElementById('thinking-' + agentName);
  if (el) el.remove();
}

// ── Send Message ──────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg || state.isProcessing) return;

  state.isProcessing = true;
  input.value = '';
  input.style.height = 'auto';
  updateSendButton(true);

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  state.messages.push({
    role: 'user',
    sender: 'You',
    emoji: '\u{1F464}',
    agentColor: 'var(--agent-user)',
    content: msg,
    time: now,
  });
  renderMessages();
  state.contextStats.messageCount++;
  extractTopics(msg);

  const enabled = getEnabledAgents();
  let targets;
  if (state.targetAgent === 'all') {
    targets = enabled;
  } else {
    const specific = enabled.find(a => a.id === state.targetAgent);
    targets = specific ? [specific] : enabled;
  }

  if (targets.length === 0) {
    state.messages.push({
      role: 'system', sender: 'System', emoji: '\u{2699}\u{FE0F}',
      agentColor: 'var(--warning)', content: 'No agents enabled. Toggle agents on in the sidebar.',
      time: now,
    });
    renderMessages();
    state.isProcessing = false;
    updateSendButton(false);
    return;
  }

  const activeAgentNames = enabled.map(a => a.name);

  for (const agent of targets) {
    const thinkEl = appendThinking(agent.name, agent.emoji, agent.color);
    try {
      const data = await callAgent(msg, agent, activeAgentNames);
      removeThinking(agent.name);

      const agentMsg = {
        role: 'agent',
        sender: agent.name,
        emoji: agent.emoji,
        agentColor: agent.color,
        content: data.response,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        meta: {
          skills: data.skills_activated,
          memory: data.memory_items_retrieved,
          tokens: data.token_breakdown,
          traceId: data.trace_id,
        },
      };
      state.messages.push(agentMsg);
      renderMessages();

      if (data.session_id && !state.sessionId) {
        state.sessionId = data.session_id;
        saveState();
        updateSessionDisplay();
      }
      if (data.token_breakdown) {
        state.contextStats.totalTokens = data.token_breakdown.total;
        updateTokenMeter(data.token_breakdown);
      }
      state.contextStats.agentCalls++;
      extractTopics(data.response);
      renderContextPanel();

    } catch (err) {
      removeThinking(agent.name);
      state.messages.push({
        role: 'system', sender: 'System', emoji: '\u{26A0}\u{FE0F}',
        agentColor: 'var(--danger)',
        content: `Error from ${agent.name}: ${err.message}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      renderMessages();
    }
  }

  state.isProcessing = false;
  updateSendButton(false);
  saveState();
}

async function callAgent(userMessage, agent, activeAgentNames) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + state.apiKey,
    },
    body: JSON.stringify({
      message: userMessage,
      session_id: state.sessionId || undefined,
      loadout_id: state.loadout,
      metadata: {
        agent_name: agent.name,
        agent_persona: agent.persona,
        active_agents: activeAgentNames,
      },
    }),
  });

  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json();
}

function updateSendButton(loading) {
  const btn = document.getElementById('send-btn');
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="thinking-dots" style="gap:2px"><span></span><span></span><span></span></span>'
    : '\u{27A4}';
}

// ── Token Meter ───────────────────────────────────────────────
function updateTokenMeter(breakdown) {
  const pct = Math.min(100, (breakdown.total / 8000) * 100);
  document.getElementById('token-meter-fill').style.width = pct + '%';
  document.getElementById('token-summary').textContent =
    `${breakdown.total} tokens (sys:${breakdown.system} ctx:${breakdown.context} hist:${breakdown.history})`;
}

// ── Context Panel ─────────────────────────────────────────────
function renderContextPanel() {
  const topicsEl = document.getElementById('context-topics');
  const statsEl = document.getElementById('context-stats');
  const agentsEl = document.getElementById('context-agents');

  if (state.contextTopics.length === 0) {
    topicsEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">Topics will appear as you chat...</div>';
  } else {
    topicsEl.innerHTML = state.contextTopics.slice(-12).map(t =>
      `<div class="context-topic">${esc(t)}</div>`
    ).join('');
  }

  statsEl.innerHTML = `
    <div class="context-stat"><span class="label">Messages</span><span class="value">${state.contextStats.messageCount}</span></div>
    <div class="context-stat"><span class="label">Agent Calls</span><span class="value">${state.contextStats.agentCalls}</span></div>
    <div class="context-stat"><span class="label">Last Token Count</span><span class="value">${state.contextStats.totalTokens}</span></div>
    <div class="context-stat"><span class="label">Session</span><span class="value">${state.sessionId ? state.sessionId.slice(0, 10) + '...' : 'none'}</span></div>
  `;

  const enabled = getEnabledAgents();
  agentsEl.innerHTML = enabled.map(a =>
    `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px">
      <span style="color:${a.color}">${a.emoji}</span>
      <span style="color:${a.color};font-weight:500">${esc(a.name)}</span>
      <span style="color:var(--text-muted);font-size:10px">${esc(a.role)}</span>
    </div>`
  ).join('');
}

function extractTopics(text) {
  const words = text.split(/\s+/);
  const candidates = [];
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i].replace(/[^a-zA-Z]/g, '');
    if (w.length > 5 && w[0] === w[0].toUpperCase()) {
      candidates.push(w);
    }
  }

  const phrases = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  candidates.push(...phrases);

  const unique = [...new Set(candidates)].slice(0, 3);
  unique.forEach(t => {
    if (!state.contextTopics.includes(t) && state.contextTopics.length < 20) {
      state.contextTopics.push(t);
    }
  });
}

// ── Recap ─────────────────────────────────────────────────────
async function generateRecap() {
  const recapEl = document.getElementById('recap-content');
  if (state.messages.length < 2) {
    recapEl.textContent = 'Not enough conversation to recap yet.';
    return;
  }
  recapEl.innerHTML = '<span style="color:var(--text-muted)">Generating recap...</span>';

  const summaryRequest = state.messages.slice(-20).map(m =>
    `${m.sender}: ${m.content.slice(0, 200)}`
  ).join('\n');

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.apiKey,
      },
      body: JSON.stringify({
        message: `Summarize this multi-agent conversation in 3-5 bullet points. Focus on key insights, decisions, and interesting disagreements:\n\n${summaryRequest}`,
        session_id: state.sessionId || undefined,
        loadout_id: 'fast',
        metadata: { agent_name: 'Recap', agent_persona: 'You are a concise summarizer. Output only bullet points.' },
      }),
    });
    if (!r.ok) throw new Error('Recap failed');
    const data = await r.json();
    state.recapText = data.response;
    recapEl.textContent = data.response;
  } catch (err) {
    recapEl.textContent = 'Failed to generate recap: ' + err.message;
  }
}

// ── Settings Drawer ───────────────────────────────────────────
function toggleSettings() {
  const drawer = document.getElementById('settings-drawer');
  state.settingsOpen = !state.settingsOpen;
  drawer.classList.toggle('open', state.settingsOpen);
}

// ── Loadout Change ────────────────────────────────────────────
function changeLoadout(val) {
  state.loadout = val;
}

// ── Mobile Toggles ────────────────────────────────────────────
function toggleMobileSidebar() {
  document.querySelector('.agent-sidebar').classList.toggle('mobile-open');
  document.querySelector('.context-panel').classList.remove('mobile-open');
}

function toggleMobileContext() {
  document.querySelector('.context-panel').classList.toggle('mobile-open');
  document.querySelector('.agent-sidebar').classList.remove('mobile-open');
}

// ── Utilities ─────────────────────────────────────────────────
function esc(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    if (state.settingsOpen) toggleSettings();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    document.getElementById('chat-input').focus();
  }
});
