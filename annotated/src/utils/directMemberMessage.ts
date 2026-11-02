// 团队成员直发消息工具：解析「@成员名 内容」语法，并绕过模型直接把消息写进目标成员的信箱。
import type { AppState } from '../state/AppState.js'

/**
 * Parse `@agent-name message` syntax for direct team member messaging.
 */
// 模块文档：parseDirectMemberMessage 解析 @agent-name message 这种直发语法。
// 解析函数：用正则抽取收件人名称与消息正文，任何一步不匹配即返回 null。
export function parseDirectMemberMessage(input: string): {
  recipientName: string
  message: string
} | null {
  const match = input.match(/^@([\w-]+)\s+(.+)$/s)
  if (!match) return null

  const [, recipientName, message] = match
  if (!recipientName || !message) return null

  const trimmedMessage = message.trim()
  if (!trimmedMessage) return null

  return { recipientName, message: trimmedMessage }
}
// 解析函数收尾：返回 {recipientName, message}，正文已 trim；缺收件人或空消息都会提前返回 null。

// 直发结果类型：成功带收件人名，失败带具体错误（无团队上下文 / 找不到收件人）。
export type DirectMessageResult =
  | { success: true; recipientName: string }
  | {
      success: false
      error: 'no_team_context' | 'unknown_recipient'
      recipientName?: string
    }

// 写信箱函数类型：把 {from, text, timestamp} 投递给某成员，属于调用方注入的副作用。
type WriteToMailboxFn = (
  recipientName: string,
  message: { from: string; text: string; timestamp: string },
  teamName: string,
) => Promise<void>

/**
 * Send a direct message to a team member, bypassing the model.
 */
// 发送函数：绕过模型，直接把一条消息写进团队成员信箱；无团队上下文或未提供写信箱能力时报错。
export async function sendDirectMemberMessage(
  recipientName: string,
  message: string,
  teamContext: AppState['teamContext'],
  writeToMailbox?: WriteToMailboxFn,
): Promise<DirectMessageResult> {
  if (!teamContext || !writeToMailbox) {
    return { success: false, error: 'no_team_context' }
  }

  // Find team member by name
  const member = Object.values(teamContext.teammates ?? {}).find(
    t => t.name === recipientName,
  )

  if (!member) {
    return { success: false, error: 'unknown_recipient', recipientName }
  }

  await writeToMailbox(
    recipientName,
    {
      from: 'user',
      text: message,
      timestamp: new Date().toISOString(),
    },
    teamContext.teamName,
  )

  return { success: true, recipientName }
}
// 发送函数收尾：找到成员后写入信箱并返回成功；找不到成员返回 unknown_recipient，全程不触碰模型。
