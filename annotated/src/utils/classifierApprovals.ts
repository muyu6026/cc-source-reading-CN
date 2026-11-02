/**
 * Tracks which tool uses were auto-approved by classifiers.
 * Populated from useCanUseTool.ts and permissions.ts, read from UserToolSuccessMessage.tsx.
 */
// 分类器自动放行的记账本：谁被 bash 分类器放行、谁被 auto 模式放行、谁正在被检查，供 UI 在工具结果旁标注「为什么没弹确认框」。

import { feature } from 'bun:bundle'
import { createSignal } from './signal.js'

type ClassifierApproval = {
  classifier: 'bash' | 'auto-mode'
  matchedRule?: string
  reason?: string
}

const CLASSIFIER_APPROVALS = new Map<string, ClassifierApproval>()
const CLASSIFIER_CHECKING = new Set<string>()
const classifierChecking = createSignal()
// 一个信号加两个容器：approvals 存结果（toolUseID 到放行理由），checking 存进行中集合，信号只负责通知 UI 重渲。

export function setClassifierApproval(
  toolUseID: string,
  matchedRule: string,
): void {
  if (!feature('BASH_CLASSIFIER')) {
    return
  }
  CLASSIFIER_APPROVALS.set(toolUseID, {
    classifier: 'bash',
    matchedRule,
  })
}
// 写入前先看 feature 开关：未开启的构建里这个函数是纯 no-op，调用点因此不必各自判开关。

export function getClassifierApproval(toolUseID: string): string | undefined {
  if (!feature('BASH_CLASSIFIER')) {
    return undefined
  }
  const approval = CLASSIFIER_APPROVALS.get(toolUseID)
  if (!approval || approval.classifier !== 'bash') return undefined
  return approval.matchedRule
}
// 读取时再校一次 classifier 类型：同一个 toolUseID 可能先被 bash 写入、后被 auto 写入，读的一方要确认拿到的是自己要的那类理由。

export function setYoloClassifierApproval(
  toolUseID: string,
  reason: string,
): void {
  if (!feature('TRANSCRIPT_CLASSIFIER')) {
    return
  }
  CLASSIFIER_APPROVALS.set(toolUseID, { classifier: 'auto-mode', reason })
}
// auto 模式放行只存 reason 不存 matchedRule：它没有规则可匹配，判定来自整段对话的分类结果。

export function getYoloClassifierApproval(
  toolUseID: string,
): string | undefined {
  if (!feature('TRANSCRIPT_CLASSIFIER')) {
    return undefined
  }
  const approval = CLASSIFIER_APPROVALS.get(toolUseID)
  if (!approval || approval.classifier !== 'auto-mode') return undefined
  return approval.reason
}
// 两个读取函数的结构完全对称：各自校自己的 classifier 类型，互不串味。

export function setClassifierChecking(toolUseID: string): void {
  if (!feature('BASH_CLASSIFIER') && !feature('TRANSCRIPT_CLASSIFIER')) return
  CLASSIFIER_CHECKING.add(toolUseID)
  classifierChecking.emit()
}

export function clearClassifierChecking(toolUseID: string): void {
  if (!feature('BASH_CLASSIFIER') && !feature('TRANSCRIPT_CLASSIFIER')) return
  CLASSIFIER_CHECKING.delete(toolUseID)
  classifierChecking.emit()
}
// 检查状态用 Set 而不是 Map：只关心「在不在检查中」，不需要附带数据；增删后 emit 一次触发 UI 更新。

export const subscribeClassifierChecking = classifierChecking.subscribe

export function isClassifierChecking(toolUseID: string): boolean {
  return CLASSIFIER_CHECKING.has(toolUseID)
}

export function deleteClassifierApproval(toolUseID: string): void {
  CLASSIFIER_APPROVALS.delete(toolUseID)
}
// 删除按单个 toolUseID 做：一条工具结果渲染完就该清掉，避免这张表随会话无限增长。

export function clearClassifierApprovals(): void {
  CLASSIFIER_APPROVALS.clear()
  CLASSIFIER_CHECKING.clear()
  classifierChecking.emit()
}
// 清空要同时清两个容器并 emit：只清 approvals 会让 UI 里残留「检查中」的转圈状态。
