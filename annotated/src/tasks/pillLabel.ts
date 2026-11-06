// 导入菱形符号常量与数组计数工具；本文件生成后台任务页脚的「胶囊标签」
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../constants/figures.js'
import { count } from '../utils/array.js'
// 导入 count 计数辅助
import type { BackgroundTaskState } from './types.js'
// 导入 BackgroundTaskState 任务状态类型

/**
 * Produces the compact footer-pill label for a set of background tasks.
 * Used by both the footer pill and the turn-duration transcript line so the
 * two surfaces agree on terminology.
 */
export function getPillLabel(tasks: BackgroundTaskState[]): string {
// getPillLabel：依据任务集合类型生成紧凑页脚标签
  const n = tasks.length
// n = 任务数；allSameType 判断是否为同一类型
  const allSameType = tasks.every(t => t.type === tasks[0]!.type)

  if (allSameType) {
// 同类型时按具体类型分别措辞
    switch (tasks[0]!.type) {
      case 'local_bash': {
// local_bash：区分监视器（monitor）与交互 shell
        const monitors = count(
          tasks,
          t => t.type === 'local_bash' && t.kind === 'monitor',
        )
        const shells = n - monitors
        const parts: string[] = []
        if (shells > 0)
          parts.push(shells === 1 ? '1 shell' : `${shells} shells`)
        if (monitors > 0)
          parts.push(monitors === 1 ? '1 monitor' : `${monitors} monitors`)
        return parts.join(', ')
      }
      case 'in_process_teammate': {
// in_process_teammate：按队伍去重计数
        const teamCount = new Set(
          tasks.map(t =>
            t.type === 'in_process_teammate' ? t.identity.teamName : '',
          ),
        ).size
        return teamCount === 1 ? '1 team' : `${teamCount} teams`
      }
      case 'local_agent':
// local_agent：本地智能体计数
        return n === 1 ? '1 local agent' : `${n} local agents`
      case 'remote_agent': {
// remote_agent：云端会话，按 ultraplan 阶段显示不同菱形
        const first = tasks[0]!
        // Per design mockup: ◇ open diamond while running/needs-input,
        // ◆ filled once ExitPlanMode is awaiting approval.
        if (n === 1 && first.type === 'remote_agent' && first.isUltraplan) {
// 单个 ultraplan 且处于就绪 / 待输入时给出对应文案
          switch (first.ultraplanPhase) {
            case 'plan_ready':
              return `${DIAMOND_FILLED} ultraplan ready`
            case 'needs_input':
              return `${DIAMOND_OPEN} ultraplan needs your input`
            default:
              return `${DIAMOND_OPEN} ultraplan`
          }
        }
        return n === 1
// 普通云端会话用空心菱形 + 数量
          ? `${DIAMOND_OPEN} 1 cloud session`
          : `${DIAMOND_OPEN} ${n} cloud sessions`
      }
      case 'local_workflow':
// local_workflow / monitor_mcp / dream 等类型文案
        return n === 1 ? '1 background workflow' : `${n} background workflows`
      case 'monitor_mcp':
        return n === 1 ? '1 monitor' : `${n} monitors`
      case 'dream':
        return 'dreaming'
    }
  }

  return `${n} background ${n === 1 ? 'task' : 'tasks'}`
// 类型混杂时退回通用「N 个后台任务」
}

/**
 * True when the pill should show the dimmed " · ↓ to view" call-to-action.
 * Per the state diagram: only the two attention states (needs_input,
 * plan_ready) surface the CTA; plain running shows just the diamond + label.
 */
export function pillNeedsCta(tasks: BackgroundTaskState[]): boolean {
// pillNeedsCta：仅在单条 ultraplan 且处于待输入 / 就绪时显示「↓ 查看」提示
  if (tasks.length !== 1) return false
  const t = tasks[0]!
  return (
    t.type === 'remote_agent' &&
    t.isUltraplan === true &&
    t.ultraplanPhase !== undefined
  )
}
