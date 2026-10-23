import { z } from 'zod/v4'
import { setScheduledTasksEnabled } from '../../bootstrap/state.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { cronToHuman, parseCronExpression } from '../../utils/cron.js'
import {
  addCronTask,
  getCronFilePath,
  listAllCronTasks,
  nextCronRunMs,
} from '../../utils/cronTasks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import { getTeammateContext } from '../../utils/teammateContext.js'
import {
  buildCronCreateDescription,
  buildCronCreatePrompt,
  CRON_CREATE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
  isDurableCronEnabled,
  isKairosCronEnabled,
} from './prompt.js'
import { renderCreateResultMessage, renderCreateToolUseMessage } from './UI.js'

// MAX_JOBS = 50：定时任务总量硬顶。超限不报「系统错误」而是让模型自己取消一个——配额是用户可理解的资源，不是故障。
const MAX_JOBS = 50

// inputSchema 三参数：cron（5 段标准表达式，本地时区）、prompt（到点入队的提示词）、recurring（默认真=循环，假=一次性后自动删除）、durable（默认假=仅内存，真=落盘跨重启）。recurring/durable 都走 semanticBoolean——模型写 yes/true/1 都能识别。
const inputSchema = lazySchema(() =>
  z.strictObject({
    cron: z
      .string()
      .describe(
        'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
      ),
    prompt: z.string().describe('The prompt to enqueue at each fire time.'),
    recurring: semanticBoolean(z.boolean().optional()).describe(
      `true (default) = fire on every cron match until deleted or auto-expired after ${DEFAULT_MAX_AGE_DAYS} days. false = fire once at the next match, then auto-delete. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.`,
    ),
    durable: semanticBoolean(z.boolean().optional()).describe(
      'true = persist to .claude/scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when this Claude session ends. Use true only when the user asks the task to survive across sessions.',
    ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    humanSchedule: z.string(),
    recurring: z.boolean(),
    durable: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type CreateOutput = z.infer<OutputSchema>

// buildTool 主结构。description/prompt 都按 durableEnabled 动态生成——功能开关翻转时工具文案同步换档，模型看到的永远是当前真实能力。
export const CronCreateTool = buildTool({
  name: CRON_CREATE_TOOL_NAME,
  searchHint: 'schedule a recurring or one-shot prompt',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isKairosCronEnabled()
  },
  toAutoClassifierInput(input) {
    return `${input.cron}: ${input.prompt}`
  },
  async description() {
    return buildCronCreateDescription(isDurableCronEnabled())
  },
  async prompt() {
    return buildCronCreatePrompt(isDurableCronEnabled())
  },
  getPath() {
    return getCronFilePath()
  },
// validateInput 四道预检，错误码 1-4：① 表达式语法不合法；② 语法合法但一年内无匹配（如 2 月 30 日）——parseCronExpression 过不了日历关；③ 超过 50 个任务上限；④ teammate 禁用 durable（队友不跨会话持久化，durable 任务重启后 agentId 指向不存在的人，成孤儿）。
  async validateInput(input): Promise<ValidationResult> {
    if (!parseCronExpression(input.cron)) {
      return {
        result: false,
        message: `Invalid cron expression '${input.cron}'. Expected 5 fields: M H DoM Mon DoW.`,
        errorCode: 1,
      }
    }
    if (nextCronRunMs(input.cron, Date.now()) === null) {
// 「一年内无匹配」这道检查专门抓 2 月 30 日这类语法合法、日历非法的表达式——只查语法会漏，只在运行时炸更糟（任务永远不触发且无任何提示）。
      return {
        result: false,
        message: `Cron expression '${input.cron}' does not match any calendar date in the next year.`,
        errorCode: 2,
      }
    }
    const tasks = await listAllCronTasks()
// 任务数检查先全量拉列表再比长度——cron 任务是会话级小数据（≤50），全量拉取的成本远小于维护一个计数器。
    if (tasks.length >= MAX_JOBS) {
      return {
        result: false,
        message: `Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`,
        errorCode: 3,
      }
    }
    // Teammates don't persist across sessions, so a durable teammate cron
    // would orphan on restart (agentId would point to a nonexistent teammate).
// teammate durable 禁令的注释说明了根因：队友生命周期绑定会话，持久化任务在重启后持有悬空 agentId。错误消息直接给出结论，不解释原理——模型不需要懂孤儿任务，只需要知道换 session-only。
    if (input.durable && getTeammateContext()) {
      return {
        result: false,
        message:
          'durable crons are not supported for teammates (teammates do not persist across sessions)',
        errorCode: 4,
      }
    }
    return { result: true }
  },
// call() 第一行就是 kill switch 折损：effectiveDurable = durable && isDurableCronEnabled()。开关中途翻转时 schema 保持稳定（模型不会因功能降级吃到校验错误），只在执行时静默降级——「能力可以撤，接口不能变」。
  async call({ cron, prompt, recurring = true, durable = false }) {
    // Kill switch forces session-only; schema stays stable so the model sees
    // no validation errors when the gate flips mid-session.
    const effectiveDurable = durable && isDurableCronEnabled()
// effectiveDurable 折损后照常入队，返回的 durable 字段是折损后的真实值——tool_result 不说谎，模型能发现自己请求的持久化没生效。
    const id = await addCronTask(
      cron,
      prompt,
      recurring,
      effectiveDurable,
      getTeammateContext()?.agentId,
    )
    // Enable the scheduler so the task fires in this session. The
    // useScheduledTasks hook polls this flag and will start watching
    // on the next tick. For durable: false tasks the file never changes
    // — check() reads the session store directly — but the enable flag
    // is still what starts the tick loop.
// setScheduledTasksEnabled(true) 是让任务在本会话触发的关键一步：useScheduledTasks hook 轮询这个标志，下一 tick 开始监视。注意注释点破的一个错觉——durable: false 时磁盘文件永远不变（check() 直接读会话存储），但启动 tick 循环的仍然是这个 enable 标志，与持久化无关。
    setScheduledTasksEnabled(true)
    return {
      data: {
        id,
        humanSchedule: cronToHuman(cron),
        recurring,
        durable: effectiveDurable,
      },
    }
  },
// mapToolResult 按 recurring/durable 组合出四种文案， recurring 必须带 DEFAULT_MAX_AGE_DAYS 天数的过期提醒——「到点会自动消失」要当着用户的面说，否则循环任务某天悄悄停止会被当成故障。
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const where = output.durable
      ? 'Persisted to .claude/scheduled_tasks.json'
      : 'Session-only (not written to disk, dies when Claude exits)'
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.recurring
        ? `Scheduled recurring job ${output.id} (${output.humanSchedule}). ${where}. Auto-expires after ${DEFAULT_MAX_AGE_DAYS} days. Use CronDelete to cancel sooner.`
        : `Scheduled one-shot task ${output.id} (${output.humanSchedule}). ${where}. It will fire once then auto-delete.`,
    }
  },
  renderToolUseMessage: renderCreateToolUseMessage,
  renderToolResultMessage: renderCreateResultMessage,
} satisfies ToolDef<InputSchema, CreateOutput>)
