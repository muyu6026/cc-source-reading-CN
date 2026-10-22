import { memoize } from 'lodash-es'
import type { Command } from 'src/commands.js'
import {
  getCommandName,
  getSkillToolCommands,
  getSlashCommandToolSkills,
} from 'src/commands.js'
import { COMMAND_NAME_TAG } from '../../constants/xml.js'
import { stringWidth } from '../../ink/stringWidth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { count } from '../../utils/array.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { truncate } from '../../utils/format.js'
import { logError } from '../../utils/log.js'

// Skill listing gets 1% of the context window (in characters)
export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01
export const CHARS_PER_TOKEN = 4
export const DEFAULT_CHAR_BUDGET = 8_000 // Fallback: 1% of 200k × 4
// 技能清单的预算：上下文窗口的 1%（按 4 字符/token 折算），200K 窗口就是 8,000 字符。可用环境变量强制覆盖。技能是按需加载的（调用时才展开全文），清单本身只负责「让模型知道有哪些可选」。

// Per-entry hard cap. The listing is for discovery only — the Skill tool loads
// full content on invoke, so verbose whenToUse strings waste turn-1 cache_creation
// tokens without improving match rate. Applies to all entries, including bundled,
// since the cap is generous enough to preserve the core use case.
export const MAX_LISTING_DESC_CHARS = 250
// 单条硬上限 250 字符，对所有条目一视同仁（含内置技能）。英文注释把账算清了：清单只为发现服务，冗长的 whenToUse 只会烧掉第一轮的 cache_creation token，不提升匹配率——反正调用时会加载全文。

export function getCharBudget(contextWindowTokens?: number): number {
  if (Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)) {
    return Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)
  }
  if (contextWindowTokens) {
    return Math.floor(
      contextWindowTokens * CHARS_PER_TOKEN * SKILL_BUDGET_CONTEXT_PERCENT,
    )
  }
  return DEFAULT_CHAR_BUDGET
}
// 预算三级来源：环境变量 > 按窗口实算（tokens × 4 × 1%）> 8,000 兜底。注意 0 会被 Number() 转成 falsy 从而落到下一级——环境变量传 0 相当于没传。

function getCommandDescription(cmd: Command): string {
  const desc = cmd.whenToUse
    ? `${cmd.description} - ${cmd.whenToUse}`
    : cmd.description
  return desc.length > MAX_LISTING_DESC_CHARS
    ? desc.slice(0, MAX_LISTING_DESC_CHARS - 1) + '\u2026'
    : desc
}
// 描述 = description，声明了 whenToUse 就拼上（「是什么 - 什么时候用」）。超 250 截断加省略号。whenToUse 是技能作者写给模型的「路由信号」，与 description（写给人的说明）分开声明、合并展示。

function formatCommandDescription(cmd: Command): string {
  // Debug: log if userFacingName differs from cmd.name for plugin skills
  const displayName = getCommandName(cmd)
  if (
    cmd.name !== displayName &&
    cmd.type === 'prompt' &&
    cmd.source === 'plugin'
  ) {
    logForDebugging(
      `Skill prompt: showing "${cmd.name}" (userFacingName="${displayName}")`,
    )
  }

  return `- ${cmd.name}: ${getCommandDescription(cmd)}`
}

const MIN_DESC_LENGTH = 20

export function formatCommandsWithinBudget(
  commands: Command[],
  contextWindowTokens?: number,
): string {
  if (commands.length === 0) return ''

  const budget = getCharBudget(contextWindowTokens)

  // Try full descriptions first
  const fullEntries = commands.map(cmd => ({
    cmd,
    full: formatCommandDescription(cmd),
  }))
  // join('\n') produces N-1 newlines for N entries
  const fullTotal =
    fullEntries.reduce((sum, e) => sum + stringWidth(e.full), 0) +
    (fullEntries.length - 1)

  if (fullTotal <= budget) {
    return fullEntries.map(e => e.full).join('\n')
  }

  // Partition into bundled (never truncated) and rest
  const bundledIndices = new Set<number>()
  const restCommands: Command[] = []
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    if (cmd.type === 'prompt' && cmd.source === 'bundled') {
      bundledIndices.add(i)
    } else {
      restCommands.push(cmd)
    }
  }

  // Compute space used by bundled skills (full descriptions, always preserved)
  const bundledChars = fullEntries.reduce(
    (sum, e, i) =>
      bundledIndices.has(i) ? sum + stringWidth(e.full) + 1 : sum,
    0,
  )
  const remainingBudget = budget - bundledChars
// 预算不够时先保内置技能：bundled 条目永远保留完整描述，剩余预算才分给其余技能。bundled 的占用先从预算里扣除，再按人头均摊描述长度——分配算法是「保底优先、均摊其次」。

  // Calculate max description length for non-bundled commands
  if (restCommands.length === 0) {
    return fullEntries.map(e => e.full).join('\n')
  }

  const restNameOverhead =
    restCommands.reduce((sum, cmd) => sum + stringWidth(cmd.name) + 4, 0) +
    (restCommands.length - 1)
  const availableForDescs = remainingBudget - restNameOverhead
  const maxDescLen = Math.floor(availableForDescs / restCommands.length)

  if (maxDescLen < MIN_DESC_LENGTH) {
    // Extreme case: non-bundled go names-only, bundled keep descriptions
    if (process.env.USER_TYPE === 'ant') {
      logEvent('tengu_skill_descriptions_truncated', {
        skill_count: commands.length,
        budget,
        full_total: fullTotal,
        truncation_mode:
          'names_only' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        max_desc_length: maxDescLen,
        bundled_count: bundledIndices.size,
        bundled_chars: bundledChars,
      })
    }
    return commands
      .map((cmd, i) =>
        bundledIndices.has(i) ? fullEntries[i]!.full : `- ${cmd.name}`,
      )
      .join('\n')
  }
// 极端情况：均摊下来每条描述不足 20 字符时，非内置技能直接降级成只有名字（- name），内置技能仍带完整描述。降级同时打 tengu_skill_descriptions_truncated 遥测（truncation_mode: names_only），内部能监控到「技能太多把清单挤爆」的会话。

  // Truncate non-bundled descriptions to fit within budget
  const truncatedCount = count(
    restCommands,
    cmd => stringWidth(getCommandDescription(cmd)) > maxDescLen,
  )
  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_skill_descriptions_truncated', {
      skill_count: commands.length,
      budget,
      full_total: fullTotal,
      truncation_mode:
        'description_trimmed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      max_desc_length: maxDescLen,
      truncated_count: truncatedCount,
      // Count of bundled skills included in this prompt (excludes skills with disableModelInvocation)
      bundled_count: bundledIndices.size,
      bundled_chars: bundledChars,
    })
  }
  return commands
    .map((cmd, i) => {
      // Bundled skills always get full descriptions
      if (bundledIndices.has(i)) return fullEntries[i]!.full
      const description = getCommandDescription(cmd)
      return `- ${cmd.name}: ${truncate(description, maxDescLen)}`
    })
    .join('\n')
}
// 常规路径：按均摊长度逐条 truncate 描述（truncation_mode: description_trimmed）。两级降级的判断点在 maxDescLen < MIN_DESC_LENGTH(20)——宁可少给信息也不给半句废话。

export const getPrompt = memoize(async (_cwd: string): Promise<string> => {
// getPrompt 用 memoize 包住——prompt 在会话生命周期内只算一次（技能清单在会话中不刷新），clearPromptCache 提供手动失效口子。
  return `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - \`skill: "pdf"\` - invoke the pdf skill
  - \`skill: "commit", args: "-m 'Fix bug'"\` - invoke with arguments
  - \`skill: "review-pr", args: "123"\` - invoke with arguments
  - \`skill: "ms-office-suite:pdf"\` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <${COMMAND_NAME_TAG}> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
`
})
// prompt 文本的行为约定里最重的一条：技能匹配用户请求时是 BLOCKING REQUIREMENT，必须先调工具再生成任何关于任务的回复；以及看到 COMMAND_NAME_TAG 标签说明技能已加载，直接照做别再调一次。这两条共同防止「说而不调」和「重复加载」。

export async function getSkillToolInfo(cwd: string): Promise<{
  totalCommands: number
  includedCommands: number
}> {
  const agentCommands = await getSkillToolCommands(cwd)

  return {
    totalCommands: agentCommands.length,
    includedCommands: agentCommands.length,
  }
}

// Returns the commands included in the SkillTool prompt.
// All commands are always included (descriptions may be truncated to fit budget).
// Used by analyzeContext to count skill tokens.
export function getLimitedSkillToolCommands(cwd: string): Promise<Command[]> {
  return getSkillToolCommands(cwd)
}

export function clearPromptCache(): void {
  getPrompt.cache?.clear?.()
}

export async function getSkillInfo(cwd: string): Promise<{
  totalSkills: number
  includedSkills: number
}> {
  try {
    const skills = await getSlashCommandToolSkills(cwd)

    return {
      totalSkills: skills.length,
      includedSkills: skills.length,
    }
  } catch (error) {
    logError(toError(error))

    // Return zeros rather than throwing - let caller decide how to handle
    return {
      totalSkills: 0,
      includedSkills: 0,
    }
  }
}
