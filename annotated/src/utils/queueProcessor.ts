import type { QueuedCommand } from '../types/textInputTypes.js'
// 队列消费器：决定现在能不能从队列里取一条命令去执行，以及一次取几条。
import {
  dequeue,
  dequeueAllMatching,
  hasCommandsInQueue,
  peek,
} from './messageQueueManager.js'

type ProcessQueueParams = {
  executeInput: (commands: QueuedCommand[]) => Promise<void>
}

type ProcessQueueResult = {
  processed: boolean
}
// 返回值只带 processed 一个布尔：调用方靠它决定是否立刻再调一次，因为队列可能还没排空。

/**
 * Check if a queued command is a slash command (value starts with '/').
 */
function isSlashCommand(cmd: QueuedCommand): boolean {
  if (typeof cmd.value === 'string') {
    return cmd.value.trim().startsWith('/')
  }
  // For ContentBlockParam[], check the first text block
  for (const block of cmd.value) {
    if (block.type === 'text') {
      return block.text.trim().startsWith('/')
    }
  }
  return false
}
// isSlashCommand 同时兼容字符串与内容块两种 value：斜杠命令在两种表示下都要能识别，否则会被当成普通提示词批量吞掉。

/**
 * Processes commands from the queue.
 *
 * Slash commands (starting with '/') and bash-mode commands are processed
 * one at a time so each goes through the executeInput path individually.
 * Bash commands need individual processing to preserve per-command error
 * isolation, exit codes, and progress UI. Other non-slash commands are
 * batched: all items **with the same mode** as the highest-priority item
 * are drained at once and passed as a single array to executeInput — each
 * becomes its own user message with its own UUID. Different modes
 * (e.g. prompt vs task-notification) are never mixed because they are
 * treated differently downstream.
 *
 * The caller is responsible for ensuring no query is currently running
 * and for calling this function again after each command completes
 * until the queue is empty.
 *
 * @returns result with processed status
 */
export function processQueueIfReady({
  executeInput,
}: ProcessQueueParams): ProcessQueueResult {
  // This processor runs on the REPL main thread between turns. Skip anything
  // addressed to a subagent — an unfiltered peek() returning a subagent
  // notification would set targetMode, dequeueAllMatching would find nothing
  // matching that mode with agentId===undefined, and we'd return processed:
  // false with the queue unchanged → the React effect never re-fires and any
  // queued user prompt stalls permanently.
  const isMainThread = (cmd: QueuedCommand) => cmd.agentId === undefined
// isMainThread 过滤掉发给子代理的通知：主线程处理器一旦 peek 到子代理消息，就会设错 targetMode、批量取出 0 条、返回 processed 为 false，导致 React effect 再也不重跑，用户的排队提示词永久卡住。

  const next = peek(isMainThread)
  if (!next) {
    return { processed: false }
  }
// 队列为空则直接返回 false：不要在这里等待或自旋，唤醒责任在调用方的 effect。

  // Slash commands and bash-mode commands are processed individually.
  // Bash commands need per-command error isolation, exit codes, and progress UI.
  if (isSlashCommand(next) || next.mode === 'bash') {
    const cmd = dequeue(isMainThread)!
    void executeInput([cmd])
    return { processed: true }
  }
// 斜杠命令与 bash 模式逐条处理：后者需要独立的错误隔离、退出码和进度 UI，不能和别的命令合并成一批。

  // Drain all non-slash-command items with the same mode at once.
  const targetMode = next.mode
  const commands = dequeueAllMatching(
    cmd => isMainThread(cmd) && !isSlashCommand(cmd) && cmd.mode === targetMode,
  )
  if (commands.length === 0) {
    return { processed: false }
  }

  void executeInput(commands)
  return { processed: true }
}
// 其余命令按「与队首同 mode」批量取走：不同 mode 的下游处理方式不同，混批会串语义；每条仍各自成为一条用户消息、各自带 UUID。

/**
 * Checks if the queue has pending commands.
 * Use this to determine if queue processing should be triggered.
 */
export function hasQueuedCommands(): boolean {
  return hasCommandsInQueue()
}
// hasQueuedCommands 只是转调：判断队列是否非空，用于决定要不要触发处理。
