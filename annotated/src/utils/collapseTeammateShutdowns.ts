// 与钩子汇总折叠同构的一条规则：把连续的队友关闭通知合并成一条带数量的批次通知。场景是一批进程内队友同时收到关闭指令，各自上报一条完成状态，界面上会连出多行。
import type { AttachmentMessage, RenderableMessage } from '../types/message.js'

function isTeammateShutdownAttachment(
  msg: RenderableMessage,
): msg is AttachmentMessage {
  return (
    msg.type === 'attachment' &&
    msg.attachment.type === 'task_status' &&
    msg.attachment.taskType === 'in_process_teammate' &&
    msg.attachment.status === 'completed'
  )
}
// 守卫卡四个条件：消息是附件、附件是任务状态、任务类型是进程内队友、状态是已完成。四者同时成立才算可折叠项——尤其最后两条，缺了就会把普通附件或仍在运行的队友误折叠。

/**
 * Collapses consecutive in-process teammate shutdown task_status attachments
 * into a single `teammate_shutdown_batch` attachment with a count.
 */
export function collapseTeammateShutdowns(
  messages: RenderableMessage[],
): RenderableMessage[] {
  const result: RenderableMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]!
    if (isTeammateShutdownAttachment(msg)) {
      let count = 0
      while (
        i < messages.length &&
        isTeammateShutdownAttachment(messages[i]!)
      ) {
        count++
        i++
      }
// 内层循环只累计数量、不保存元素，因为合并后的通知只需要一个计数。这意味着被折叠掉的那些消息里的其他字段（例如各自的错误信息）会丢失，属于有意的取舍：屏幕上的信息价值主要在「有几个队友关了」。
      if (count === 1) {
        result.push(msg)
      } else {
        result.push({
          type: 'attachment',
          uuid: msg.uuid,
          timestamp: msg.timestamp,
          attachment: {
            type: 'teammate_shutdown_batch',
            count,
          },
        })
      }
// 批次通知沿用首条消息的标识与时间戳，附件部分只保留类型与计数。用首条的时间而不是末条，是为了让这行通知出现在它原本的位置，而不是跳到整组的末尾。
    } else {
      result.push(msg)
      i++
    }
  }

  return result
}
// 整体与钩子汇总那份是同一个骨架：单趟扫描、内层贪婪收集同构项、单个时原样保留、多个时替换为汇总。两份没有抽公共函数，因为折叠后的消息形状完全不同，抽出来反而要传一堆构造与判定回调。
