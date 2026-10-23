import { useMemo, useRef } from 'react'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import type { Message } from '../types/message.js'
import { getUserMessageText } from '../utils/messages.js'

const EXTERNAL_COMMAND_PATTERNS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bkubectl\b/,
  /\bsrun\b/,
  /\bdocker\b/,
  /\bbq\b/,
  /\bgsutil\b/,
  /\bgcloud\b/,
  /\baws\b/,
  /\bgit\s+push\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+fetch\b/,
  /\bgh\s+(pr|issue)\b/,
  /\bnc\b/,
  /\bncat\b/,
  /\btelnet\b/,
  /\bftp\b/,
]

const FRICTION_PATTERNS = [
  // "No," or "No!" at start — comma/exclamation implies correction tone
  // (avoids "No problem", "No thanks", "No I think we should...")
  /^no[,!]\s/i,
  // Direct corrections about Claude's output
  /\bthat'?s (wrong|incorrect|not (what|right|correct))\b/i,
  /\bnot what I (asked|wanted|meant|said)\b/i,
  // Referencing prior instructions Claude missed
  /\bI (said|asked|wanted|told you|already said)\b/i,
  // Questioning Claude's actions
  /\bwhy did you\b/i,
  /\byou should(n'?t| not)? have\b/i,
  /\byou were supposed to\b/i,
  // Explicit retry/revert of Claude's work
  /\btry again\b/i,
  /\b(undo|revert) (that|this|it|what you)\b/i,
]

export function isSessionContainerCompatible(messages: Message[]): boolean {
// 容器兼容检查：遍历 assistant 消息的工具调用，判断本会话
// 能否塞进 issue 反馈容器（不含 mcp__ 工具、不含危险外部命令）。
  for (const msg of messages) {
    if (msg.type !== 'assistant') {
      continue
    }
    const content = msg.message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      if (block.type !== 'tool_use' || !('name' in block)) {
        continue
      }
      const toolName = block.name as string
      if (toolName.startsWith('mcp__')) {
        return false
      }
// 任何 mcp__ 前缀工具一律判为不兼容——外部 MCP 工具行为不可控。
      if (toolName === BASH_TOOL_NAME) {
        const input = (block as { input?: Record<string, unknown> }).input
        const command = (input?.command as string) || ''
        if (EXTERNAL_COMMAND_PATTERNS.some(p => p.test(command))) {
          return false
        }
      }
// bash 命令若匹配外部命令黑名单（curl/ssh/docker/aws/git push 等）
// 即判不兼容，避免把高危操作会话送进 issue 容器。
    }
  }
  return true
}

export function hasFrictionSignal(messages: Message[]): boolean {
// 摩擦信号：从末尾向前找最近的 user 消息，用正则判断用户是否在纠正 Claude。
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type !== 'user') {
      continue
    }
    const text = getUserMessageText(msg)
    if (!text) {
      continue
    }
    return FRICTION_PATTERNS.some(p => p.test(text))
  }
  return false
}

const MIN_SUBMIT_COUNT = 3
// 阈值常量：至少提交 3 次才允许弹 banner，且两次触发间隔不少于 30 分钟。
const COOLDOWN_MS = 30 * 60 * 1000

export function useIssueFlagBanner(
// banner 主 hook：返回是否应显示「反馈问题」提示条。
  messages: Message[],
  submitCount: number,
): boolean {
  if (process.env.USER_TYPE !== 'ant') {
// 仅 ant 内部环境显示该 banner（编译期常量门控，非 ant 直接 false）。
    return false
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: process.env.USER_TYPE is a compile-time constant
  const lastTriggeredAtRef = useRef(0)
  // biome-ignore lint/correctness/useHookAtTopLevel: process.env.USER_TYPE is a compile-time constant
  const activeForSubmitRef = useRef(-1)

  // Memoize the O(messages) scans. This hook runs on every REPL render
  // (including every keystroke), but messages is stable during typing.
  // isSessionContainerCompatible walks all messages + regex-tests each
  // bash command — by far the heaviest work here.
  // biome-ignore lint/correctness/useHookAtTopLevel: process.env.USER_TYPE is a compile-time constant
  const shouldTrigger = useMemo(
// useMemo 缓存 O(messages) 扫描——本 hook 每次 REPL 渲染（含每次按键）都跑，
// 但打字时 messages 稳定，缓存避免对每条 bash 命令重复正则扫描。
    () => isSessionContainerCompatible(messages) && hasFrictionSignal(messages),
    [messages],
  )

  // Keep showing the banner until the user submits another message
  if (activeForSubmitRef.current === submitCount) {
    return true
  }

  if (Date.now() - lastTriggeredAtRef.current < COOLDOWN_MS) {
    return false
  }
  if (submitCount < MIN_SUBMIT_COUNT) {
    return false
  }
  if (!shouldTrigger) {
    return false
  }

  lastTriggeredAtRef.current = Date.now()
// 触发后记录时间戳并锁定到「当前提交数」，使 banner 在下一次提交前持续显示。
  activeForSubmitRef.current = submitCount
  return true
}
