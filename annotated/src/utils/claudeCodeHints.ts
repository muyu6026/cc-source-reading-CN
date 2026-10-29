/**
 * Claude Code hints protocol.
 *
 * CLIs and SDKs running under Claude Code can emit a self-closing
 * `<claude-code-hint />` tag to stderr (merged into stdout by the shell
 * tools). The harness scans tool output for these tags, strips them before
 * the output reaches the model, and surfaces an install prompt to the
 * user — no inference, no proactive execution.
 *
 * This file provides both the parser and a small module-level store for
 * the pending hint. The store is a single slot (not a queue) — we surface
 * at most one prompt per session, so there's no reason to accumulate.
 * React subscribes via useSyncExternalStore.
 *
 * See docs/claude-code-hints.md for the vendor-facing spec.
 */
// 文件总述：Claude Code hints 协议。运行在 Claude Code 下的 CLI 与 SDK 可通过向 stderr 输出自闭合的 <claude-code-hint /> 标签（被 shell 工具并到 stdout）来提示安装某插件；本端扫描工具输出、在送达模型前剥离这些标签，并向用户弹出安装提示——不推断、不主动执行。文件同时提供解析器与一个单槽的待处理提示存储（React 经 useSyncExternalStore 订阅）。

import { logForDebugging } from './debug.js'
import { createSignal } from './signal.js'

export type ClaudeCodeHintType = 'plugin'
// ClaudeCodeHintType：当前仅定义 plugin 一种提示类型。

export type ClaudeCodeHint = {
  /** Spec version declared by the emitter. Unknown versions are dropped. */
  v: number
  /** Hint discriminator. v1 defines only `plugin`. */
  type: ClaudeCodeHintType
  /**
   * Hint payload. For `type: 'plugin'`: a `name@marketplace` slug
   * matching the form accepted by `parsePluginIdentifier`.
   */
  value: string
  /**
   * First token of the shell command that produced this hint. Shown in the
   * install prompt so the user can spot a mismatch between the tool that
   * emitted the hint and the plugin it recommends.
   */
  sourceCommand: string
}
// ClaudeCodeHint 结构：spec 版本、类型鉴别符、负载值（plugin 时为 name@marketplace 形式）、来源命令首 token。

/** Spec versions this harness understands. */
const SUPPORTED_VERSIONS = new Set([1])
// SUPPORTED_VERSIONS：本端认识的 spec 版本（仅 1）。

/** Hint types this harness understands at the supported versions. */
const SUPPORTED_TYPES = new Set<string>(['plugin'])
// SUPPORTED_TYPES：本端支持的类型集合。

/**
 * Outer tag match. Anchored to whole lines (multiline mode) so that a
 * hint marker buried in a larger line — e.g. a log statement quoting the
 * tag — is ignored. Leading and trailing whitespace on the line is
 * tolerated since some SDKs pad stderr.
 */
const HINT_TAG_RE = /^[ \t]*<claude-code-hint\s+([^>]*?)\s*\/>[ \t]*$/gm
// HINT_TAG_RE：整行锚定的自闭合标签匹配（多行模式），容忍行首尾空白，避免把日志里引用该标签的句子误当成提示。

/**
 * Attribute matcher. Accepts `key="value"` and `key=value` (terminated by
 * whitespace or `/>` closing sequence). Values containing whitespace or `"` must use the quoted
 * form. The quoted form does not support escape sequences; raise the spec
 * version if that becomes necessary.
 */
const ATTR_RE = /(\w+)=(?:"([^"]*)"|([^\s/>]+))/g
// ATTR_RE：属性解析，支持 key=「value」与 key=value 两种，值含空白或引号须用带引号形式；引号形式不支持转义序列。

/**
 * Scan shell tool output for hint tags, returning the parsed hints and
 * the output with hint lines removed. The stripped output is what the
 * model sees — hints are a harness-only side channel.
 *
 * @param output - Raw command output (stdout with stderr interleaved).
 * @param command - The command that produced the output; its first
 *   whitespace-separated token is recorded as `sourceCommand`.
 */
export function extractClaudeCodeHints(
  output: string,
  command: string,
): { hints: ClaudeCodeHint[]; stripped: string } {
  // Fast path: no tag open sequence → no work, no allocation.
  if (!output.includes('<claude-code-hint')) {
    return { hints: [], stripped: output }
  }

  const sourceCommand = firstCommandToken(command)
  const hints: ClaudeCodeHint[] = []

  const stripped = output.replace(HINT_TAG_RE, rawLine => {
    const attrs = parseAttrs(rawLine)
    const v = Number(attrs.v)
    const type = attrs.type
    const value = attrs.value

    if (!SUPPORTED_VERSIONS.has(v)) {
      logForDebugging(
        `[claudeCodeHints] dropped hint with unsupported v=${attrs.v}`,
      )
      return ''
    }
    if (!type || !SUPPORTED_TYPES.has(type)) {
      logForDebugging(
        `[claudeCodeHints] dropped hint with unsupported type=${type}`,
      )
      return ''
    }
    if (!value) {
      logForDebugging('[claudeCodeHints] dropped hint with empty value')
      return ''
    }

    hints.push({ v, type: type as ClaudeCodeHintType, value, sourceCommand })
    return ''
  })

  // Dropping a matched line leaves a blank line (the surrounding newlines
  // remain). Collapse runs of blank lines introduced by the replace so the
  // model-visible output doesn't grow vertical whitespace.
  const collapsed =
    hints.length > 0 || stripped !== output
      ? stripped.replace(/\n{3,}/g, '\n\n')
      : stripped

  return { hints, stripped: collapsed }
}
// extractClaudeCodeHints：扫描输出、剥离提示标签、返回解析结果；模型只看到剥离后的文本，提示是仅本端使用的旁路通道。

function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tagBody.matchAll(ATTR_RE)) {
    attrs[m[1]!] = m[2] ?? m[3] ?? ''
  }
  return attrs
}
// parseAttrs：把标签体的属性组装成字典。

function firstCommandToken(command: string): string {
  const trimmed = command.trim()
  const spaceIdx = trimmed.search(/\s/)
  return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
}
// firstCommandToken：取命令首个空白前 token 作为来源命令，便于用户核对提示与推荐插件是否一致。

// ============================================================================
// Pending-hint store (useSyncExternalStore interface)
//
// Single-slot: write wins if the slot is already full (a CLI that emits on
// every invocation would otherwise pile up). The dialog is shown at most
// once per session; after that, setPendingHint becomes a no-op.
//
// Callers should gate before writing (installed? already shown? cap hit?) —
// see maybeRecordPluginHint in hintRecommendation.ts for the plugin-type
// gate. This module stays plugin-agnostic so future hint types can reuse
// the same store.
// ============================================================================

let pendingHint: ClaudeCodeHint | null = null
let shownThisSession = false
const pendingHintChanged = createSignal()
const notify = pendingHintChanged.emit

/** Raw store write. Callers should gate first (see module comment). */
export function setPendingHint(hint: ClaudeCodeHint): void {
  if (shownThisSession) return
  pendingHint = hint
  notify()
}
// setPendingHint：单槽写入，本会话已展示过则变 no-op（防止每次调用都堆积）。

/** Clear the slot without flipping the session flag — for rejected hints. */
export function clearPendingHint(): void {
  if (pendingHint !== null) {
    pendingHint = null
    notify()
  }
}

/** Flip the once-per-session flag. Call only when a dialog is actually shown. */
export function markShownThisSession(): void {
  shownThisSession = true
}

// markShownThisSession：翻转每会话一次的展示标志，仅在对话框真正弹出时调用。
export const subscribeToPendingHint = pendingHintChanged.subscribe

export function getPendingHintSnapshot(): ClaudeCodeHint | null {
  return pendingHint
}

export function hasShownHintThisSession(): boolean {
  return shownThisSession
}

/** Test-only reset. */
export function _resetClaudeCodeHintStore(): void {
  pendingHint = null
  shownThisSession = false
}

export const _test = {
  parseAttrs,
  firstCommandToken,
}
// _test：导出内部函数供单元测试使用。
