import {
  clearBetaHeaderLatches,
  clearSystemPromptSectionState,
  getSystemPromptSectionCache,
  setSystemPromptSectionCacheEntry,
} from '../bootstrap/state.js'
// 引入 bootstrap 状态层的缓存与重置工具

type ComputeFn = () => string | null | Promise<string | null>
// 计算函数类型：返回字符串或 null，可异步

type SystemPromptSection = {
// 系统提示段落类型：名字 + 计算函数 + 是否打断缓存
  name: string
  compute: ComputeFn
  cacheBreak: boolean
}

/**
 * Create a memoized system prompt section.
 * Computed once, cached until /clear or /compact.
 */
export function systemPromptSection(
// systemPromptSection：创建带记忆化的段落，默认 cacheBreak=false
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}
// 记忆化段落构造结束

/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 * Requires a reason explaining why cache-breaking is necessary.
 */
export function DANGEROUS_uncachedSystemPromptSection(
// DANGEROUS_uncachedSystemPromptSection：每轮重算、会打断提示缓存，调用方必须给理由
  name: string,
  compute: ComputeFn,
  _reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
// 易失段落构造结束
}

/**
 * Resolve all system prompt sections, returning prompt strings.
 */
export async function resolveSystemPromptSections(
// resolveSystemPromptSections：异步并行解析所有段落
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  const cache = getSystemPromptSectionCache()

  return Promise.all(
// 并行解析所有段落
    sections.map(async s => {
      if (!s.cacheBreak && cache.has(s.name)) {
        return cache.get(s.name) ?? null
      }
// 缓存命中直接返回
      const value = await s.compute()
      setSystemPromptSectionCacheEntry(s.name, value)
      return value
    }),
// 否则计算并写入缓存
  )
}

/**
 * Clear all system prompt section state. Called on /clear and /compact.
 * Also resets beta header latches so a fresh conversation gets fresh
 * evaluation of AFK/fast-mode/cache-editing headers.
 */
export function clearSystemPromptSections(): void {
// clearSystemPromptSections：清空段落状态并重置 beta 头部闩锁（/clear 与 /compact 调用）
  clearSystemPromptSectionState()
  clearBetaHeaderLatches()
}
