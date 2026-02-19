// ============================================================
// PROJECTS ROUTES — /api/projects/*
// True project namespace isolation per spec
// ============================================================

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../index'
import { StorageService } from '../services/storage'

const projectSchema = z.object({
  name:               z.string().min(1).max(100),
  description:        z.string().max(500).optional().default(''),
  skill_loadout:      z.array(z.string()).optional().default([]),
  model_override:     z.enum(['default', 'fast', 'deep', 'code']).optional(),
  thalamus_threshold: z.number().min(0.1).max(1.0).optional().default(0.72),
  insula_mode:        z.enum(['standard', 'strict', 'permissive']).optional().default('standard'),
  rag_top_k:          z.number().min(1).max(20).optional().default(5),
  metadata:           z.record(z.unknown()).optional().default({}),
})

const projects = new Hono<{ Bindings: Env; Variables: { user_id: string } }>()

// ── POST /api/projects — Create a project ──────────────────
projects.post('/', zValidator('json', projectSchema), async (c) => {
  const body    = c.req.valid('json')
  const userId  = c.get('user_id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const now = new Date().toISOString()
  const id  = `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

  const project = {
    id,
    user_id:            userId,
    name:               body.name,
    description:        body.description,
    skill_loadout:      body.skill_loadout,
    model_override:     body.model_override ?? null,
    thalamus_threshold: body.thalamus_threshold,
    insula_mode:        body.insula_mode,
    rag_top_k:          body.rag_top_k,
    created_at:         now,
    updated_at:         now,
    metadata:           body.metadata,
  }

  await storage.upsertProject(project)
  return c.json(project, 201)
})

// ── GET /api/projects — List user projects ──────────────────
projects.get('/', async (c) => {
  const userId = c.get('user_id')
  if (!c.env.DB) return c.json({ projects: [] })

  const storage  = new StorageService(c.env.DB)
  const list     = await storage.listProjects(userId)
  return c.json({ projects: list, count: list.length })
})

// ── GET /api/projects/:id — Get a project ───────────────────
projects.get('/:id', async (c) => {
  const userId    = c.get('user_id')
  const projectId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const project = await storage.getProject(projectId)

  if (!project || project.user_id !== userId) {
    return c.json({ error: 'Project not found' }, 404)
  }
  return c.json(project)
})

// ── PUT /api/projects/:id — Update a project ─────────────────
projects.put('/:id', zValidator('json', projectSchema.partial()), async (c) => {
  const body      = c.req.valid('json')
  const userId    = c.get('user_id')
  const projectId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const existing = await storage.getProject(projectId)

  if (!existing || existing.user_id !== userId) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const updated = {
    ...existing,
    ...body,
    id:         projectId,
    user_id:    userId,
    updated_at: new Date().toISOString(),
  }
  await storage.upsertProject(updated)
  return c.json(updated)
})

// ── DELETE /api/projects/:id — Delete a project ──────────────
projects.delete('/:id', async (c) => {
  const userId    = c.get('user_id')
  const projectId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  await storage.deleteProject(projectId, userId)
  return c.json({ deleted: true })
})

// ── GET /api/projects/:id/memory — Project-scoped memory ─────
projects.get('/:id/memory', async (c) => {
  const userId    = c.get('user_id')
  const projectId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const items   = await storage.queryMemory({
    user_id:    userId,
    project_id: projectId,
    scope:      'project',
    limit:      50,
    exclude_high_decay: false,
  })

  return c.json({ items, count: items.length, project_id: projectId })
})

export { projects }
