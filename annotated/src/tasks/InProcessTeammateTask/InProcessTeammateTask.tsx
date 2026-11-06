/**
 * InProcessTeammateTask - Manages in-process teammate lifecycle
 *
 * This component implements the Task interface for in-process teammates.
 * Unlike LocalAgentTask (background agents), in-process teammates:
 * 1. Run in the same Node.js process using AsyncLocalStorage for isolation
 * 2. Have team-aware identity (agentName@teamName)
 * 3. Support plan mode approval flow
 * 4. Can be idle (waiting for work) or active (processing)
 */

import { isTerminalTaskStatus, type SetAppState, type Task, type TaskStateBase } from '../../Task.js';
import type { Message } from '../../types/message.js';
import { logForDebugging } from '../../utils/debug.js';
import { createUserMessage } from '../../utils/messages.js';
import { killInProcessTeammate } from '../../utils/swarm/spawnInProcess.js';
import { updateTaskState } from '../../utils/task/framework.js';
import type { InProcessTeammateTaskState } from './types.js';
import { appendCappedMessage, isInProcessTeammateTask } from './types.js';

/**
 * InProcessTeammateTask - Handles in-process teammate execution.
 */
// 任务接口只剩中止：派生、渲染、注册都在别处，这里只回答「怎么杀掉」
export const InProcessTeammateTask: Task = {
  name: 'InProcessTeammateTask',
  type: 'in_process_teammate',
// 中止直接转交给进程内的实现：本文件负责生命周期编排，不负责真正的中断
  async kill(taskId, setAppState) {
    killInProcessTeammate(taskId, setAppState);
  }
};

/**
 * Request shutdown for a teammate.
 */
// 请求关停是「打个标记」而不是立刻杀：让队友在下一个检查点自己收尾，半成品才有机会写回
export function requestTeammateShutdown(taskId: string, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
// 已终态或已请求过就返回原对象：重复请求不该产生第二次状态更新
    if (task.status !== 'running' || task.shutdownRequested) {
      return task;
    }
    return {
      ...task,
      shutdownRequested: true
    };
  });
}

/**
 * Append a message to a teammate's conversation history.
 * Used for zoomed view to show the teammate's conversation.
 */
// 追加消息只对运行中的任务生效：终态任务的消息没人再读，写进去只是占内存
export function appendTeammateMessage(taskId: string, message: Message, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    return {
      ...task,
// 消息列表有上限：长会话的转录会无限增长，截断策略在类型文件里统一
      messages: appendCappedMessage(task.messages, message)
    };
  });
}

/**
 * Inject a user message to a teammate's pending queue.
 * Used when viewing a teammate's transcript to send typed messages to them.
 * Also adds the message to task.messages so it appears immediately in the transcript.
 */
// 注入与追加的差别是「还要进待处理队列」：转录里要马上看到，但真正送达要等队友下次取
export function injectUserMessageToTeammate(taskId: string, message: string, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
    // Allow message injection when teammate is running or idle (waiting for input)
    // Only reject if teammate is in a terminal state
// 只有终态才拒绝注入：空闲也算可接收，这正是「等待工作」这个状态的意义
    if (isTerminalTaskStatus(task.status)) {
// 丢弃时留一条调试日志：静默丢弃最难查，必须留下痕迹
      logForDebugging(`Dropping message for teammate task ${taskId}: task status is "${task.status}"`);
      return task;
    }
    return {
      ...task,
      pendingUserMessages: [...task.pendingUserMessages, message],
      messages: appendCappedMessage(task.messages, createUserMessage({
        content: message
      }))
    };
  });
}

/**
 * Get teammate task by agent ID from AppState.
 * Prefers running tasks over killed/completed ones in case multiple tasks
 * with the same agentId exist.
 * Returns undefined if not found.
 */
// 同一代理可能有多条任务：旧的中止任务与新任务并存是常态，所以不能拿第一条就走
export function findTeammateTaskByAgentId(agentId: string, tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState | undefined {
  let fallback: InProcessTeammateTaskState | undefined;
  for (const task of Object.values(tasks)) {
// 按身份里的代理 id 匹配：任务 id 与代理 id 是两套编号
    if (isInProcessTeammateTask(task) && task.identity.agentId === agentId) {
      // Prefer running tasks in case old killed tasks still exist in AppState
      // alongside new running ones with the same agentId
// 找到运行中的立刻返回：优先级的实现就这一句
      if (task.status === 'running') {
        return task;
      }
      // Keep first match as fallback in case no running task exists
// 第一条非运行中的留作兜底：没有在跑的时，历史记录至少还能打开
      if (!fallback) {
        fallback = task;
      }
    }
  }
  return fallback;
}

/**
 * Get all in-process teammate tasks from AppState.
 */
// 过滤而不是遍历建数组：类型守卫本身就能当筛选条件用
export function getAllInProcessTeammateTasks(tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState[] {
  return Object.values(tasks).filter(isInProcessTeammateTask);
}

/**
 * Get running in-process teammates sorted alphabetically by agentName.
 * Shared between TeammateSpinnerTree display, PromptInput footer selector,
 * and useBackgroundTaskNavigation — selectedIPAgentIndex maps into this
 * array, so all three must agree on sort order.
 */
// 排序规则必须与另外两处一致：选中索引映射进这个数组，顺序不同就会点错人
export function getRunningTeammatesSorted(tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState[] {
// 按名字做本地化比较：不同语言的排序习惯不同，按码点比会出现「明明按字母排却不对」
  return getAllInProcessTeammateTasks(tasks).filter(t => t.status === 'running').sort((a, b) => a.identity.agentName.localeCompare(b.identity.agentName));
}
// 原文件此处有一行 11644 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。