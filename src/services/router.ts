// ============================================================
// WERNICKE ROUTER — Orchestrates routing to subsystems,
//   activates skills, determines memory scopes, picks model.
// Spec: https://www.basecampgrounds.com (Wernicke Router node)
//
// Named after Wernicke's area — the language comprehension
// and routing center of the brain.
// ============================================================

import type { WernickeDecision, SkillPackage, SessionState, MemoryScope, ModelProfile } from '../types'
import { BUILTIN_SKILLS, estimateTokens } from '../config'

export class WernickeRouter {
  private skills: SkillPackage[]

  constructor(skills?: SkillPackage[]) {
    this.skills = skills ?? BUILTIN_SKILLS
  }

  /**
   * Core routing decision: given a user message and session state,
   * decide which skills to activate, which memory scopes to query,
   * which model to use, and which RAG sources to search.
   *
   * This is the "decision tree" referenced in the spec build guide step 2.
   */
  decide(message: string, session: SessionState, skillHints?: string[]): WernickeDecision {
    // ── 1. Skill Activation ───────────────────────────────────
    const activatedSkills = this.skills
      .filter((skill) => {
        if (!skill.enabled) return false
        // Explicit hint override
        if (skillHints?.includes(skill.id)) return true
        // Trigger pattern matching
        if (typeof skill.trigger === 'string') {
          return new RegExp(skill.trigger, 'i').test(message)
        }
        return skill.trigger.test(message)
      })
      .sort((a, b) => b.priority - a.priority)

    // Always ensure 'general' is included (base layer)
    if (!activatedSkills.some((s) => s.id === 'general')) {
      const general = this.skills.find((s) => s.id === 'general')
      if (general) activatedSkills.unshift(general)
    }

    // If we have a project_id in session, activate project_scope skill if available
    if (session.project_id) {
      const projectSkill = this.skills.find((s) => s.id === 'project_scope')
      if (projectSkill && !activatedSkills.some((s) => s.id === 'project_scope')) {
        activatedSkills.push(projectSkill)
      }
    }

    // ── 2. Memory Scopes ─────────────────────────────────────
    // Start with session scope always
    const scopes: MemoryScope[] = ['session']

    // Add project scope if this session has a project
    if (session.project_id) {
      scopes.push('project')
    }

    // Add global scope if user references persistent facts
    const globalMemoryKeywords = /\b(remember|recall|earlier|before|last time|previously|you said|we discussed|always|never|prefer|profile|my name|i am|i'm)\b/i
    if (globalMemoryKeywords.test(message)) {
      if (!scopes.includes('global')) scopes.push('global')
    }

    // ── 3. Model Profile ─────────────────────────────────────
    // Per spec model matrix:
    //   fast  → Haiku 4.5  (quick/simple queries)
    //   default → Sonnet 4.5 (balanced)
    //   deep  → Opus 4.6   (deep reasoning/research)
    let modelProfile: ModelProfile = 'default'

    if (/\b(quick|fast|simple|brief|tldr|short|one.?line)\b/i.test(message)) {
      modelProfile = 'fast'
    } else if (/\b(deep dive|thorough|comprehensive|detailed|research|analyze|explain in depth|full analysis)\b/i.test(message)) {
      modelProfile = 'deep'
    } else if (/\b(code|implement|function|class|debug|refactor|build|write a|create a|typescript|javascript)\b/i.test(message)) {
      modelProfile = 'code'
    }

    // ── 4. Deep Retrieval Determination ──────────────────────
    const tokenCount = estimateTokens(message)
    const requiresDeepRetrieval =
      tokenCount > 50 ||
      globalMemoryKeywords.test(message) ||
      /\b(context|history|conversation|previous|before|project|knowledge)\b/i.test(message)

    // ── 5. RAG Sources ────────────────────────────────────────
    // Always include knowledge_graph (L2 memory)
    const ragSources: WernickeDecision['rag_sources'] = ['knowledge_graph']

    // Include chat_index when user references prior conversation
    if (/\b(you said|earlier|before|last time|we talked|we discussed|the message|that response)\b/i.test(message)) {
      ragSources.push('chat_index')
    }

    // Include project_docs when project context is active
    if (session.project_id) {
      ragSources.push('project_docs')
    }

    // ── 6. RAG top_k ─────────────────────────────────────────
    const ragTopK = requiresDeepRetrieval ? 10 : 5

    // ── 7. Routing Decision Log ───────────────────────────────
    const reasoning = [
      `Skills: ${activatedSkills.map((s) => s.name).join(', ')}`,
      `Scopes: ${scopes.join(', ')}`,
      `Model: ${modelProfile}`,
      `RAG sources: ${ragSources.join(', ')}`,
      `RAG top_k: ${ragTopK}`,
      `Deep retrieval: ${requiresDeepRetrieval}`,
      session.project_id ? `Project: ${session.project_id}` : '',
    ].filter(Boolean).join(' | ')

    return {
      activated_skills:      activatedSkills,
      memory_scopes:         scopes,
      model_profile:         modelProfile,
      requires_deep_retrieval: requiresDeepRetrieval,
      rag_sources:           ragSources,
      rag_top_k:             ragTopK,
      min_score:             0.72,   // spec: thalamus_threshold default
      reasoning,
      project_id:            session.project_id ?? undefined,
    }
  }
}

// ─── Legacy alias for backwards compatibility ─────────────────
export class RouterService extends WernickeRouter {}
