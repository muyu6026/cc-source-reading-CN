// 技能使用记录的写入与评分。写入侧有一分钟去抖，评分侧用七天半衰期的指数衰减。两者配合的结果是：一次连续使用只记一次，但常用且最近的技能会稳定排在前面，供命令建议排序使用。
import { getGlobalConfig, saveGlobalConfig } from '../config.js'

const SKILL_USAGE_DEBOUNCE_MS = 60_000

// Process-lifetime debounce cache — avoids lock + read + parse on debounced
// calls. Same pattern as lastConfigStatTime / globalConfigWriteCount in config.ts.
const lastWriteBySkill = new Map<string, number>()
// 去抖缓存放在进程内存里而不是磁盘，注释点明它与配置模块里同类的两个时间戳缓存是同一套路。放内存的理由很直接：去抖本来就是「这次进程内刚刚写过」的判断，跨进程不需要一致。

/**
 * Records a skill usage for ranking purposes.
 * Updates both usage count and last used timestamp.
 */
export function recordSkillUsage(skillName: string): void {
  const now = Date.now()
  const lastWrite = lastWriteBySkill.get(skillName)
  // The ranking algorithm uses a 7-day half-life, so sub-minute granularity
  // is irrelevant. Bail out before saveGlobalConfig to avoid lock + file I/O.
  if (lastWrite !== undefined && now - lastWrite < SKILL_USAGE_DEBOUNCE_MS) {
    return
  }
// 早退发生在写配置之前，这一点是这段代码的价值所在：写全局配置要加锁、读文件、解析、再写回，一分钟内重复调用全部省掉。注释解释了为什么一分钟的粒度是可接受的——排序用的是七天半衰期，秒级差异对结果没有意义。
  lastWriteBySkill.set(skillName, now)
  saveGlobalConfig(current => {
    const existing = current.skillUsage?.[skillName]
    return {
      ...current,
      skillUsage: {
        ...current.skillUsage,
        [skillName]: {
          usageCount: (existing?.usageCount ?? 0) + 1,
          lastUsedAt: now,
        },
      },
    }
  })
}
// 真正写入时先更新内存里的时间戳再改配置，顺序不能反：如果先写配置再记时间戳，中间抛错就会导致下一次调用继续走完整写入路径，去抖形同虚设；反过来最坏只是丢掉一次计数。计数用「已有值加一」而不是覆盖，保证多次会话累积。

/**
 * Calculates a usage score for a skill based on frequency and recency.
 * Higher scores indicate more frequently and recently used skills.
 *
 * The score uses exponential decay with a half-life of 7 days,
 * meaning usage from 7 days ago is worth half as much as usage today.
 */
export function getSkillUsageScore(skillName: string): number {
  const config = getGlobalConfig()
  const usage = config.skillUsage?.[skillName]
  if (!usage) return 0

  // Recency decay: halve score every 7 days
  const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24)
  const recencyFactor = Math.pow(0.5, daysSinceUse / 7)

  // Minimum recency factor of 0.1 to avoid completely dropping old but heavily used skills
  return usage.usageCount * Math.max(recencyFactor, 0.1)
}
// 评分是计数乘以衰减因子：衰减因子按「距今多少天除以七」做二的幂次，恰好七天时减半。最后给衰减因子设了下限十分之一——注释说明这是为了不让很久没用但用得很多的技能直接归零，保留一点历史权重。
