// 注：本文件实现「技能自我改进」钩子：在用户执行项目级技能时，用一个小模型从最近对话里抽取可固化的偏好与修正，并可选地由侧信道模型改写 SKILL.md。
import { feature } from 'bun:bundle'
import { getInvokedSkillsForAgent } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createAbortController } from '../abortController.js'
import { count } from '../array.js'
import { getCwd } from '../cwd.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import {
  createUserMessage,
  extractTag,
  extractTextContent,
} from '../messages.js'
import { getSmallFastModel } from '../model/model.js'
import { jsonParse } from '../slowOperations.js'
import { asSystemPrompt } from '../systemPromptType.js'
import {
  type ApiQueryHookConfig,
  createApiQueryHook,
} from './apiQueryHookHelper.js'
import { registerPostSamplingHook } from './postSamplingHooks.js'

// 注：TURN_BATCH_SIZE 控制每隔多少条用户消息才跑一次分析；SkillUpdate 描述一次改进建议的三要素：改哪段、改什么、由哪条消息触发。
const TURN_BATCH_SIZE = 5

export type SkillUpdate = {
  section: string
  change: string
  reason: string
}

// 注：formatRecentMessages 把最近若干用户/助手消息压成纯文本摘要（每条最多 500 字符），喂给改进模型。
function formatRecentMessages(messages: Message[]): string {
  return messages
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => {
      const role = m.type === 'user' ? 'User' : 'Assistant'
      const content = m.message.content
      if (typeof content === 'string')
        return `${role}: ${content.slice(0, 500)}`
      const text = content
        .filter(
          (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
        )
        .map(b => b.text)
        .join('\n')
      return `${role}: ${text.slice(0, 500)}`
    })
    .join('\n\n')
}

function findProjectSkill() {
  const skills = getInvokedSkillsForAgent(null)
  for (const [, info] of skills) {
    if (info.skillPath.startsWith('projectSettings:')) {
      return info
    }
  }
  return undefined
}

// 注：createSkillImprovementHook 构造采样后钩子：只在主线程、且存在项目级技能、且攒够一批用户消息时才运行，调用小模型抽取改进点。
function createSkillImprovementHook() {
  let lastAnalyzedCount = 0
  let lastAnalyzedIndex = 0

  const config: ApiQueryHookConfig<SkillUpdate[]> = {
    name: 'skill_improvement',

    async shouldRun(context) {
      if (context.querySource !== 'repl_main_thread') {
        return false
      }

      if (!findProjectSkill()) {
        return false
      }

      // Only run every TURN_BATCH_SIZE user messages
      const userCount = count(context.messages, m => m.type === 'user')
      if (userCount - lastAnalyzedCount < TURN_BATCH_SIZE) {
        return false
      }

      lastAnalyzedCount = userCount
      return true
    },

// 注：buildMessages 只分析自上次检查以来的新消息，把技能定义与近期对话拼成提示词，让模型输出 updates 标签里的 JSON 数组。
    buildMessages(context) {
      const projectSkill = findProjectSkill()!
      // Only analyze messages since the last check — the skill definition
      // provides enough context for the classifier to understand corrections
      const newMessages = context.messages.slice(lastAnalyzedIndex)
      lastAnalyzedIndex = context.messages.length

      return [
        createUserMessage({
          content: `You are analyzing a conversation where a user is executing a skill (a repeatable process).
Your job: identify if the user's recent messages contain preferences, requests, or corrections that should be permanently added to the skill definition for future runs.

<skill_definition>
${projectSkill.content}
</skill_definition>

<recent_messages>
${formatRecentMessages(newMessages)}
</recent_messages>

Look for:
- Requests to add, change, or remove steps: "can you also ask me X", "please do Y too", "don't do Z"
- Preferences about how steps should work: "ask me about energy levels", "note the time", "use a casual tone"
- Corrections: "no, do X instead", "always use Y", "make sure to..."

Ignore:
- Routine conversation that doesn't generalize (one-time answers, chitchat)
- Things the skill already does

Output a JSON array inside <updates> tags. Each item: {"section": "which step/section to modify or 'new step'", "change": "what to add/modify", "reason": "which user message prompted this"}.
Output <updates>[]</updates> if no updates are needed.`,
        }),
      ]
    },

    systemPrompt:
      'You detect user preferences and process improvements during skill execution. Flag anything the user asks for that should be remembered for next time.',

    useTools: false,

    parseResponse(content) {
      const updatesStr = extractTag(content, 'updates')
      if (!updatesStr) {
        return []
      }
      try {
        return jsonParse(updatesStr) as SkillUpdate[]
      } catch {
        return []
      }
    },

// 注：logResult 在命中改进时上报分析事件，并把建议写回 AppState，供 UI 提示用户「技能可改进」。
    logResult(result, context) {
      if (result.type === 'success' && result.result.length > 0) {
        const projectSkill = findProjectSkill()
        const skillName = projectSkill?.skillName ?? 'unknown'

        logEvent('tengu_skill_improvement_detected', {
          updateCount: result.result
            .length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          uuid: result.uuid as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          // _PROTO_skill_name routes to the privileged skill_name BQ column.
          _PROTO_skill_name:
            skillName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        })

        context.toolUseContext.setAppState(prev => ({
          ...prev,
          skillImprovement: {
            suggestion: { skillName, updates: result.result },
          },
        }))
      }
    },

    getModel: getSmallFastModel,
  }

  return createApiQueryHook(config)
}

// 注：initSkillImprovement 在功能开关与灰度命中时，把上述钩子注册为采样后钩子。
export function initSkillImprovement(): void {
  if (
    feature('SKILL_IMPROVEMENT') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_copper_panda', false)
  ) {
    registerPostSamplingHook(createSkillImprovementHook())
  }
}

/**
 * Apply skill improvements by calling a side-channel LLM to rewrite the skill file.
 * Fire-and-forget — does not block the main conversation.
 */
// 注：applySkillImprovement 是「发射后不管」的落地函数：读现有 SKILL.md，让模型把改进自然并入，再写回磁盘；全程不阻塞主对话。
export async function applySkillImprovement(
  skillName: string,
  updates: SkillUpdate[],
): Promise<void> {
  if (!skillName) return

  const { join } = await import('path')
  const fs = await import('fs/promises')

  // Skills live at .claude/skills/<name>/SKILL.md relative to CWD
  const filePath = join(getCwd(), '.claude', 'skills', skillName, 'SKILL.md')

  let currentContent: string
  try {
    currentContent = await fs.readFile(filePath, 'utf-8')
  } catch {
    logError(
      new Error(`Failed to read skill file for improvement: ${filePath}`),
    )
    return
  }

  const updateList = updates.map(u => `- ${u.section}: ${u.change}`).join('\n')

  const response = await queryModelWithoutStreaming({
    messages: [
      createUserMessage({
        content: `You are editing a skill definition file. Apply the following improvements to the skill.

<current_skill_file>
${currentContent}
</current_skill_file>

<improvements>
${updateList}
</improvements>

Rules:
- Integrate the improvements naturally into the existing structure
- Preserve frontmatter (--- block) exactly as-is
- Preserve the overall format and style
- Do not remove existing content unless an improvement explicitly replaces it
- Output the complete updated file inside <updated_file> tags`,
      }),
    ],
    systemPrompt: asSystemPrompt([
      'You edit skill definition files to incorporate user preferences. Output only the updated file content.',
    ]),
    thinkingConfig: { type: 'disabled' as const },
    tools: [],
    signal: createAbortController().signal,
    options: {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      model: getSmallFastModel(),
      toolChoice: undefined,
      isNonInteractiveSession: false,
      hasAppendSystemPrompt: false,
      temperatureOverride: 0,
      agents: [],
      querySource: 'skill_improvement_apply',
      mcpTools: [],
    },
  })

  const responseText = extractTextContent(response.message.content).trim()

  const updatedContent = extractTag(responseText, 'updated_file')
  if (!updatedContent) {
    logError(
      new Error('Skill improvement apply: no updated_file tag in response'),
    )
    return
  }

  try {
    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (e) {
    logError(toError(e))
  }
}
