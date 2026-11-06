import { getBudgetContinuationMessage } from '../utils/tokenBudget.js'
// 从 utils 复用预算续跑文案：本文件是自动续跑或停止的判定器，把 token 预算逻辑抽成纯函数，CLI 与后台任务共用。

const COMPLETION_THRESHOLD = 0.9
// 两个阈值：完成率到九成才考虑继续；单轮增量低于五百 token 视为收益递减。
const DIMINISHING_THRESHOLD = 500

export type BudgetTracker = {
  continuationCount: number
  lastDeltaTokens: number
  lastGlobalTurnTokens: number
  startedAt: number
}
// 预算追踪器：累计续跑次数、最近一轮增量、全局轮次 token、起始时间戳。

export function createBudgetTracker(): BudgetTracker {
  return {
    continuationCount: 0,
    lastDeltaTokens: 0,
    lastGlobalTurnTokens: 0,
    startedAt: Date.now(),
  }
}
// 工厂函数：把追踪器初始化为零值，startedAt 记录起点用于算总时长。

type ContinueDecision = {
  action: 'continue'
  nudgeMessage: string
  continuationCount: number
  pct: number
  turnTokens: number
  budget: number
}
// 继续决策：带一句轻推文案，提示模型现在该收尾而不是无脑续跑。

type StopDecision = {
  action: 'stop'
  completionEvent: {
    continuationCount: number
    pct: number
    turnTokens: number
    budget: number
    diminishingReturns: boolean
    durationMs: number
  } | null
}
// 停止决策：可能带一个完成事件（含递减标记与耗时），也可能为 null 直接停。

export type TokenBudgetDecision = ContinueDecision | StopDecision
// 两种决策的联合类型，调用方靠 action 字段区分走哪条路。

export function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  globalTurnTokens: number,
): TokenBudgetDecision {
// 主判定函数：传入追踪器、agentId、预算、本轮 token，返回继续或停止。
  if (agentId || budget === null || budget <= 0) {
    return { action: 'stop', completionEvent: null }
  }
// 短路：队友会话或无预算（null 或小于等于零）一律停止，不让自动续跑介入。

  const turnTokens = globalTurnTokens
  const pct = Math.round((turnTokens / budget) * 100)
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens

  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD
// 递减判据：续跑达到三次且最近两轮增量都低于阈值，才认定收益递减。

  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount++
    tracker.lastDeltaTokens = deltaSinceLastCheck
    tracker.lastGlobalTurnTokens = globalTurnTokens
    return {
      action: 'continue',
      nudgeMessage: getBudgetContinuationMessage(pct, turnTokens, budget),
      continuationCount: tracker.continuationCount,
      pct,
      turnTokens,
      budget,
    }
  }
// 继续分支：未递减且未到九成，累加续跑次数、刷新追踪器、返回续跑文案。

  if (isDiminishing || tracker.continuationCount > 0) {
    return {
      action: 'stop',
      completionEvent: {
        continuationCount: tracker.continuationCount,
        pct,
        turnTokens,
        budget,
        diminishingReturns: isDiminishing,
        durationMs: Date.now() - tracker.startedAt,
      },
    }
  }
// 停止分支：已递减或至少续跑过一次就停；否则压根没续跑过也直接停。

  return { action: 'stop', completionEvent: null }
}
// 文件收尾：所有路径都显式返回 stop 或 continue，无隐式兜底。
