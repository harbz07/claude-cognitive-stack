// ============================================================
// STORAGE — D1 Database layer
// Supports: sessions, memory_items (L2/L3), skill_packages,
//           request_traces, consolidation_jobs, api_keys,
//           projects (namespace isolation)
// ============================================================

export class StorageService {
  constructor(private db: D1Database) {}

  async initialize(): Promise<void> {
    const ddl = [
      // ── Memory Items (L2/L3) ─────────────────────────────
      `CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('episodic','semantic','summary')),
        scope TEXT NOT NULL CHECK(scope IN ('session','project','global')),
        content TEXT NOT NULL,
        embedding TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0.8,
        decay_score REAL NOT NULL DEFAULT 0.0,
        token_count INTEGER NOT NULL DEFAULT 0,
        session_id TEXT NOT NULL,
        project_id TEXT,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_items(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_items(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_user    ON memory_items(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_scope   ON memory_items(scope)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_type    ON memory_items(type)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_decay   ON memory_items(decay_score)`,

      // ── Sessions ─────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT,
        token_budget INTEGER NOT NULL DEFAULT 8192,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        sliding_window TEXT NOT NULL DEFAULT '[]',
        running_state TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`,

      // ── Projects (namespace isolation) ───────────────────
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        skill_loadout TEXT NOT NULL DEFAULT '[]',
        model_override TEXT,
        thalamus_threshold REAL DEFAULT 0.72,
        insula_mode TEXT NOT NULL DEFAULT 'standard',
        rag_top_k INTEGER NOT NULL DEFAULT 5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`,

      // ── Skill Packages ────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS skill_packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        trigger_pattern TEXT NOT NULL,
        system_fragment TEXT NOT NULL,
        tools TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 0,
        token_budget INTEGER NOT NULL DEFAULT 500,
        max_context_tokens INTEGER NOT NULL DEFAULT 8192,
        compatible_models TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,

      // ── Request Traces ────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS request_traces (
        trace_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        request_at TEXT NOT NULL,
        completed_at TEXT,
        stage_log TEXT NOT NULL DEFAULT '[]',
        retrieval_candidates TEXT NOT NULL DEFAULT '[]',
        thalamus_scores TEXT NOT NULL DEFAULT '[]',
        dropped_context TEXT NOT NULL DEFAULT '[]',
        citations TEXT NOT NULL DEFAULT '[]',
        memory_diff TEXT,
        token_breakdown TEXT,
        consolidation_queued INTEGER NOT NULL DEFAULT 0,
        consolidation_type TEXT,
        error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_traces_session    ON request_traces(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_traces_user       ON request_traces(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_traces_request_at ON request_traces(request_at)`,

      // ── Consolidation Jobs ────────────────────────────────
      `CREATE TABLE IF NOT EXISTS consolidation_jobs (
        job_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        consolidation_type TEXT NOT NULL DEFAULT 'token_pressure',
        status TEXT NOT NULL DEFAULT 'pending',
        transcript TEXT NOT NULL DEFAULT '[]',
        context_used TEXT NOT NULL DEFAULT '{}',
        insula_permissions TEXT NOT NULL DEFAULT '{}',
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        processed_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_status  ON consolidation_jobs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_session ON consolidation_jobs(session_id)`,

      // ── API Keys ──────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS api_keys (
        key_id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_used TEXT
      )`,

      // ── Seed built-in skills ──────────────────────────────
      `INSERT OR IGNORE INTO skill_packages
        (id, name, version, trigger_pattern, system_fragment, tools, priority, token_budget,
         max_context_tokens, compatible_models, enabled, metadata, created_at)
       VALUES
        ('general','General Assistant','1.0.0','.','You are a helpful, precise, and memory-aware assistant.','[]',0,200,8192,'["gpt-5","claude-sonnet-4-5"]',1,'{"builtin":true}','2026-01-01T00:00:00Z')`,
      `INSERT OR IGNORE INTO skill_packages
        (id, name, version, trigger_pattern, system_fragment, tools, priority, token_budget,
         max_context_tokens, compatible_models, enabled, metadata, created_at)
       VALUES
        ('code','Code Assistant','1.0.0','\\b(code|function|debug|implement|typescript|javascript|python|sql|bug|error)\\b','You are also an expert software engineer. Write clean, typed, commented code.','[]',10,300,16384,'["gpt-5","claude-sonnet-4-5"]',1,'{"builtin":true}','2026-01-01T00:00:00Z')`,
      `INSERT OR IGNORE INTO skill_packages
        (id, name, version, trigger_pattern, system_fragment, tools, priority, token_budget,
         max_context_tokens, compatible_models, enabled, metadata, created_at)
       VALUES
        ('research','Research Mode','1.0.0','\\b(research|analyze|compare|explain|why|how does|what is)\\b','You are a thorough researcher. Structure answers clearly. State confidence levels.','[]',5,250,16384,'["gpt-5","claude-opus-4-5"]',1,'{"builtin":true}','2026-01-01T00:00:00Z')`,
      `INSERT OR IGNORE INTO skill_packages
        (id, name, version, trigger_pattern, system_fragment, tools, priority, token_budget,
         max_context_tokens, compatible_models, enabled, metadata, created_at)
       VALUES
        ('memory_aware','Memory-Aware Mode','1.0.0','\\b(remember|recall|earlier|before|last time|previously)\\b','The user is referencing prior context. Reference retrieved memories explicitly.','[]',15,150,8192,'["gpt-5","gpt-5-mini"]',1,'{"builtin":true}','2026-01-01T00:00:00Z')`,
      `INSERT OR IGNORE INTO skill_packages
        (id, name, version, trigger_pattern, system_fragment, tools, priority, token_budget,
         max_context_tokens, compatible_models, enabled, metadata, created_at)
       VALUES
        ('project_scope','Project Scope','1.0.0','\\b(project|workspace|this project|our project)\\b','You are working within a specific project context. Prioritize project-scoped memories.','[]',8,200,8192,'["gpt-5","claude-sonnet-4-5"]',1,'{"builtin":true}','2026-01-01T00:00:00Z')`,
    ]

    for (const sql of ddl) {
      try {
        await this.db.prepare(sql).run()
      } catch (e: any) {
        if (!e.message?.includes('already exists') && !e.message?.includes('duplicate')) {
          console.error('Migration error:', e.message?.slice(0, 120))
        }
      }
    }
  }

  // ── Sessions ───────────────────────────────────────────────

  async getSession(session_id: string): Promise<any | null> {
    const row = await this.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .bind(session_id)
      .first()
    if (!row) return null
    return {
      ...row,
      sliding_window: JSON.parse(row.sliding_window as string),
      running_state:  JSON.parse(row.running_state as string),
      metadata:       JSON.parse(row.metadata as string),
    }
  }

  async upsertSession(session: any): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO sessions
          (session_id, user_id, project_id, token_budget, tokens_used,
           sliding_window, running_state, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          tokens_used    = excluded.tokens_used,
          sliding_window = excluded.sliding_window,
          running_state  = excluded.running_state,
          metadata       = excluded.metadata,
          updated_at     = excluded.updated_at
      `)
      .bind(
        session.session_id,
        session.user_id,
        session.project_id ?? null,
        session.token_budget,
        session.tokens_used,
        JSON.stringify(session.sliding_window),
        JSON.stringify(session.running_state),
        JSON.stringify(session.metadata),
        session.created_at,
        session.updated_at,
      )
      .run()
  }

  // ── Projects ───────────────────────────────────────────────

  async getProject(project_id: string): Promise<any | null> {
    const row = await this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(project_id)
      .first()
    if (!row) return null
    return {
      ...row,
      skill_loadout: JSON.parse(row.skill_loadout as string),
      metadata:      JSON.parse(row.metadata as string),
    }
  }

  async upsertProject(project: any): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO projects
          (id, user_id, name, description, skill_loadout, model_override,
           thalamus_threshold, insula_mode, rag_top_k, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name               = excluded.name,
          description        = excluded.description,
          skill_loadout      = excluded.skill_loadout,
          model_override     = excluded.model_override,
          thalamus_threshold = excluded.thalamus_threshold,
          insula_mode        = excluded.insula_mode,
          rag_top_k          = excluded.rag_top_k,
          updated_at         = excluded.updated_at,
          metadata           = excluded.metadata
      `)
      .bind(
        project.id,
        project.user_id,
        project.name,
        project.description ?? '',
        JSON.stringify(project.skill_loadout ?? []),
        project.model_override ?? null,
        project.thalamus_threshold ?? 0.72,
        project.insula_mode ?? 'standard',
        project.rag_top_k ?? 5,
        project.created_at,
        project.updated_at,
        JSON.stringify(project.metadata ?? {}),
      )
      .run()
  }

  async listProjects(user_id: string): Promise<any[]> {
    const result = await this.db
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50')
      .bind(user_id)
      .all()
    return result.results.map((r) => ({
      ...r,
      skill_loadout: JSON.parse(r.skill_loadout as string),
      metadata:      JSON.parse(r.metadata as string),
    }))
  }

  async deleteProject(project_id: string, user_id: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
      .bind(project_id, user_id)
      .run()
  }

  // ── Memory Items ───────────────────────────────────────────

  async insertMemoryItem(item: any): Promise<void> {
    const sessionId = item.source?.session_id ?? item.provenance?.session_id ?? 'unknown'
    const source    = item.source?.type       ?? item.provenance?.source    ?? 'system'

    await this.db
      .prepare(`
        INSERT OR REPLACE INTO memory_items
          (id, type, scope, content, embedding, tags, confidence, decay_score,
           token_count, session_id, project_id, user_id, source, created_at, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        item.id,
        item.type,
        item.scope,
        item.content,
        item.embedding ? JSON.stringify(item.embedding) : null,
        JSON.stringify(item.tags ?? []),
        item.confidence ?? 0.8,
        item.decay_score ?? 0,
        item.token_count ?? 0,
        sessionId,
        item.project_id ?? null,
        item.user_id    ?? 'unknown',
        source,
        item.created_at,
        item.last_accessed,
      )
      .run()
  }

  async queryMemory(params: {
    user_id: string
    session_id?: string
    project_id?: string
    scope?: string
    type?: string
    limit?: number
    exclude_high_decay?: boolean
  }): Promise<any[]> {
    const conditions: string[] = ['user_id = ?']
    const bindings: any[] = [params.user_id]

    if (params.scope) {
      conditions.push('(scope = ? OR scope = ?)')
      bindings.push(params.scope, 'global')
    }
    if (params.type) {
      conditions.push('type = ?')
      bindings.push(params.type)
    }

    // Project namespace isolation:
    // If project_id supplied → session items OR project-scoped OR global
    // If no project_id         → session items OR global only
    if (params.session_id && params.project_id) {
      conditions.push(`(session_id = ? OR project_id = ? OR scope = 'global')`)
      bindings.push(params.session_id, params.project_id)
    } else if (params.session_id) {
      conditions.push(`(session_id = ? OR scope IN ('project','global'))`)
      bindings.push(params.session_id)
    }

    if (params.exclude_high_decay) {
      conditions.push('decay_score < 0.8')
    }

    const limit = params.limit ?? 50
    const sql = `
      SELECT * FROM memory_items
      WHERE ${conditions.join(' AND ')}
      ORDER BY last_accessed DESC, confidence DESC
      LIMIT ${limit}
    `
    const result = await this.db.prepare(sql).bind(...bindings).all()
    return result.results.map((r) => ({
      ...r,
      embedding: r.embedding ? JSON.parse(r.embedding as string) : null,
      tags:      JSON.parse(r.tags as string),
    }))
  }

  async touchMemoryItem(id: string): Promise<void> {
    await this.db
      .prepare('UPDATE memory_items SET last_accessed = ? WHERE id = ?')
      .bind(new Date().toISOString(), id)
      .run()
  }

  // Fetch items that have embeddings stored — for cosine ranking
  async queryMemoryWithEmbeddings(params: {
    user_id: string
    session_id?: string
    project_id?: string
    scope?: string
    limit?: number
  }): Promise<any[]> {
    const conditions: string[] = ['user_id = ?', 'embedding IS NOT NULL']
    const bindings: any[] = [params.user_id]

    if (params.scope) {
      conditions.push('(scope = ? OR scope = ?)')
      bindings.push(params.scope, 'global')
    }
    if (params.session_id) {
      conditions.push("(session_id = ? OR scope IN ('project','global'))")
      bindings.push(params.session_id)
    }
    // Always exclude heavily decayed items
    conditions.push('decay_score < 0.85')

    const limit = params.limit ?? 100
    const sql = `
      SELECT * FROM memory_items
      WHERE ${conditions.join(' AND ')}
      ORDER BY last_accessed DESC, confidence DESC
      LIMIT ${limit}
    `
    const result = await this.db.prepare(sql).bind(...bindings).all()
    return result.results.map((r) => ({
      ...r,
      embedding: r.embedding ? JSON.parse(r.embedding as string) : null,
      tags: JSON.parse(r.tags as string),
    }))
  }

  async updateMemoryEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.db
      .prepare('UPDATE memory_items SET embedding = ? WHERE id = ?')
      .bind(JSON.stringify(embedding), id)
      .run()
  }

  async updateDecayScores(items: Array<{ id: string; decay_score: number }>): Promise<void> {
    for (const item of items) {
      await this.db
        .prepare('UPDATE memory_items SET decay_score = ? WHERE id = ?')
        .bind(item.decay_score, item.id)
        .run()
    }
  }

  async getMemoryItem(id: string): Promise<any | null> {
    const row = await this.db
      .prepare('SELECT * FROM memory_items WHERE id = ?')
      .bind(id)
      .first()
    if (!row) return null
    return {
      ...row,
      embedding: row.embedding ? JSON.parse(row.embedding as string) : null,
      tags:      JSON.parse(row.tags as string),
    }
  }

  async countMemoryByUser(user_id: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) as cnt FROM memory_items WHERE user_id = ?')
      .bind(user_id)
      .first()
    return (row?.cnt as number) ?? 0
  }

  // ── Traces ─────────────────────────────────────────────────

  async insertTrace(trace: any): Promise<void> {
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO request_traces
          (trace_id, session_id, user_id, request_at, completed_at, stage_log,
           retrieval_candidates, thalamus_scores, dropped_context,
           citations, memory_diff, token_breakdown,
           consolidation_queued, consolidation_type, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        trace.trace_id,
        trace.session_id,
        trace.user_id,
        trace.request_at,
        trace.completed_at ?? null,
        JSON.stringify(trace.stages ?? []),
        JSON.stringify(trace.retrieval_candidates ?? []),
        JSON.stringify(trace.thalamus_scores ?? []),
        JSON.stringify(trace.dropped_context ?? []),
        JSON.stringify(trace.citations ?? []),
        trace.memory_diff ? JSON.stringify(trace.memory_diff) : null,
        trace.token_breakdown ? JSON.stringify(trace.token_breakdown) : null,
        trace.consolidation_queued ? 1 : 0,
        trace.consolidation_type ?? null,
        trace.error ?? null,
      )
      .run()
  }

  async getTrace(trace_id: string): Promise<any | null> {
    const row = await this.db
      .prepare('SELECT * FROM request_traces WHERE trace_id = ?')
      .bind(trace_id)
      .first()
    if (!row) return null
    return {
      ...row,
      stages:                JSON.parse(row.stage_log as string),
      retrieval_candidates:  JSON.parse(row.retrieval_candidates as string),
      thalamus_scores:       JSON.parse(row.thalamus_scores as string),
      dropped_context:       JSON.parse(row.dropped_context as string),
      citations:             JSON.parse((row.citations as string) || '[]'),
      memory_diff:           row.memory_diff ? JSON.parse(row.memory_diff as string) : null,
      token_breakdown:       row.token_breakdown ? JSON.parse(row.token_breakdown as string) : null,
    }
  }

  async listTraces(params: {
    session_id?: string
    user_id?: string
    limit?: number
  }): Promise<any[]> {
    const conditions: string[] = []
    const bindings: any[] = []
    if (params.session_id) { conditions.push('session_id = ?'); bindings.push(params.session_id) }
    if (params.user_id)    { conditions.push('user_id = ?');    bindings.push(params.user_id) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = params.limit ?? 20
    const result = await this.db
      .prepare(`SELECT * FROM request_traces ${where} ORDER BY request_at DESC LIMIT ${limit}`)
      .bind(...bindings)
      .all()
    return result.results.map((r) => ({
      ...r,
      citations:      JSON.parse((r.citations as string) || '[]'),
      token_breakdown: r.token_breakdown ? JSON.parse(r.token_breakdown as string) : null,
    }))
  }

  // ── Consolidation Jobs ─────────────────────────────────────

  async insertConsolidationJob(job: any): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO consolidation_jobs
          (job_id, session_id, trace_id, consolidation_type, status,
           transcript, context_used, insula_permissions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        job.job_id,
        job.session_id,
        job.trace_id,
        job.consolidation_type ?? 'token_pressure',
        'pending',
        JSON.stringify(job.transcript),
        JSON.stringify(job.context_used),
        JSON.stringify(job.insula_permissions),
        new Date().toISOString(),
      )
      .run()
  }

  async getPendingJobs(limit = 10): Promise<any[]> {
    const result = await this.db
      .prepare("SELECT * FROM consolidation_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?")
      .bind(limit)
      .all()
    return result.results.map((r) => ({
      ...r,
      transcript:         JSON.parse(r.transcript as string),
      context_used:       JSON.parse(r.context_used as string),
      insula_permissions: JSON.parse(r.insula_permissions as string),
    }))
  }

  async updateJobStatus(
    job_id: string,
    status: string,
    result?: any,
    error?: string,
  ): Promise<void> {
    await this.db
      .prepare(`
        UPDATE consolidation_jobs
        SET status = ?, result = ?, error = ?, processed_at = ?
        WHERE job_id = ?
      `)
      .bind(
        status,
        result ? JSON.stringify(result) : null,
        error ?? null,
        new Date().toISOString(),
        job_id,
      )
      .run()
  }

  // ── Skills ─────────────────────────────────────────────────

  async listSkills(project_id?: string): Promise<any[]> {
    const result = await this.db
      .prepare('SELECT * FROM skill_packages WHERE enabled = 1 ORDER BY priority DESC')
      .all()
    return result.results.map((r) => ({
      ...r,
      tools:             JSON.parse(r.tools as string),
      compatible_models: JSON.parse((r.compatible_models as string) || '[]'),
      metadata:          JSON.parse(r.metadata as string),
    }))
  }

  async getSkill(id: string): Promise<any | null> {
    const row = await this.db
      .prepare('SELECT * FROM skill_packages WHERE id = ?')
      .bind(id)
      .first()
    if (!row) return null
    return {
      ...row,
      tools:             JSON.parse(row.tools as string),
      compatible_models: JSON.parse((row.compatible_models as string) || '[]'),
      metadata:          JSON.parse(row.metadata as string),
    }
  }

  // ── API Keys ───────────────────────────────────────────────

  async validateApiKey(
    keyHash: string,
  ): Promise<{ user_id: string; rate_limit_rpm: number } | null> {
    const row = await this.db
      .prepare("SELECT user_id, rate_limit_rpm FROM api_keys WHERE key_hash = ? AND enabled = 1")
      .bind(keyHash)
      .first()
    if (!row) return null
    await this.db
      .prepare('UPDATE api_keys SET last_used = ? WHERE key_hash = ?')
      .bind(new Date().toISOString(), keyHash)
      .run()
    return { user_id: row.user_id as string, rate_limit_rpm: row.rate_limit_rpm as number }
  }

  // ── Stats ──────────────────────────────────────────────────

  async getSystemStats(): Promise<any> {
    const [memRow, traceRow, sessionRow, jobRow] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as total_memories FROM memory_items').first(),
      this.db.prepare('SELECT COUNT(*) as total_traces FROM request_traces').first(),
      this.db.prepare('SELECT COUNT(*) as total_sessions FROM sessions').first(),
      this.db.prepare("SELECT COUNT(*) as pending_jobs FROM consolidation_jobs WHERE status = 'pending'").first(),
    ])
    return {
      total_memories:           memRow?.total_memories ?? 0,
      total_traces:             traceRow?.total_traces ?? 0,
      total_sessions:           sessionRow?.total_sessions ?? 0,
      pending_consolidation_jobs: jobRow?.pending_jobs ?? 0,
    }
  }
}
