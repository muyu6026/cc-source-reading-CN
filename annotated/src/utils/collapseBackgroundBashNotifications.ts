import {
// 把连续的后台 bash 完成通知折叠成一条：全屏模式下连跑十几条命令，逐条刷屏毫无信息量，合成「N 条后台命令已完成」更可读。
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import { BACKGROUND_BASH_SUMMARY_PREFIX } from '../tasks/LocalShellTask/LocalShellTask.js'
import type {
  NormalizedUserMessage,
  RenderableMessage,
} from '../types/message.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { extractTag } from './messages.js'
// extractTag 负责取 XML 风格标签内容：任务通知是拼好的标签串，正则手撕不如统一取值函数。

function isCompletedBackgroundBash(
  msg: RenderableMessage,
): msg is NormalizedUserMessage {
  if (msg.type !== 'user') return false
  const content = msg.message.content[0]
  if (content?.type !== 'text') return false
  if (!content.text.includes(`<${TASK_NOTIFICATION_TAG}`)) return false
  // Only collapse successful completions — failed/killed stay visible individually.
  if (extractTag(content.text, STATUS_TAG) !== 'completed') return false
  // The prefix constant distinguishes bash-kind LocalShellTask completions from
  // agent/workflow/monitor notifications. Monitor-kind completions have their
  // own summary wording and deliberately don't collapse here.
  return (
    extractTag(content.text, SUMMARY_TAG)?.startsWith(
      BACKGROUND_BASH_SUMMARY_PREFIX,
    ) ?? false
  )
}
// 判定要同时满足四个条件：是 user 消息、首块是文本、含任务通知标签、状态为 completed，且摘要以 bash 前缀开头。任一不满足就原样保留。

/**
 * Collapses consecutive completed-background-bash task-notifications into a
 * single synthetic "N background commands completed" notification. Failed/killed
 * tasks and agent/workflow notifications are left alone. Monitor stream
 * events (enqueueStreamEvent) have no <status> tag and never match.
 *
 * Pass-through in verbose mode so ctrl+O shows each completion.
 */
export function collapseBackgroundBashNotifications(
  messages: RenderableMessage[],
  verbose: boolean,
): RenderableMessage[] {
  if (!isFullscreenEnvEnabled()) return messages
// 全屏模式之外一律不折叠：非全屏的滚动历史本来就是一条条读的，折叠反而打乱了用户已经熟悉的样子。
  if (verbose) return messages
// verbose 直通：用户主动要看每一条完成记录时，折叠就是遮挡信息。

  const result: RenderableMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]!
    if (isCompletedBackgroundBash(msg)) {
      let count = 0
      while (i < messages.length && isCompletedBackgroundBash(messages[i]!)) {
        count++
        i++
      }
// 内层 while 一次吞掉一整段连续完成：count 记下条数，i 已经推到第一个非匹配位置，外层不必回退。
      if (count === 1) {
        result.push(msg)
      } else {
        // Synthesize a task-notification that UserAgentNotificationMessage
        // already knows how to render — no new renderer needed.
        result.push({
          ...msg,
          message: {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `<${TASK_NOTIFICATION_TAG}><${STATUS_TAG}>completed</${STATUS_TAG}><${SUMMARY_TAG}>${count} background commands completed</${SUMMARY_TAG}></${TASK_NOTIFICATION_TAG}>`,
              },
            ],
          },
        })
      }
// 只有 1 条时原样保留：为一条通知造一条「1 条后台命令已完成」的摘要纯属噪音。合成消息直接复用原消息的其余字段，只换内容。
    } else {
      result.push(msg)
      i++
    }
  }

  return result
}
// 失败与被杀的任务、agent 与 workflow 的通知都不在此列：它们各自有独立措辞与后续动作，折叠会丢信息。监视流的流式事件没有状态标签，天然不匹配。
