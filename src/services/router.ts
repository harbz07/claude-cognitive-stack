// ============================================================
// ROUTER — Decides skills, memory scopes, model profile
// ============================================================

import type { RouterDecision, SkillPackage, SessionState, MemoryScope, ModelProfile } from '../types'
import { BUILTIN_SKILLS, estimateTokens } from '../config'

export class RouterService {
  private skills: SkillPackage[]

  constructor(skills?: SkillPackage[]) {
    this.skills = skills ?? BUILTIN_SKILLS
  }

  decide(message: string, session: SessionState, skillHints?: string[]): RouterDecision {
    const normalizedMsg = message.toLowerCase()

    // 1. Activate skills via trigger matching
    const activatedSkills = this.skills
      .filter((skill) => {
        if (!skill.enabled) return false
        if (skillHints?.includes(skill.id)) return true
        if (typeof skill.trigger === 'string') {
          return new RegExp(skill.trigger, 'i').test(message)
        }
        return skill.trigger.test(message)
      })
      .sort((a, b) => b.priority - a.priority)

    // Always ensure 'general' skill is included
    const hasGeneral = activatedSkills.some((s) => s.id === 'general')
    if (!hasGeneral) {
      const general = this.skills.find((s) => s.id === 'general')
      if (general) activatedSkills.unshift(general)
    }

    // 2. Determine memory scopes
    const scopes: MemoryScope[] = ['session']
    if (session.project_id) scopes.push('project')
    const memoryKeywords = /\b(remember|recall|earlier|before|last time|previously|you said|we discussed|always|never|prefer|profile)\b/i
    if (memoryKeywords.test(message)) scopes.push('global')

    // 3. Model profile
    let modelProfile: ModelProfile = 'default'
    if (/\b(quick|fast|simple|brief|tldr)\b/i.test(message)) {
      modelProfile = 'fast'
    } else if (/\b(deep dive|thorough|comprehensive|detailed|research|analyze)\b/i.test(message)) {
      modelProfile = 'deep'
    } else if (/\b(code|implement|function|class|debug|refactor|build)\b/i.test(message)) {
      modelProfile = 'code'
    }

    // 4. Deep retrieval if query is complex
    const tokenCount = estimateTokens(message)
    const requiresDeepRetrieval = tokenCount > 50 || memoryKeywords.test(message)

    const reasoning = [
      `Skills activated: ${activatedSkills.map((s) => s.name).join(', ')}`,
      `Memory scopes: ${scopes.join(', ')}`,
      `Model profile: ${modelProfile}`,
      `Deep retrieval: ${requiresDeepRetrieval}`,
    ].join(' | ')

    return {
      activated_skills: activatedSkills,
      memory_scopes: scopes,
      model_profile: modelProfile,
      requires_deep_retrieval: requiresDeepRetrieval,
      query_embedding_needed: requiresDeepRetrieval,
      reasoning,
    }
  }
}
