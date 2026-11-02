// 渲染层的一条折叠规则：把标签相同的连续钩子汇总消息合并成一条。触发场景是并行工具调用，每个调用各自发一条汇总，界面上就会连出好几行重复内容。文件只做纯数组变换，不涉及渲染。
import type {
  RenderableMessage,
  SystemStopHookSummaryMessage,
} from '../types/message.js'

function isLabeledHookSummary(
  msg: RenderableMessage,
): msg is SystemStopHookSummaryMessage {
  return (
    msg.type === 'system' &&
    msg.subtype === 'stop_hook_summary' &&
    msg.hookLabel !== undefined
  )
}
// 类型守卫同时卡三个条件：消息类型是系统消息、子类型是停止钩子汇总、并且带了标签。第三个条件最关键——没有标签就没法判断哪些该合并，所以直接不算可折叠项。

/**
 * Collapses consecutive hook summary messages with the same hookLabel
 * (e.g. PostToolUse) into a single summary. This happens when parallel
 * tool calls each emit their own hook summary.
 */
export function collapseHookSummaries(
  messages: RenderableMessage[],
): RenderableMessage[] {
  const result: RenderableMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]!
    if (isLabeledHookSummary(msg)) {
      const label = msg.hookLabel
      const group: SystemStopHookSummaryMessage[] = []
      while (i < messages.length) {
        const next = messages[i]!
        if (!isLabeledHookSummary(next) || next.hookLabel !== label) break
        group.push(next)
        i++
      }
// 内层循环只收集「标签完全一致」的连续项，遇到不同标签或非汇总消息立刻中断。注意它先记录起点消息再推进下标，因此单个不合并的情形也能原样放回。
      if (group.length === 1) {
        result.push(msg)
      } else {
        result.push({
          ...msg,
          hookCount: group.reduce((sum, m) => sum + m.hookCount, 0),
          hookInfos: group.flatMap(m => m.hookInfos),
          hookErrors: group.flatMap(m => m.hookErrors),
          preventedContinuation: group.some(m => m.preventedContinuation),
          hasOutput: group.some(m => m.hasOutput),
          // Parallel tool calls' hooks overlap; max is closest to wall-clock.
          totalDurationMs: Math.max(...group.map(m => m.totalDurationMs ?? 0)),
        })
      }
// 合并时各字段的口径不同，值得逐个看：计数与信息列表是求和与摊平；两个布尔标记用「任一为真」而不是直接取首条；时长取最大值而不是求和——注释给出的理由是并行调用的钩子时间区间重叠，求和会把实际耗时虚增数倍，取最大才接近墙钟时间。
    } else {
      result.push(msg)
      i++
    }
  }

  return result
}
// 整体是单趟扫描加内层贪婪收集，时间复杂度与消息条数线性相关。非汇总消息一律原样放入结果并只推进一格，保证不改变它们在界面上的相对位置与顺序。
