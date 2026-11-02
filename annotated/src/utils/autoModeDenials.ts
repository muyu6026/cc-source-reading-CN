// 文件级批注：`autoModeDenials.ts` 维护自动模式分类器最近拒绝的命令清单，由 `useCanUseTool.ts` 写入、权限页的 `RecentDenialsTab` 读取。
/**
 * Tracks commands recently denied by the auto mode classifier.
 * Populated from useCanUseTool.ts, read from RecentDenialsTab.tsx in /permissions.
 */

import { feature } from 'bun:bundle'

// 类型签名：被拒记录含工具名、可读描述、原因与时间戳。
export type AutoModeDenial = {
  toolName: string
  /** Human-readable description of the denied command (e.g. bash command string) */
  display: string
  reason: string
  timestamp: number
}

let DENIALS: readonly AutoModeDenial[] = []
const MAX_DENIALS = 20

// 写入函数签名：先判特性开关，命中才把新记录压到列表头部并截断到上限。
export function recordAutoModeDenial(denial: AutoModeDenial): void {
  if (!feature('TRANSCRIPT_CLASSIFIER')) return
  DENIALS = [denial, ...DENIALS.slice(0, MAX_DENIALS - 1)]
}
// 写入收尾：用展开运算把新记录放最前，再切片保留最近 `MAX_DENIALS` 条。

// 读取函数签名：直接返回只读的最新拒绝列表。
export function getAutoModeDenials(): readonly AutoModeDenial[] {
  return DENIALS
}
// 读取收尾：返回 `DENIALS` 当前快照，调用方只读不写。
