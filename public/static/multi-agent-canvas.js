/* global React, ReactDOM, htm */
(function () {
  if (!window.React || !window.ReactDOM || !window.htm) {
    var rootNode = document.getElementById('soul-tavern-root')
    if (rootNode) {
      rootNode.innerHTML =
        '<section class="no-script"><h1>UI boot failure</h1><p>React dependencies did not load. Refresh and try again.</p></section>'
    }
    return
  }

  var useEffect = window.React.useEffect
  var useMemo = window.React.useMemo
  var useRef = window.React.useRef
  var useState = window.React.useState
  var html = window.htm.bind(window.React.createElement)

  var MAX_AGENTS = 7
  var DEFAULT_HISTORY_CAP = 14
  var TOKEN_BUDGET = 28000

  var ROLE_OPTIONS = [
    'Strategist',
    'Philosopher',
    'Comedian',
    'Devil\'s Advocate',
    'Engineer',
    'Archivist',
    'Wildcard',
  ]

  var THEME_OPTIONS = [
    { id: 'neon', label: 'Neon Grid', icon: '🌈' },
    { id: 'cyberpunk', label: 'Cyberpunk', icon: '⚡' },
    { id: 'haunted', label: 'Haunted Terminal', icon: '👻' },
  ]

  var LOADOUT_OPTIONS = [
    { id: 'fast', label: 'Fast' },
    { id: 'default', label: 'Default' },
    { id: 'deep', label: 'Deep' },
  ]

  var REACTIONS = ['🔥', '🌀', '🎭', '🤖', '✨', '🧠', '⚔️', '😂', '👀', '💡']

  var STOP_WORDS = new Set([
    'about',
    'after',
    'again',
    'agent',
    'agents',
    'also',
    'and',
    'are',
    'because',
    'been',
    'before',
    'being',
    'between',
    'both',
    'could',
    'each',
    'every',
    'from',
    'have',
    'having',
    'into',
    'just',
    'like',
    'maybe',
    'more',
    'most',
    'only',
    'other',
    'should',
    'some',
    'than',
    'that',
    'their',
    'them',
    'then',
    'there',
    'these',
    'they',
    'this',
    'those',
    'through',
    'want',
    'were',
    'what',
    'when',
    'with',
    'would',
    'your',
  ])

  var AGENT_SEED = [
    {
      id: 'oracle',
      name: 'Oracle Hex',
      role: 'Philosopher',
      persona: 'Existential but practical. Speaks in vivid metaphors.',
      avatar: '🦉',
      color: '#9b6dff',
      enabled: true,
    },
    {
      id: 'spark',
      name: 'Spark Jester',
      role: 'Comedian',
      persona: 'Comic relief that still lands useful insights.',
      avatar: '🎪',
      color: '#f97316',
      enabled: true,
    },
    {
      id: 'forge',
      name: 'Forge Unit',
      role: 'Engineer',
      persona: 'Build-first, clear tradeoffs, concise implementation ideas.',
      avatar: '🛠️',
      color: '#22d3ee',
      enabled: true,
    },
    {
      id: 'rift',
      name: 'Rift Critic',
      role: 'Devil\'s Advocate',
      persona: 'Challenges assumptions and searches for blind spots.',
      avatar: '🦂',
      color: '#fb7185',
      enabled: false,
    },
    {
      id: 'atlas',
      name: 'Atlas Clerk',
      role: 'Archivist',
      persona: 'Tracks terminology, constraints, and continuity.',
      avatar: '📚',
      color: '#34d399',
      enabled: true,
    },
    {
      id: 'pulse',
      name: 'Pulse Lead',
      role: 'Strategist',
      persona: 'Keeps everyone aligned to goals and timelines.',
      avatar: '🎯',
      color: '#56d4ff',
      enabled: true,
    },
    {
      id: 'noise',
      name: 'Noise Goblin',
      role: 'Wildcard',
      persona: 'Unconventional ideas, but still grounded in context.',
      avatar: '🧪',
      color: '#facc15',
      enabled: false,
    },
  ]

  function makeId(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 10)
  }

  function makeSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return makeId('session')
  }

  function nowIso() {
    return new Date().toISOString()
  }

  function toClock(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch (_err) {
      return '--:--'
    }
  }

  function shortText(text, maxLen) {
    var safe = typeof text === 'string' ? text.trim() : ''
    if (safe.length <= maxLen) return safe
    return safe.slice(0, maxLen - 1) + '…'
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  function parseJsonMaybe(raw, fallback) {
    try {
      return JSON.parse(raw)
    } catch (_err) {
      return fallback
    }
  }

  function safeJson(response) {
    return response
      .json()
      .catch(function () {
        return {}
      })
  }

  function randomReaction() {
    return REACTIONS[Math.floor(Math.random() * REACTIONS.length)]
  }

  function createIntroMessage() {
    return {
      id: makeId('system'),
      kind: 'system',
      tone: 'info',
      content:
        'Welcome to Soul Tavern. Toggle up to 7 agents, keep shared context alive, and let scoped memory preserve each persona.',
      createdAt: nowIso(),
    }
  }

  function sanitizeAgentRoster(value) {
    var incoming = Array.isArray(value) ? value : []
    if (!incoming.length) return AGENT_SEED.slice(0, MAX_AGENTS)

    return AGENT_SEED.slice(0, MAX_AGENTS).map(function (seed) {
      var match = incoming.find(function (candidate) {
        return isObject(candidate) && candidate.id === seed.id
      })
      if (!match) return seed
      return {
        id: seed.id,
        name: typeof match.name === 'string' && match.name.trim() ? match.name.trim() : seed.name,
        role: typeof match.role === 'string' && match.role.trim() ? match.role.trim() : seed.role,
        persona:
          typeof match.persona === 'string' && match.persona.trim() ? match.persona.trim() : seed.persona,
        avatar: typeof match.avatar === 'string' && match.avatar.trim() ? match.avatar.trim() : seed.avatar,
        color: typeof match.color === 'string' && match.color.trim() ? match.color.trim() : seed.color,
        enabled: typeof match.enabled === 'boolean' ? match.enabled : seed.enabled,
      }
    })
  }

  function sanitizeMessages(value) {
    if (!Array.isArray(value) || !value.length) {
      return [createIntroMessage()]
    }

    var messages = value
      .filter(function (entry) {
        return isObject(entry) && typeof entry.content === 'string' && entry.content.trim().length > 0
      })
      .map(function (entry) {
        return {
          id: typeof entry.id === 'string' ? entry.id : makeId('msg'),
          kind: typeof entry.kind === 'string' ? entry.kind : 'system',
          tone: typeof entry.tone === 'string' ? entry.tone : '',
          content: entry.content,
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
          agentId: typeof entry.agentId === 'string' ? entry.agentId : '',
          agentName: typeof entry.agentName === 'string' ? entry.agentName : '',
          avatar: typeof entry.avatar === 'string' ? entry.avatar : '',
          role: typeof entry.role === 'string' ? entry.role : '',
          color: typeof entry.color === 'string' ? entry.color : '',
          reaction: typeof entry.reaction === 'string' ? entry.reaction : '',
          meta: isObject(entry.meta) ? entry.meta : null,
        }
      })

    return messages.length ? messages : [createIntroMessage()]
  }

  function usePersistentState(key, fallback) {
    var fallbackValue = typeof fallback === 'function' ? fallback : function () { return fallback }

    var _useState = useState(function () {
      try {
        var raw = window.localStorage.getItem(key)
        if (raw !== null) {
          return parseJsonMaybe(raw, fallbackValue())
        }
      } catch (_err) {
        return fallbackValue()
      }
      return fallbackValue()
    })

    var value = _useState[0]
    var setValue = _useState[1]

    useEffect(
      function () {
        try {
          window.localStorage.setItem(key, JSON.stringify(value))
        } catch (_err) {}
      },
      [key, value],
    )

    return [value, setValue]
  }

  function aggregateTokens(current, tokenBreakdown) {
    var breakdown = isObject(tokenBreakdown) ? tokenBreakdown : {}
    return {
      total: (current.total || 0) + Number(breakdown.total || 0),
      system: (current.system || 0) + Number(breakdown.system || 0),
      context: (current.context || 0) + Number(breakdown.context || 0),
      history: (current.history || 0) + Number(breakdown.history || 0),
      user_message: (current.user_message || 0) + Number(breakdown.user_message || 0),
      turns: (current.turns || 0) + 1,
    }
  }

  function extractKeywords(messages, maxCount) {
    var tally = {}

    messages
      .filter(function (entry) {
        return entry.kind === 'user' || entry.kind === 'agent'
      })
      .slice(-28)
      .forEach(function (entry) {
        var words = String(entry.content || '')
          .toLowerCase()
          .match(/[a-z0-9][a-z0-9_-]{2,}/g)
        if (!words) return

        words.forEach(function (word) {
          if (STOP_WORDS.has(word)) return
          tally[word] = (tally[word] || 0) + 1
        })
      })

    return Object.keys(tally)
      .sort(function (a, b) {
        return tally[b] - tally[a]
      })
      .slice(0, maxCount)
  }

  function buildRecap(messages) {
    var turns = messages.filter(function (entry) {
      return entry.kind === 'user' || entry.kind === 'agent'
    })

    if (!turns.length) {
      return 'Waiting for first turn. Shared memory will populate after chat starts.'
    }

    var userTurns = turns
      .filter(function (entry) {
        return entry.kind === 'user'
      })
      .slice(-3)

    var agentTurns = turns
      .filter(function (entry) {
        return entry.kind === 'agent'
      })
      .slice(-4)

    var lines = ['Shared recap (auto-generated):']

    userTurns.forEach(function (entry, index) {
      lines.push('- User goal ' + (index + 1) + ': ' + shortText(entry.content, 140))
    })

    agentTurns.forEach(function (entry, index) {
      lines.push(
        '- Agent takeaway ' +
          (index + 1) +
          ': ' +
          (entry.agentName || 'Agent') +
          ' => ' +
          shortText(entry.content, 140),
      )
    })

    var concepts = extractKeywords(turns, 7)
    if (concepts.length) {
      lines.push('- Concepts: ' + concepts.join(', '))
    }

    return lines.join('\n')
  }

  function buildScopedPrompt(config) {
    var transcript = config.transcript
      .filter(function (entry) {
        return entry.kind === 'user' || entry.kind === 'agent'
      })
      .slice(-(config.compactMode ? config.historyCap : Math.max(config.historyCap * 2, 24)))
      .map(function (entry, index) {
        var author = entry.kind === 'user' ? 'User' : (entry.agentName || 'Agent') + ' (' + (entry.role || 'role') + ')'
        return index + 1 + '. ' + author + ': ' + shortText(String(entry.content || ''), 220)
      })
      .join('\n')

    var scoped = (config.scopedNotes || [])
      .slice(0, 6)
      .map(function (note, index) {
        return index + 1 + '. ' + String(note.note || '')
      })
      .join('\n')

    var compactDirective = config.compactMode
      ? 'Compact mode is ON. Reuse shared summary first, then only necessary transcript details.'
      : 'Compact mode is OFF. You may use broader transcript details as needed.'

    return [
      'You are ' + config.agent.name + '.',
      'Role: ' + config.agent.role + '.',
      'Persona: ' + config.agent.persona + '.',
      'You are in a multi-agent team conversation.',
      'Active teammates: ' + config.teammates.join(', ') + '.',
      compactDirective,
      'Shared context summary:',
      config.sharedSummary || 'No shared summary yet.',
      'Your scoped memory (private to you):',
      scoped || 'No scoped notes yet.',
      'Recent transcript:',
      transcript || 'No transcript yet.',
      'Latest user message:',
      config.userText,
      'Respond in 3-6 concise sentences. Preserve continuity and avoid contradicting established context.',
    ].join('\n\n')
  }

  function rememberForAgent(previous, agent, userText, replyText) {
    var scoped = isObject(previous) ? previous : {}
    var existing = Array.isArray(scoped[agent.id]) ? scoped[agent.id] : []
    var nextNote = {
      id: makeId('note'),
      createdAt: nowIso(),
      note: shortText(userText, 88) + ' -> ' + shortText(replyText, 140),
    }
    return Object.assign({}, scoped, {
      [agent.id]: [nextNote].concat(existing).slice(0, 8),
    })
  }

  function App() {
    var _apiKeyState = usePersistentState('soul_tavern_api_key_v1', 'crs_demo')
    var apiKey = _apiKeyState[0]
    var setApiKey = _apiKeyState[1]

    var _sessionState = usePersistentState('soul_tavern_session_id_v1', makeSessionId)
    var sessionId = _sessionState[0]
    var setSessionId = _sessionState[1]

    var _themeState = usePersistentState('soul_tavern_theme_v1', 'neon')
    var theme = _themeState[0]
    var setTheme = _themeState[1]

    var _reduceMotionState = usePersistentState('soul_tavern_reduce_motion_v1', false)
    var reduceMotion = _reduceMotionState[0]
    var setReduceMotion = _reduceMotionState[1]

    var _loadoutState = usePersistentState('soul_tavern_loadout_v1', 'fast')
    var loadoutId = _loadoutState[0]
    var setLoadoutId = _loadoutState[1]

    var _dispatchState = usePersistentState('soul_tavern_dispatch_mode_v1', 'parallel')
    var dispatchMode = _dispatchState[0]
    var setDispatchMode = _dispatchState[1]

    var _historyState = usePersistentState('soul_tavern_history_cap_v1', DEFAULT_HISTORY_CAP)
    var historyCap = _historyState[0]
    var setHistoryCap = _historyState[1]

    var _compactState = usePersistentState('soul_tavern_compact_mode_v1', true)
    var compactMode = _compactState[0]
    var setCompactMode = _compactState[1]

    var _agentState = usePersistentState('soul_tavern_agents_v1', AGENT_SEED)
    var agents = _agentState[0]
    var setAgents = _agentState[1]

    var _messageState = usePersistentState('soul_tavern_messages_v1', function () {
      return [createIntroMessage()]
    })
    var messages = _messageState[0]
    var setMessages = _messageState[1]

    var _memoryState = usePersistentState('soul_tavern_scoped_memory_v1', {})
    var scopedMemory = _memoryState[0]
    var setScopedMemory = _memoryState[1]

    var _summaryState = usePersistentState('soul_tavern_shared_summary_v1', '')
    var sharedSummary = _summaryState[0]
    var setSharedSummary = _summaryState[1]

    var _useState2 = useState(AGENT_SEED[0].id)
    var selectedAgentId = _useState2[0]
    var setSelectedAgentId = _useState2[1]

    var _useState3 = useState('')
    var inputValue = _useState3[0]
    var setInputValue = _useState3[1]

    var _useState4 = useState(false)
    var isSending = _useState4[0]
    var setIsSending = _useState4[1]

    var _useState5 = useState({})
    var agentActivity = _useState5[0]
    var setAgentActivity = _useState5[1]

    var _useState6 = useState({ kind: 'warn', label: 'checking runtime' })
    var health = _useState6[0]
    var setHealth = _useState6[1]

    var _useState7 = useState({
      total: 0,
      system: 0,
      context: 0,
      history: 0,
      user_message: 0,
      turns: 0,
    })
    var tokenStats = _useState7[0]
    var setTokenStats = _useState7[1]

    var _useState8 = useState(0)
    var lastLatency = _useState8[0]
    var setLastLatency = _useState8[1]

    var _useState9 = useState('Soul Tavern ready.')
    var announcement = _useState9[0]
    var setAnnouncement = _useState9[1]

    var chatLogRef = useRef(null)

    var roster = useMemo(
      function () {
        return sanitizeAgentRoster(agents)
      },
      [agents],
    )

    var chatMessages = useMemo(
      function () {
        return sanitizeMessages(messages)
      },
      [messages],
    )

    var activeAgents = useMemo(
      function () {
        return roster.filter(function (agent) {
          return agent.enabled
        })
      },
      [roster],
    )

    var liveRecap = useMemo(
      function () {
        return buildRecap(chatMessages)
      },
      [chatMessages],
    )

    var conceptChips = useMemo(
      function () {
        return extractKeywords(chatMessages, 10)
      },
      [chatMessages],
    )

    var activeSummary = (sharedSummary || '').trim() || liveRecap
    var tokenPercent = Math.min(100, Math.round(((tokenStats.total || 0) / TOKEN_BUDGET) * 100))
    var selectedNotes = isObject(scopedMemory) && Array.isArray(scopedMemory[selectedAgentId]) ? scopedMemory[selectedAgentId] : []

    useEffect(
      function () {
        document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.setAttribute('data-motion', reduceMotion ? 'reduce' : 'full')
      },
      [theme, reduceMotion],
    )

    useEffect(
      function () {
        if (!sharedSummary || !sharedSummary.trim()) {
          setSharedSummary(liveRecap)
        }
      },
      [liveRecap],
    )

    useEffect(
      function () {
        var hasAgent = roster.some(function (agent) {
          return agent.id === selectedAgentId
        })
        if (!hasAgent && roster.length > 0) {
          setSelectedAgentId(roster[0].id)
        }
      },
      [roster, selectedAgentId],
    )

    useEffect(
      function () {
        var node = chatLogRef.current
        if (!node) return
        window.requestAnimationFrame(function () {
          node.scrollTop = node.scrollHeight
        })
      },
      [chatMessages.length, isSending],
    )

    useEffect(function () {
      var cancelled = false

      async function checkHealth() {
        try {
          var response = await fetch('/api/health')
          var payload = await safeJson(response)
          if (cancelled) return

          if (!response.ok) {
            setHealth({ kind: 'down', label: 'api unavailable' })
            return
          }

          if (payload.status === 'ok' && payload.model_configured) {
            setHealth({ kind: 'ok', label: 'runtime ready' })
          } else if (payload.status === 'ok') {
            setHealth({ kind: 'warn', label: 'runtime up, model key missing' })
          } else {
            setHealth({ kind: 'warn', label: 'runtime degraded' })
          }
        } catch (_err) {
          if (!cancelled) {
            setHealth({ kind: 'down', label: 'offline' })
          }
        }
      }

      checkHealth()
      var timer = window.setInterval(checkHealth, 25000)
      return function () {
        cancelled = true
        window.clearInterval(timer)
      }
    }, [])

    function setDemoKey() {
      setApiKey('crs_demo')
      setAnnouncement('Demo key applied.')
    }

    function patchAgent(agentId, patch) {
      setAgents(function (previous) {
        var base = sanitizeAgentRoster(previous)
        return base.map(function (agent) {
          return agent.id === agentId ? Object.assign({}, agent, patch) : agent
        })
      })
    }

    function appendSystem(content, tone) {
      setMessages(function (previous) {
        var base = sanitizeMessages(previous)
        return base.concat({
          id: makeId('system'),
          kind: 'system',
          tone: tone || 'info',
          content: content,
          createdAt: nowIso(),
        })
      })
    }

    function startNewSession() {
      setSessionId(makeSessionId())
      setAnnouncement('Started a fresh session id.')
      appendSystem('Session rotated. Next turn uses a new scoped session id.', 'warn')
    }

    function resetConversation() {
      setMessages([createIntroMessage()])
      setScopedMemory({})
      setSharedSummary('')
      setTokenStats({
        total: 0,
        system: 0,
        context: 0,
        history: 0,
        user_message: 0,
        turns: 0,
      })
      setSessionId(makeSessionId())
      setAnnouncement('Conversation reset. Memory buffers cleared.')
    }

    async function copyContext() {
      if (!navigator.clipboard) {
        setAnnouncement('Clipboard is unavailable in this browser.')
        return
      }
      try {
        await navigator.clipboard.writeText(activeSummary)
        setAnnouncement('Shared context copied.')
      } catch (_err) {
        setAnnouncement('Unable to copy shared context.')
      }
    }

    async function copySession() {
      if (!navigator.clipboard) {
        setAnnouncement('Clipboard is unavailable in this browser.')
        return
      }
      try {
        await navigator.clipboard.writeText(sessionId)
        setAnnouncement('Session id copied.')
      } catch (_err) {
        setAnnouncement('Unable to copy session id.')
      }
    }

    function refreshRecap() {
      var recap = buildRecap(chatMessages)
      setSharedSummary(recap)
      setAnnouncement('Shared recap refreshed from live context.')
    }

    async function runAgentTurn(agent, userText, transcriptSnapshot, teamSnapshot, memorySnapshot) {
      setAgentActivity(function (current) {
        return Object.assign({}, current, { [agent.id]: 'thinking' })
      })

      try {
        var scopedNotes = isObject(memorySnapshot) && Array.isArray(memorySnapshot[agent.id]) ? memorySnapshot[agent.id] : []
        var prompt = buildScopedPrompt({
          agent: agent,
          userText: userText,
          teammates: teamSnapshot.map(function (member) {
            return member.name
          }),
          sharedSummary: activeSummary,
          scopedNotes: scopedNotes,
          transcript: transcriptSnapshot,
          historyCap: Math.max(6, Math.min(30, Number(historyCap) || DEFAULT_HISTORY_CAP)),
          compactMode: compactMode,
        })

        var response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
          },
          body: JSON.stringify({
            message: prompt,
            session_id: sessionId,
            loadout_id: loadoutId,
            metadata: {
              ui_mode: 'soul-tavern',
              multi_agent: true,
              context_strategy: 'shared+scoped',
              agent_id: agent.id,
              agent_name: agent.name,
              agent_role: agent.role,
            },
          }),
        })

        var payload = await safeJson(response)
        if (!response.ok) {
          throw new Error(payload.error || 'request failed for ' + agent.name)
        }

        var replyText = typeof payload.response === 'string' && payload.response.trim() ? payload.response.trim() : '(empty response)'
        var tokenBreakdown = isObject(payload.token_breakdown) ? payload.token_breakdown : null
        var message = {
          id: makeId('agent'),
          kind: 'agent',
          content: replyText,
          createdAt: nowIso(),
          agentId: agent.id,
          agentName: agent.name,
          avatar: agent.avatar,
          role: agent.role,
          color: agent.color,
          reaction: randomReaction(),
          meta: {
            tokenTotal: tokenBreakdown ? Number(tokenBreakdown.total || 0) : 0,
            traceId: typeof payload.trace_id === 'string' ? payload.trace_id : '',
            skills: Array.isArray(payload.skills_activated) ? payload.skills_activated.slice(0, 3) : [],
            consolidation: Boolean(payload.consolidation_queued),
          },
        }

        setMessages(function (previous) {
          return sanitizeMessages(previous).concat(message)
        })

        if (tokenBreakdown) {
          setTokenStats(function (current) {
            return aggregateTokens(current, tokenBreakdown)
          })
        }

        if (typeof payload.session_id === 'string' && payload.session_id.trim()) {
          setSessionId(payload.session_id)
        }

        setScopedMemory(function (previous) {
          return rememberForAgent(previous, agent, userText, replyText)
        })

        setAnnouncement(agent.name + ' replied.')
      } catch (err) {
        var errorText = err instanceof Error ? err.message : 'unexpected error'
        appendSystem(agent.name + ' failed: ' + errorText, 'error')
      } finally {
        setAgentActivity(function (current) {
          return Object.assign({}, current, { [agent.id]: 'idle' })
        })
      }
    }

    async function handleSend(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault()
      }

      var userText = inputValue.trim()
      if (!userText || isSending) return

      if (!activeAgents.length) {
        appendSystem('No active agents. Toggle at least one agent on.', 'warn')
        return
      }

      if (!apiKey || !apiKey.trim()) {
        appendSystem('Add an API key first so agents can speak.', 'warn')
        return
      }

      var userMessage = {
        id: makeId('user'),
        kind: 'user',
        content: userText,
        createdAt: nowIso(),
      }

      setMessages(function (previous) {
        return sanitizeMessages(previous).concat(userMessage)
      })
      setInputValue('')
      setIsSending(true)
      setAnnouncement('Dispatching to ' + activeAgents.length + ' agents.')

      var transcriptSnapshot = chatMessages.concat(userMessage)
      var teamSnapshot = activeAgents.slice()
      var memorySnapshot = isObject(scopedMemory) ? scopedMemory : {}
      var roundStart = performance.now()

      if (dispatchMode === 'relay') {
        for (var i = 0; i < teamSnapshot.length; i += 1) {
          await runAgentTurn(teamSnapshot[i], userText, transcriptSnapshot, teamSnapshot, memorySnapshot)
        }
      } else {
        await Promise.all(
          teamSnapshot.map(function (agent) {
            return runAgentTurn(agent, userText, transcriptSnapshot, teamSnapshot, memorySnapshot)
          }),
        )
      }

      setLastLatency(Math.round(performance.now() - roundStart))
      setIsSending(false)
      setAgentActivity({})
    }

    function onComposerKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSend()
      }
    }

    return html`
      <div className="soul-app">
        <header className="topbar" role="banner">
          <div className="brand-wrap">
            <div className="brand-avatar" aria-hidden="true">🍻</div>
            <div>
              <h1 className="brand-title">Soul Tavern Multi-Agent Canvas</h1>
              <p className="brand-subtitle">
                SillyTavern-inspired frontend for shared + scoped context conversations.
              </p>
            </div>
          </div>

          <div className="control-cluster">
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                aria-label="API key for auth"
                value=${apiKey}
                onChange=${function (event) {
                  setApiKey(event.target.value)
                }}
                placeholder="crs_demo or crs_..."
              />
            </label>

            <label className="field">
              <span>Theme</span>
              <select
                value=${theme}
                onChange=${function (event) {
                  setTheme(event.target.value)
                }}
                aria-label="Theme selector"
              >
                ${THEME_OPTIONS.map(function (option) {
                  return html`<option key=${option.id} value=${option.id}>
                    ${option.icon} ${option.label}
                  </option>`
                })}
              </select>
            </label>

            <label className="field">
              <span>Session</span>
              <input
                readOnly
                aria-label="Current session id"
                value=${shortText(sessionId, 30)}
              />
            </label>

            <div className="quick-buttons">
              <button type="button" className="btn" onClick=${setDemoKey}>Use demo key</button>
              <button type="button" className="btn" onClick=${copySession}>Copy session</button>
              <button type="button" className="btn" onClick=${startNewSession}>New session id</button>
              <button type="button" className="btn btn-danger" onClick=${resetConversation}>
                Reset conversation
              </button>
              <span className=${'health-pill ' + health.kind} role="status" aria-live="polite">
                ${health.label}
              </span>
            </div>
          </div>
        </header>

        <div className="workspace-grid">
          <aside className="panel roster-panel" aria-label="Agent management">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Agent Roster</h2>
                <div className="panel-subtle">
                  ${activeAgents.length}/${MAX_AGENTS} active
                </div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked=${reduceMotion}
                  onChange=${function (event) {
                    setReduceMotion(Boolean(event.target.checked))
                  }}
                />
                Reduce motion
              </label>
            </div>

            <div className="agent-list">
              ${roster.map(
                function (agent) {
                  var memoryCount =
                    isObject(scopedMemory) && Array.isArray(scopedMemory[agent.id]) ? scopedMemory[agent.id].length : 0
                  var isSelected = selectedAgentId === agent.id
                  var isThinking = agentActivity[agent.id] === 'thinking'

                  return html`
                    <article
                      key=${agent.id}
                      className=${'agent-card ' + (isSelected ? 'selected' : '')}
                      onClick=${function () {
                        setSelectedAgentId(agent.id)
                      }}
                    >
                      <div className="agent-row">
                        <div className="agent-name">
                          <span aria-hidden="true">${agent.avatar}</span>
                          <strong>${agent.name}</strong>
                        </div>
                        <span
                          className=${'agent-status ' +
                          (isThinking ? 'thinking' : agent.enabled ? 'active' : '')}
                          style=${{ background: isThinking ? undefined : agent.enabled ? agent.color : undefined }}
                          aria-hidden="true"
                        ></span>
                      </div>

                      <label className="toggle-wrap">
                        <input
                          type="checkbox"
                          checked=${agent.enabled}
                          onClick=${function (event) {
                            event.stopPropagation()
                          }}
                          onChange=${function (event) {
                            patchAgent(agent.id, { enabled: Boolean(event.target.checked) })
                          }}
                        />
                        Active
                      </label>

                      <label className="field">
                        <span>Role</span>
                        <select
                          value=${agent.role}
                          onClick=${function (event) {
                            event.stopPropagation()
                          }}
                          onChange=${function (event) {
                            patchAgent(agent.id, { role: event.target.value })
                          }}
                          aria-label=${agent.name + ' role'}
                        >
                          ${ROLE_OPTIONS.map(function (role) {
                            return html`<option key=${role} value=${role}>${role}</option>`
                          })}
                        </select>
                      </label>

                      <label className="field">
                        <span>Persona</span>
                        <input
                          value=${agent.persona}
                          onClick=${function (event) {
                            event.stopPropagation()
                          }}
                          onChange=${function (event) {
                            patchAgent(agent.id, { persona: event.target.value })
                          }}
                          aria-label=${agent.name + ' persona'}
                        />
                      </label>

                      <div className="agent-meta">
                        <span>Scoped notes: ${memoryCount}</span>
                        <span style=${{ color: agent.color }}>Accent</span>
                      </div>
                    </article>
                  `
                },
              )}
            </div>
          </aside>

          <main className="panel chat-panel">
            <div className="chat-toolbar">
              <label className="field">
                <span>Loadout</span>
                <select
                  value=${loadoutId}
                  onChange=${function (event) {
                    setLoadoutId(event.target.value)
                  }}
                >
                  ${LOADOUT_OPTIONS.map(function (option) {
                    return html`<option key=${option.id} value=${option.id}>${option.label}</option>`
                  })}
                </select>
              </label>

              <label className="field">
                <span>Dispatch mode</span>
                <select
                  value=${dispatchMode}
                  onChange=${function (event) {
                    setDispatchMode(event.target.value)
                  }}
                >
                  <option value="parallel">Parallel (low latency)</option>
                  <option value="relay">Relay (ordered turns)</option>
                </select>
              </label>

              <label className="field">
                <span>History turns in prompt</span>
                <input
                  type="number"
                  min="6"
                  max="30"
                  value=${historyCap}
                  onChange=${function (event) {
                    var parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) return
                    setHistoryCap(Math.max(6, Math.min(30, parsed)))
                  }}
                />
              </label>

              <label className="toggle-wrap" style=${{ alignSelf: 'end' }}>
                <input
                  type="checkbox"
                  checked=${compactMode}
                  onChange=${function (event) {
                    setCompactMode(Boolean(event.target.checked))
                  }}
                />
                Token guard mode
              </label>
            </div>

            <section className="chat-log" ref=${chatLogRef} role="log" aria-live="polite">
              ${chatMessages.map(function (message) {
                var messageClass =
                  'message ' + message.kind + (message.tone ? ' ' + message.tone : '')
                var style = message.kind === 'agent'
                  ? { '--agent-accent': message.color || '#56d4ff' }
                  : undefined
                var title =
                  message.kind === 'user'
                    ? 'You'
                    : message.kind === 'agent'
                      ? (message.avatar || '🤖') + ' ' + (message.agentName || 'Agent')
                      : 'System'

                return html`
                  <article key=${message.id} className=${messageClass} style=${style}>
                    <div className="message-head">
                      <div className="message-author">
                        <span>${title}</span>
                        ${message.kind === 'agent' ? html`<span>(${message.role || 'role'})</span>` : null}
                        ${message.reaction ? html`<span className="reaction" aria-hidden="true">${message.reaction}</span>` : null}
                      </div>
                      <time dateTime=${message.createdAt}>${toClock(message.createdAt)}</time>
                    </div>

                    <p className="message-body">${message.content}</p>

                    ${message.meta
                      ? html`
                          <div className="meta-row">
                            ${message.meta.traceId
                              ? html`<span>trace: ${shortText(message.meta.traceId, 12)}</span>`
                              : null}
                            ${message.meta.tokenTotal
                              ? html`<span>tokens: ${message.meta.tokenTotal}</span>`
                              : null}
                            ${message.meta.consolidation
                              ? html`<span>consolidating memory</span>`
                              : null}
                            ${Array.isArray(message.meta.skills)
                              ? message.meta.skills.map(function (skill) {
                                  return html`<span key=${skill} className="skill-chip">${skill}</span>`
                                })
                              : null}
                          </div>
                        `
                      : null}
                  </article>
                `
              })}

              ${isSending
                ? html`
                    <div className="typing">
                      <span>Agents are drafting responses…</span>
                      <span className="typing-dots" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
                    </div>
                  `
                : null}
            </section>

            <form className="composer" id="chat-composer" onSubmit=${handleSend}>
              <label className="field">
                <span>Message</span>
                <textarea
                  aria-label="Message to active agents"
                  placeholder="Type once. Every active agent replies with shared + scoped context..."
                  value=${inputValue}
                  onChange=${function (event) {
                    setInputValue(event.target.value)
                  }}
                  onKeyDown=${onComposerKeyDown}
                ></textarea>
              </label>

              <div className="composer-row">
                <span className="composer-hint">
                  Enter sends · Shift+Enter newline · No curl copy-paste required.
                </span>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled=${isSending || !inputValue.trim() || !activeAgents.length}
                >
                  Send to ${activeAgents.length || 0} agent${activeAgents.length === 1 ? '' : 's'}
                </button>
              </div>
            </form>
          </main>

          <aside className="panel context-panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Context Retention</h2>
                <div className="panel-subtle">Shared summary + scoped per-agent memory</div>
              </div>
            </div>

            <div className="context-scroll">
              <section className="context-card">
                <h4>Shared summary (editable)</h4>
                <p>This context is injected into every active agent prompt.</p>
                <textarea
                  aria-label="Shared context summary"
                  rows="7"
                  value=${sharedSummary}
                  onChange=${function (event) {
                    setSharedSummary(event.target.value)
                  }}
                ></textarea>
                <div className="context-actions">
                  <button type="button" className="btn" onClick=${refreshRecap}>Recap now</button>
                  <button type="button" className="btn" onClick=${copyContext}>Copy shared context</button>
                </div>
              </section>

              <section className="context-card">
                <h4>Live recap stream</h4>
                <p>Auto-updated from recent conversation turns.</p>
                <pre className="recap-block">${liveRecap}</pre>
              </section>

              <section className="context-card">
                <h4>Key concepts</h4>
                <div className="cluster">
                  ${conceptChips.length
                    ? conceptChips.map(function (concept) {
                        return html`<span key=${concept} className="concept-chip">${concept}</span>`
                      })
                    : html`<span className="empty-note">Concept tags appear after a few turns.</span>`}
                </div>
              </section>

              <section className="context-card">
                <h4>Scoped memory by agent</h4>
                <label className="field">
                  <span>Agent</span>
                  <select
                    value=${selectedAgentId}
                    onChange=${function (event) {
                      setSelectedAgentId(event.target.value)
                    }}
                  >
                    ${roster.map(function (agent) {
                      return html`<option key=${agent.id} value=${agent.id}>${agent.name}</option>`
                    })}
                  </select>
                </label>
                ${selectedNotes.length
                  ? html`
                      <ol className="memory-notes">
                        ${selectedNotes.map(function (note) {
                          return html`
                            <li key=${note.id}>
                              ${note.note}
                              <div className="memory-time">${toClock(note.createdAt)}</div>
                            </li>
                          `
                        })}
                      </ol>
                    `
                  : html`<p className="empty-note">No scoped notes yet for this agent.</p>`}
              </section>

              <section className="context-card">
                <h4>Runtime stats</h4>
                <div className="stat-row">
                  <span>Total token estimate</span>
                  <strong>${tokenStats.total}</strong>
                </div>
                <div className="meter" aria-hidden="true"><span style=${{ width: tokenPercent + '%' }}></span></div>
                <div className="stat-row">
                  <span>Prompt turns processed</span>
                  <strong>${tokenStats.turns}</strong>
                </div>
                <div className="stat-row">
                  <span>Last round latency</span>
                  <strong>${lastLatency} ms</strong>
                </div>
                <div className="stat-row">
                  <span>Session id</span>
                  <strong>${shortText(sessionId, 16)}</strong>
                </div>
              </section>
            </div>
          </aside>
        </div>

        <p className="sr-only" role="status" aria-live="assertive">${announcement}</p>
      </div>
    `
  }

  var mountNode = document.getElementById('soul-tavern-root')
  if (!mountNode) {
    return
  }

  if (typeof window.ReactDOM.createRoot === 'function') {
    window.ReactDOM.createRoot(mountNode).render(html`<${App} />`)
  } else if (typeof window.ReactDOM.render === 'function') {
    window.ReactDOM.render(html`<${App} />`, mountNode)
  }
})()
