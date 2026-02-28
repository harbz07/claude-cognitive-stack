import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)

const LS = {
  theme: 'soul_tavern_theme',
  settings: 'soul_tavern_settings_v1',
  agents: 'soul_tavern_agents_v1',
  messages: 'soul_tavern_messages_v1',
  memory: 'soul_tavern_memory_v1',
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s) } catch { return fallback }
}

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key)
    return raw == null ? initialValue : safeJsonParse(raw, initialValue)
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue]
}

function shortId(id) {
  if (!id) return '—'
  return String(id).replace(/^proj_/, 'proj_').slice(0, 12) + '…'
}

function nowIso() { return new Date().toISOString() }

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)) }

function estimateTokensRough(text) {
  // Rough heuristic: 1 token ≈ 4 chars in English
  return Math.ceil((text || '').length / 4)
}

function defaultAgents() {
  const palette = [
    { color: '#A78BFA', avatar: '🧙', role: 'Philosopher' },
    { color: '#22D3EE', avatar: '🤡', role: 'Comedian' },
    { color: '#FB7185', avatar: '😈', role: "Devil's Advocate" },
    { color: '#34D399', avatar: '🛠️', role: 'Engineer' },
    { color: '#FBBF24', avatar: '🧭', role: 'Planner' },
    { color: '#60A5FA', avatar: '🧪', role: 'Scientist' },
    { color: '#F472B6', avatar: '🧾', role: 'Archivist' },
  ]
  return palette.map((p, i) => ({
    id: `agent_${i + 1}`,
    name: p.role,
    enabled: i < 3,
    color: p.color,
    avatar: p.avatar,
    role: p.role,
    persona: '',
    sessionId: crypto.randomUUID(),
    last: {
      model: '',
      traceId: '',
      tokens: null,
      at: null,
    },
  }))
}

function defaultSettings() {
  return {
    apiKey: 'crs_demo',
    headerMode: 'authorization', // 'authorization' | 'x-api-key'
    liveMode: true,
    runMode: 'sequential', // 'sequential' | 'parallel'
    loadoutId: 'default',
    projectId: '',
    autoCreateProject: true,
    autoShareTranscript: true,
    autoPinRecaps: true,
  }
}

function defaultMemory() {
  return {
    sharedSummary: '',
    sharedPins: [],
    agentPins: {}, // agentId -> pinned[] strings
  }
}

function formatTime(ts) {
  try { return new Date(ts).toLocaleTimeString() } catch { return '' }
}

function makeCurl({ apiKey, headerMode, path, body }) {
  const hdr =
    headerMode === 'x-api-key'
      ? `-H "X-API-Key: ${apiKey}"`
      : `-H "Authorization: Bearer ${apiKey}"`
  const payload = JSON.stringify(body ?? {})
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "'\\''")
  return `curl -sS -X POST "${location.origin}${path}" ${hdr} -H "Content-Type: application/json" -d '${payload}'`
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  // Fallback
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

async function apiFetch(path, { apiKey, headerMode, method = 'GET', body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) {
    if (headerMode === 'x-api-key') headers['X-API-Key'] = apiKey
    else headers['Authorization'] = `Bearer ${apiKey}`
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
    signal,
  })
  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    const msg = typeof data === 'object' && data && data.error ? data.error : res.statusText
    const err = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

function makeLocalRecap(messages) {
  const tail = messages.slice(-16)
  const lines = tail.map((m) => {
    const who = m.kind === 'user' ? 'User' : m.kind === 'system' ? 'System' : (m.agentName || 'Agent')
    return `- ${who}: ${String(m.content || '').trim().slice(0, 220)}`
  })
  return `Shared recap (local)\n\nRecent highlights:\n${lines.join('\n')}\n`
}

function App() {
  const [theme, setTheme] = useLocalStorageState(LS.theme, 'neon')
  const [settings, setSettings] = useLocalStorageState(LS.settings, defaultSettings())
  const [agents, setAgents] = useLocalStorageState(LS.agents, defaultAgents())
  const [messages, setMessages] = useLocalStorageState(LS.messages, [])
  const [memory, setMemory] = useLocalStorageState(LS.memory, defaultMemory())

  const [health, setHealth] = useState({ status: 'checking', model: 'unknown', at: null, error: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [personaEditAgentId, setPersonaEditAgentId] = useState(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)
  const chatLogRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await apiFetch('/api/health')
        if (cancelled) return
        setHealth({
          status: d.status === 'ok' ? 'ok' : 'bad',
          model: d.backend || 'unknown',
          at: nowIso(),
          error: '',
        })
      } catch (e) {
        if (cancelled) return
        setHealth({ status: 'bad', model: 'unknown', at: nowIso(), error: e.message || 'offline' })
      }
    })()
    const id = setInterval(() => {
      apiFetch('/api/health')
        .then((d) => setHealth({ status: d.status === 'ok' ? 'ok' : 'bad', model: d.backend || 'unknown', at: nowIso(), error: '' }))
        .catch((e) => setHealth({ status: 'bad', model: 'unknown', at: nowIso(), error: e.message || 'offline' }))
    }, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  useEffect(() => {
    // keep chat scrolled to bottom on new messages (lightweight)
    const el = chatLogRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  const tokenHealth = useMemo(() => {
    const sum = estimateTokensRough(memory.sharedSummary) +
      memory.sharedPins.reduce((s, p) => s + estimateTokensRough(p), 0)
    const perAgent = enabledAgents.map((a) => ({
      id: a.id,
      name: a.name,
      tokens: a.last?.tokens?.total ?? null,
    }))
    return { sharedEstimate: sum, perAgent }
  }, [memory.sharedSummary, memory.sharedPins, enabledAgents])

  function toast(content, kind = 'info') {
    setMessages((prev) => ([
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: 'system',
        ts: Date.now(),
        content: String(content),
        systemKind: kind,
      },
    ].slice(-600)))
  }

  async function ensureProject(signal) {
    if (!settings.liveMode) return settings.projectId || ''
    if (settings.projectId) return settings.projectId
    if (!settings.autoCreateProject) return ''
    const name = `Tavern Room ${new Date().toISOString().slice(0, 10)}`
    const created = await apiFetch('/api/projects', {
      method: 'POST',
      apiKey: settings.apiKey,
      headerMode: settings.headerMode,
      body: { name, description: 'SillyTavern-inspired multi-agent room', metadata: { ui: 'tavern' } },
      signal,
    })
    setSettings((s) => ({ ...s, projectId: created.id }))
    toast(`Created project ${created.id}`)
    return created.id
  }

  async function writeMemory({ content, type, scope, tags, session_id, project_id, signal }) {
    if (!settings.liveMode) return
    try {
      await apiFetch('/api/memory', {
        method: 'POST',
        apiKey: settings.apiKey,
        headerMode: settings.headerMode,
        body: {
          content,
          type: type || 'episodic',
          scope: scope || 'project',
          tags: tags || [],
          confidence: 0.9,
          session_id,
          project_id,
        },
        signal,
      })
    } catch (e) {
      // keep UI moving; memory write is best-effort
    }
  }

  function addUserMessage(text) {
    const msg = {
      id: crypto.randomUUID(),
      kind: 'user',
      ts: Date.now(),
      content: text,
    }
    setMessages((prev) => [...prev, msg].slice(-600))
    return msg
  }

  function addAgentMessage(agent, text, meta) {
    const msg = {
      id: crypto.randomUUID(),
      kind: 'agent',
      agentId: agent.id,
      agentName: agent.name,
      agentColor: agent.color,
      agentAvatar: agent.avatar,
      ts: Date.now(),
      content: text,
      meta: meta || null,
    }
    setMessages((prev) => [...prev, msg].slice(-600))
    return msg
  }

  function addThinking(agent) {
    const msg = {
      id: crypto.randomUUID(),
      kind: 'agent',
      agentId: agent.id,
      agentName: agent.name,
      agentColor: agent.color,
      agentAvatar: agent.avatar,
      ts: Date.now(),
      content: '…',
      thinking: true,
    }
    setMessages((prev) => [...prev, msg].slice(-600))
    return msg.id
  }

  function replaceMessage(id, patch) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  function stopRun(opts) {
    const hadRun = !!abortRef.current || !!busy
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = null
    setBusy(false)
    if (!opts?.silent && hadRun) toast('Stopped.')
  }

  async function runAgentsOnUserText(text) {
    if (enabledAgents.length === 0) {
      toast('No agents enabled. Toggle at least one agent.', 'warn')
      return
    }

    stopRun({ silent: true }) // cancels any prior run
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)

    let projectId = settings.projectId
    try {
      projectId = await ensureProject(ctrl.signal)
    } catch (e) {
      toast(`Project create failed: ${e.message}`, 'warn')
    }

    if (settings.liveMode && settings.autoShareTranscript && projectId) {
      writeMemory({
        content: `User: ${text}`,
        type: 'episodic',
        scope: 'project',
        tags: ['tavern', 'transcript', 'user'],
        project_id: projectId,
        session_id: 'tavern_shared',
        signal: ctrl.signal,
      })
    }

    const invokeOne = async (agent) => {
      const thinkingId = addThinking(agent)
      try {
        if (!settings.liveMode) {
          const mock = `${agent.role || agent.name} says: ${text}\n\n(Enable Live mode to hit /api/chat and persist memory.)`
          await new Promise((r) => setTimeout(r, 120 + Math.random() * 260))
          replaceMessage(thinkingId, { content: mock, thinking: false })
          return
        }

        const payload = {
          message: text,
          session_id: agent.sessionId,
          project_id: projectId || undefined,
          loadout_id: settings.loadoutId,
          metadata: {
            agent: {
              id: agent.id,
              name: agent.name,
              role: agent.role,
              persona: agent.persona,
              color: agent.color,
            },
            tavern: {
              ui: 'soul_tavern',
              shared_summary: memory.sharedSummary || '',
            },
          },
        }
        const data = await apiFetch('/api/chat', {
          method: 'POST',
          apiKey: settings.apiKey,
          headerMode: settings.headerMode,
          body: payload,
          signal: ctrl.signal,
        })

        replaceMessage(thinkingId, {
          content: data.response,
          thinking: false,
          meta: {
            traceId: data.trace_id,
            model: data.model,
            tokens: data.token_breakdown,
            citations: data.citations || [],
            skills: data.skills_activated || [],
            consolidation: data.consolidation_queued,
          },
        })

        setAgents((prev) => prev.map((a) => {
          if (a.id !== agent.id) return a
          return {
            ...a,
            sessionId: data.session_id || a.sessionId,
            last: {
              model: data.model || '',
              traceId: data.trace_id || '',
              tokens: data.token_breakdown || null,
              at: nowIso(),
            },
          }
        }))

        if (settings.autoShareTranscript && projectId) {
          writeMemory({
            content: `${agent.name}: ${data.response}`,
            type: 'episodic',
            scope: 'project',
            tags: ['tavern', 'transcript', 'agent', agent.id],
            project_id: projectId,
            session_id: agent.sessionId,
            signal: ctrl.signal,
          })
        }
      } catch (e) {
        replaceMessage(thinkingId, { content: `⚠️ ${agent.name}: ${e.message}`, thinking: false, error: true })
      }
    }

    try {
      if (settings.runMode === 'parallel') {
        await Promise.all(enabledAgents.map(invokeOne))
      } else {
        for (const a of enabledAgents) {
          // eslint-disable-next-line no-await-in-loop
          await invokeOne(a)
        }
      }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  async function recap() {
    stopRun({ silent: true })
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)

    let projectId = settings.projectId
    try {
      projectId = await ensureProject(ctrl.signal)
    } catch (e) {
      // ignore
    }

    try {
      if (!settings.liveMode) {
        const s = makeLocalRecap(messages)
        setMemory((m) => ({ ...m, sharedSummary: s }))
        toast('Recap updated (local).')
        return
      }

      const archivist = agents.find((a) => a.role === 'Archivist') || enabledAgents[0] || agents[0]
      const instruction =
        `Update the shared context summary for this multi-agent "tavern room".\n` +
        `Constraints:\n- Keep it tight and high-signal.\n- Include: key facts, decisions, open questions, and named entities.\n- Output plain text.\n`
      const data = await apiFetch('/api/chat', {
        method: 'POST',
        apiKey: settings.apiKey,
        headerMode: settings.headerMode,
        body: {
          message: instruction,
          session_id: archivist.sessionId,
          project_id: projectId || undefined,
          loadout_id: settings.loadoutId,
          metadata: {
            agent: {
              id: archivist.id,
              name: archivist.name,
              role: 'Archivist',
              persona: archivist.persona,
              color: archivist.color,
            },
            tavern: { recap: true },
            force_consolidate: true,
          },
        },
        signal: ctrl.signal,
      })

      setMemory((m) => ({ ...m, sharedSummary: data.response }))
      toast('Recap updated.')

      if (settings.autoPinRecaps && projectId) {
        await writeMemory({
          content: `Shared Summary:\n${data.response}`,
          type: 'summary',
          scope: 'project',
          tags: ['tavern', 'summary', 'recap'],
          project_id: projectId,
          session_id: 'tavern_shared',
          signal: ctrl.signal,
        })
      }
    } catch (e) {
      toast(`Recap failed: ${e.message}`, 'warn')
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  function pinShared(text) {
    const t = String(text || '').trim()
    if (!t) return
    setMemory((m) => ({ ...m, sharedPins: Array.from(new Set([t, ...m.sharedPins])).slice(0, 40) }))
  }

  function pinAgent(agentId, text) {
    const t = String(text || '').trim()
    if (!t) return
    setMemory((m) => {
      const prev = m.agentPins?.[agentId] || []
      const next = Array.from(new Set([t, ...prev])).slice(0, 30)
      return { ...m, agentPins: { ...(m.agentPins || {}), [agentId]: next } }
    })
  }

  async function pinToBackend(scope, agent, content) {
    const txt = String(content || '').trim()
    if (!txt) return
    let projectId = settings.projectId
    try { projectId = await ensureProject(undefined) } catch {}

    if (!settings.liveMode) return
    if (scope === 'project' && projectId) {
      await writeMemory({
        content: txt,
        type: 'semantic',
        scope: 'project',
        tags: ['tavern', 'pin'],
        project_id: projectId,
        session_id: 'tavern_shared',
      })
    } else if (scope === 'session' && agent) {
      await writeMemory({
        content: txt,
        type: 'semantic',
        scope: 'session',
        tags: ['tavern', 'pin', agent.id],
        project_id: projectId || undefined,
        session_id: agent.sessionId,
      })
    }
  }

  function resetAgentSession(agentId) {
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, sessionId: crypto.randomUUID(), last: { model: '', traceId: '', tokens: null, at: null } } : a)))
    toast('Agent session reset.')
  }

  const SettingsModal = settingsOpen ? html`
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal">
        <header>
          <b>Settings + Copy/Paste API helpers</b>
          <button className="btn" onClick=${() => setSettingsOpen(false)}>Close</button>
        </header>
        <main>
          <div className="card">
            <h3>Authentication</h3>
            <div className="row wrap">
              <label className="sr-only" htmlFor="apiKey">API Key</label>
              <input id="apiKey" className="input mono" value=${settings.apiKey} onInput=${(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))} placeholder="crs_… or dev master key" />
              <select className="select tight" value=${settings.headerMode} onChange=${(e) => setSettings((s) => ({ ...s, headerMode: e.target.value }))} aria-label="Header mode">
                <option value="authorization">Authorization: Bearer</option>
                <option value="x-api-key">X-API-Key</option>
              </select>
            </div>
            <div className="tiny">Tip: demo keys starting with <span className="mono">crs_</span> work in demo mode.</div>
          </div>

          <div className="card">
            <h3>Room + runtime</h3>
            <div className="row wrap">
              <input className="input mono" value=${settings.projectId} onInput=${(e) => setSettings((s) => ({ ...s, projectId: e.target.value.trim() }))} placeholder="project_id (proj_…)" aria-label="Project ID" />
              <select className="select tight" value=${settings.loadoutId} onChange=${(e) => setSettings((s) => ({ ...s, loadoutId: e.target.value }))} aria-label="Loadout">
                <option value="default">default</option>
                <option value="fast">fast</option>
                <option value="deep">deep</option>
              </select>
              <select className="select tight" value=${settings.runMode} onChange=${(e) => setSettings((s) => ({ ...s, runMode: e.target.value }))} aria-label="Run mode">
                <option value="sequential">sequential</option>
                <option value="parallel">parallel</option>
              </select>
            </div>

            <div className="row wrap" style=${{ marginTop: 8 }}>
              <label className="pill tight">
                <input type="checkbox" checked=${settings.liveMode} onChange=${(e) => setSettings((s) => ({ ...s, liveMode: e.target.checked }))} />
                Live (call /api/*)
              </label>
              <label className="pill tight">
                <input type="checkbox" checked=${settings.autoCreateProject} onChange=${(e) => setSettings((s) => ({ ...s, autoCreateProject: e.target.checked }))} />
                Auto-create project
              </label>
              <label className="pill tight">
                <input type="checkbox" checked=${settings.autoShareTranscript} onChange=${(e) => setSettings((s) => ({ ...s, autoShareTranscript: e.target.checked }))} />
                Share transcript to project memory
              </label>
              <label className="pill tight">
                <input type="checkbox" checked=${settings.autoPinRecaps} onChange=${(e) => setSettings((s) => ({ ...s, autoPinRecaps: e.target.checked }))} />
                Pin recaps (summary memory)
              </label>
            </div>
          </div>

          <div className="card">
            <h3>Copy curl</h3>
            <div className="tiny">These use your current API key + room settings (reduces “curl/token hassle”).</div>
            <div style=${{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              ${[
                {
                  title: 'POST /api/chat',
                  curl: makeCurl({
                    apiKey: settings.apiKey,
                    headerMode: settings.headerMode,
                    path: '/api/chat',
                    body: {
                      message: 'Hello from the Tavern UI',
                      project_id: settings.projectId || undefined,
                      loadout_id: settings.loadoutId,
                      metadata: { agent: { name: 'Demo Agent', role: 'Comedian', persona: 'Make it playful.' } },
                    },
                  }),
                },
                {
                  title: 'POST /api/memory (pin)',
                  curl: makeCurl({
                    apiKey: settings.apiKey,
                    headerMode: settings.headerMode,
                    path: '/api/memory',
                    body: {
                      content: 'Pinned fact: …',
                      type: 'semantic',
                      scope: 'project',
                      project_id: settings.projectId || undefined,
                      tags: ['tavern', 'pin'],
                    },
                  }),
                },
              ].map((c) => html`
                <div>
                  <div className="row" style=${{ marginBottom: 6 }}>
                    <span className="pill tight mono">${c.title}</span>
                    <button className="btn tight" onClick=${() => copyToClipboard(c.curl).then(() => toast('Copied curl.'))}>Copy</button>
                  </div>
                  <textarea className="textarea mono" readOnly value=${c.curl} aria-label=${c.title}></textarea>
                </div>
              `)}
            </div>
          </div>
        </main>
      </div>
    </div>
  ` : null

  const PersonaModal = personaEditAgentId ? (() => {
    const agent = agents.find((a) => a.id === personaEditAgentId)
    if (!agent) return null
    return html`
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit agent persona">
        <div className="modal">
          <header>
            <b>Persona: ${agent.name}</b>
            <button className="btn" onClick=${() => setPersonaEditAgentId(null)}>Close</button>
          </header>
          <main>
            <div className="card">
              <h3>Role + personality</h3>
              <div className="row wrap">
                <input className="input" value=${agent.role} onInput=${(e) => setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, role: e.target.value } : a)))} placeholder="Role (e.g. Philosopher)" aria-label="Role" />
                <input className="input" value=${agent.name} onInput=${(e) => setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, name: e.target.value } : a)))} placeholder="Display name" aria-label="Display name" />
              </div>
              <textarea className="textarea" value=${agent.persona} onInput=${(e) => setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, persona: e.target.value } : a)))} placeholder="System-style persona: constraints, vibe, and what this agent optimizes for." aria-label="Persona"></textarea>
              <div className="row wrap">
                <button className="btn tight" onClick=${() => resetAgentSession(agent.id)}>Reset agent session</button>
                <button className="btn tight" onClick=${async () => {
                  pinAgent(agent.id, `Persona for ${agent.name}: ${agent.persona || '(empty)'}`)
                  await pinToBackend('session', agent, `Persona for ${agent.name} (${agent.role}):\n${agent.persona || ''}`)
                  toast('Pinned persona (agent scope).')
                }}>Pin persona to agent memory</button>
              </div>
            </div>
          </main>
        </div>
      </div>
    `
  })() : null

  function AgentPanel() {
    return html`
      <section className="panel" aria-label="Agent management">
        <div className="panel-header">
          <div className="panel-title">
            <b>Agents (max 7)</b>
            <span>Toggle, roleplay, and cause trouble.</span>
          </div>
          <button className="btn tight" onClick=${() => setSettingsOpen(true)}>Settings</button>
        </div>
        <div className="panel-body">
          <div className="agent-stack">
            ${agents.map((a) => html`
              <div className="agent-card">
                <div className="agent-left">
                  <div className="avatar" aria-hidden="true">${a.avatar}</div>
                  <div className="agent-dot" style=${{ background: a.color }} title=${a.color}></div>
                  <label className="pill tight" title="Enable agent">
                    <input type="checkbox" checked=${!!a.enabled} onChange=${(e) => setAgents((prev) => prev.map((x) => x.id === a.id ? { ...x, enabled: e.target.checked } : x))} />
                    on
                  </label>
                </div>
                <div className="agent-meta">
                  <div className="row wrap">
                    <input className="input" value=${a.name} onInput=${(e) => setAgents((prev) => prev.map((x) => x.id === a.id ? { ...x, name: e.target.value } : x))} aria-label="Agent name" />
                    <button className="btn tight" onClick=${() => setPersonaEditAgentId(a.id)} aria-label="Edit persona">Persona</button>
                  </div>
                  <div className="row wrap">
                    <input className="input" value=${a.role} onInput=${(e) => setAgents((prev) => prev.map((x) => x.id === a.id ? { ...x, role: e.target.value } : x))} aria-label="Agent role" placeholder="Role" />
                    <input className="input mono tight" value=${a.sessionId} readOnly aria-label="Session ID" />
                    <button className="btn tight" onClick=${() => resetAgentSession(a.id)} aria-label="Reset session">Reset</button>
                  </div>
                  <div className="kvs">
                    <span>last model</span><b className="mono">${a.last?.model || '—'}</b>
                    <span>last trace</span><b className="mono">${a.last?.traceId ? a.last.traceId.slice(0, 10) + '…' : '—'}</b>
                    <span>tokens</span><b className="mono">${a.last?.tokens?.total ?? '—'}</b>
                  </div>
                </div>
              </div>
            `)}
          </div>
        </div>
      </section>
    `
  }

  function MessageView({ m }) {
    const isUser = m.kind === 'user'
    const isSystem = m.kind === 'system'
    const cls = isUser ? 'msg user' : isSystem ? 'msg system' : 'msg agent'
    const name = isUser ? 'You' : isSystem ? 'System' : (m.agentName || 'Agent')
    const color = m.agentColor || 'rgba(255,255,255,.20)'
    const avatar = isUser ? '👤' : isSystem ? '⚙️' : (m.agentAvatar || '🧠')
    const agent = m.agentId ? agents.find((a) => a.id === m.agentId) : null

    return html`
      <div className=${cls}>
        ${isUser ? null : html`<div className="avatar" style=${{ width: 34, height: 34, borderRadius: 12, flex: '0 0 auto', borderColor: isSystem ? 'rgba(255,255,255,.14)' : color }} aria-hidden="true">${avatar}</div>`}
        <div className="bubble" style=${!isUser && !isSystem ? { borderColor: color } : null}>
          <div className="hdr">
            <div className="name" style=${!isUser && !isSystem ? { color } : null}>${name}${m.thinking ? html` <span className="chip">typing…</span>` : null}</div>
            <div className="time">${formatTime(m.ts)}</div>
          </div>
          <div className="text">${m.content}</div>

          <div className="actions">
            ${m.meta?.traceId ? html`<span className="chip mono">trace ${m.meta.traceId.slice(0, 8)}…</span>` : null}
            ${m.meta?.model ? html`<span className="chip mono">${m.meta.model}</span>` : null}
            ${m.meta?.tokens?.total ? html`<span className="chip mono">${m.meta.tokens.total} tok</span>` : null}
            <button className="btn tight" onClick=${() => copyToClipboard(m.content).then(() => toast('Copied message.'))}>Copy</button>
            <button className="btn tight" onClick=${async () => {
              pinShared(`${name}: ${m.content}`)
              await pinToBackend('project', null, `${name}: ${m.content}`)
              toast('Pinned to shared memory.')
            }}>Pin shared</button>
            ${agent ? html`
              <button className="btn tight" onClick=${async () => {
                pinAgent(agent.id, `${name}: ${m.content}`)
                await pinToBackend('session', agent, `${name}: ${m.content}`)
                toast(`Pinned to ${agent.name} (private).`)
              }}>Pin ${agent.name}</button>
            ` : null}
          </div>
        </div>
      </div>
    `
  }

  function ChatPanel() {
    const [draft, setDraft] = useState('')
    const enabledCount = enabledAgents.length

    const onSend = async () => {
      const text = String(draft || '').trim()
      if (!text || busy) return
      setDraft('')
      addUserMessage(text)
      await runAgentsOnUserText(text)
      inputRef.current?.focus()
    }

    return html`
      <main className="chat" aria-label="Multi-agent chat">
        <div className="panel-header" style=${{ borderRight: 'none' }}>
          <div className="panel-title">
            <b>Multi-agent tavern</b>
            <span>${enabledCount} enabled · ${settings.liveMode ? `Live (${health.model})` : 'Mock'} · project ${settings.projectId ? shortId(settings.projectId) : '—'}</span>
          </div>
          <div className="row wrap" style=${{ justifyContent: 'flex-end', flex: '0 0 auto' }}>
            <button className="btn tight" onClick=${recap} disabled=${busy}>Recap</button>
            ${busy ? html`<button className="btn danger tight" onClick=${stopRun}>Stop</button>` : null}
          </div>
        </div>

        <div className="chatlog" id="chatlog" ref=${chatLogRef} role="log" aria-live="polite" aria-relevant="additions">
          ${messages.length === 0 ? html`
            <div className="card">
              <h3>Welcome to the Tavern</h3>
              <p>Toggle up to 7 agents, give them personas, and let them riff on a shared room with project-scoped memory.</p>
              <p className="tiny" style=${{ marginTop: 8 }}>Keyboard: Enter to send, Shift+Enter newline.</p>
            </div>
          ` : null}
          ${messages.map((m) => html`<${MessageView} key=${m.id} m=${m} />`)}
        </div>

        <div className="composer" id="composer">
          <div className="row">
            <textarea
              className="textarea"
              ref=${inputRef}
              value=${draft}
              onInput=${(e) => setDraft(e.target.value)}
              placeholder=${busy ? 'Running agents…' : 'Say something. Then watch the chaos.'}
              aria-label="Chat input"
              onKeyDown=${(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSend()
                }
              }}
              disabled=${busy}
            ></textarea>
            <div style=${{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 auto' }}>
              <button className="btn primary" onClick=${onSend} disabled=${busy || !String(draft || '').trim()}>
                Send
              </button>
              <button className="btn" onClick=${() => setDraft('')} disabled=${busy || !draft}>
                Clear
              </button>
            </div>
          </div>
          <div className="hint">
            <span>${settings.runMode} · ${settings.autoShareTranscript ? 'sharing transcript' : 'not sharing transcript'} · shared ctx est ${tokenHealth.sharedEstimate} tok</span>
            <span>${health.status === 'ok' ? 'Connected' : (health.error || 'Offline')}</span>
          </div>
        </div>
      </main>
    `
  }

  function MemoryPanel() {
    const [tab, setTab] = useState('shared')
    const [agentId, setAgentId] = useState(agents[0]?.id || '')
    const agent = agents.find((a) => a.id === agentId) || agents[0]
    const agentPins = memory.agentPins?.[agent?.id] || []

    return html`
      <aside className="panel right" aria-label="Context and memory">
        <div className="panel-header">
          <div className="panel-title">
            <b>Context</b>
            <span>Shared + private pins (SillyTavern-ish).</span>
          </div>
          <div className="tabs" role="tablist" aria-label="Context tabs">
            <button className="tab" role="tab" aria-selected=${tab === 'shared'} onClick=${() => setTab('shared')}>Shared</button>
            <button className="tab" role="tab" aria-selected=${tab === 'agent'} onClick=${() => setTab('agent')}>Agent</button>
            <button className="tab" role="tab" aria-selected=${tab === 'tools'} onClick=${() => setTab('tools')}>Tools</button>
          </div>
        </div>

        <div className="panel-body">
          ${tab === 'shared' ? html`
            <div className="card">
              <h3>Shared summary</h3>
              <textarea className="textarea" value=${memory.sharedSummary} onInput=${(e) => setMemory((m) => ({ ...m, sharedSummary: e.target.value }))} placeholder="High-signal shared summary. Recap button can generate this." aria-label="Shared summary"></textarea>
              <div className="row wrap" style=${{ marginTop: 8 }}>
                <button className="btn tight" onClick=${() => pinShared(`Shared Summary:\n${memory.sharedSummary}`)} disabled=${!String(memory.sharedSummary || '').trim()}>Pin summary</button>
                <button className="btn tight" onClick=${async () => {
                  await pinToBackend('project', null, `Shared Summary:\n${memory.sharedSummary}`)
                  toast('Saved summary to project memory.')
                }} disabled=${!settings.liveMode || !String(memory.sharedSummary || '').trim()}>Save to backend</button>
              </div>
            </div>

            <div className="card">
              <h3>Shared pins (${memory.sharedPins.length})</h3>
              ${memory.sharedPins.length === 0 ? html`<p>No pins yet. Pin messages to reduce context loss.</p>` : null}
              ${memory.sharedPins.map((p) => html`
                <div className="chip" style=${{ display: 'block', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                  ${p}
                  <div className="row wrap" style=${{ marginTop: 6 }}>
                    <button className="btn tight" onClick=${() => copyToClipboard(p).then(() => toast('Copied pin.'))}>Copy</button>
                    <button className="btn tight" onClick=${() => setMemory((m) => ({ ...m, sharedPins: m.sharedPins.filter((x) => x !== p) }))}>Remove</button>
                  </div>
                </div>
              `)}
            </div>
          ` : null}

          ${tab === 'agent' ? html`
            <div className="card">
              <h3>Pick agent</h3>
              <select className="select" value=${agentId} onChange=${(e) => setAgentId(e.target.value)} aria-label="Select agent">
                ${agents.map((a) => html`<option key=${a.id} value=${a.id}>${a.name}</option>`)}
              </select>
              <div className="tiny" style=${{ marginTop: 8 }}>
                Private pins can be stored in <span className="mono">session</span> scope for this agent, while shared pins live in <span className="mono">project</span> scope.
              </div>
            </div>

            <div className="card">
              <h3>${agent?.name} private pins (${agentPins.length})</h3>
              ${agentPins.length === 0 ? html`<p>No private pins yet.</p>` : null}
              ${agentPins.map((p) => html`
                <div className="chip" style=${{ display: 'block', whiteSpace: 'pre-wrap', marginBottom: 8, borderColor: agent?.color || undefined }}>
                  ${p}
                  <div className="row wrap" style=${{ marginTop: 6 }}>
                    <button className="btn tight" onClick=${() => copyToClipboard(p).then(() => toast('Copied pin.'))}>Copy</button>
                    <button className="btn tight" onClick=${() => setMemory((m) => {
                      const prev = m.agentPins?.[agent.id] || []
                      return { ...m, agentPins: { ...(m.agentPins || {}), [agent.id]: prev.filter((x) => x !== p) } }
                    })}>Remove</button>
                  </div>
                </div>
              `)}
            </div>

            <div className="card">
              <h3>Quick private note</h3>
              <textarea className="textarea" placeholder="Write a private note for this agent (pin + optionally persist to backend)." aria-label="Private note" onKeyDown=${(e) => e.stopPropagation()}></textarea>
              <div className="row wrap" style=${{ marginTop: 8 }}>
                <button className="btn tight" onClick=${async (e) => {
                  const ta = e.currentTarget.parentElement.previousElementSibling
                  const note = String(ta.value || '').trim()
                  if (!note) return
                  pinAgent(agent.id, note)
                  ta.value = ''
                  await pinToBackend('session', agent, note)
                  toast('Pinned private note.')
                }} disabled=${!agent}>Pin + save</button>
              </div>
            </div>
          ` : null}

          ${tab === 'tools' ? html`
            <div className="card">
              <h3>Context health</h3>
              <div className="kvs">
                <span>shared summary est.</span><b className="mono">${estimateTokensRough(memory.sharedSummary)} tok</b>
                <span>shared pins est.</span><b className="mono">${memory.sharedPins.reduce((s, p) => s + estimateTokensRough(p), 0)} tok</b>
                <span>enabled agents</span><b className="mono">${enabledAgents.length}</b>
              </div>
            </div>
            <div className="card">
              <h3>Tips (minimal context loss)</h3>
              <p>- Pin high-signal facts to shared memory, not raw transcript.</p>
              <p>- Use Recap to produce a <span className="mono">summary</span> memory item (type_priority helps retrieval).</p>
              <p>- Keep personas short; they’re injected into the system prompt.</p>
            </div>
          ` : null}
        </div>
      </aside>
    `
  }

  const healthDotClass = health.status === 'ok' ? 'dot ok' : 'dot bad'

  return html`
    <a className="skip-link" href="#composer">Skip to message box</a>
    <div className="app">
      <header className="topbar" role="banner">
        <div className="brand">
          <div className="brand-badge" aria-hidden="true">🍻</div>
          <div>
            <div className="brand-title">Soul-OS Tavern</div>
            <div className="brand-sub">multi-agent chat · shared context · a little chaotic</div>
          </div>
        </div>

        <div className="row wrap" style=${{ justifyContent: 'flex-end', gap: 10 }}>
          <span className="pill" title=${health.error || ''}>
            <span className=${healthDotClass}></span>
            ${health.status === 'ok' ? `API ok (${health.model})` : 'API offline'}
          </span>

          <select className="select tight" value=${theme} onChange=${(e) => setTheme(e.target.value)} aria-label="Theme">
            <option value="neon">neon</option>
            <option value="cyber">cyberpunk</option>
            <option value="haunted">haunted terminal</option>
            <option value="hc">high-contrast</option>
          </select>

          <button className="btn" onClick=${() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      <div className="main" role="application" aria-label="Soul-OS Tavern UI">
        <${AgentPanel} />
        <${ChatPanel} />
        <${MemoryPanel} />
      </div>
    </div>

    ${SettingsModal}
    ${PersonaModal}
  `
}

function mount() {
  const el = document.getElementById('root')
  if (!el) throw new Error('Missing #root')
  createRoot(el).render(html`<${App} />`)
}

mount()

