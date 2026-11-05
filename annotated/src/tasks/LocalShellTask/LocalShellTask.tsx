// 构建期特性开关，用来把只在特定发布形态里存在的监控任务整段消除
import { feature } from 'bun:bundle';
import { stat } from 'fs/promises';
import { OUTPUT_FILE_TAG, STATUS_TAG, SUMMARY_TAG, TASK_ID_TAG, TASK_NOTIFICATION_TAG, TOOL_USE_ID_TAG } from '../../constants/xml.js';
import { abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import type { AppState } from '../../state/AppState.js';
import type { LocalShellSpawnInput, SetAppState, Task, TaskContext, TaskHandle } from '../../Task.js';
import { createTaskStateBase } from '../../Task.js';
import type { AgentId } from '../../types/ids.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { tailFile } from '../../utils/fsOperations.js';
import { logError } from '../../utils/log.js';
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import type { ShellCommand } from '../../utils/ShellCommand.js';
import { evictTaskOutput, getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { registerTask, updateTaskState } from '../../utils/task/framework.js';
import { escapeXml } from '../../utils/xml.js';
import { backgroundAgentTask, isLocalAgentTask } from '../LocalAgentTask/LocalAgentTask.js';
import { isMainSessionTask } from '../LocalMainSessionTask.js';
import { type BashTaskKind, isLocalShellTask, type LocalShellTaskState } from './guards.js';
import { killTask } from './killShellTasks.js';

/** Prefix that identifies a LocalShellTask summary to the UI collapse transform. */
// 后台命令摘要的固定前缀：界面靠它把这些通知折叠成一句汇总
export const BACKGROUND_BASH_SUMMARY_PREFIX = 'Background command ';
// 每五秒看一次输出文件大小
const STALL_CHECK_INTERVAL_MS = 5_000;
// 四十五秒不增长才怀疑卡住，这个阈值要高于常见的长命令静默期
const STALL_THRESHOLD_MS = 45_000;
// 只看末尾一千字节：判断是否在等输入只需要最后一行
const STALL_TAIL_BYTES = 1024;

// 这里的设计意图写得很清楚：只对看起来像交互提问的命令发通知，纯慢的命令保持安静
// Last-line patterns that suggest a command is blocked waiting for keyboard
// input. Used to gate the stall notification — we stay silent on commands that
// are merely slow (git log -S, long builds) and only notify when the tail
// looks like an interactive prompt the model can act on. See CC-1175.
// 四类模式：括号式是否、方括号式是否、定向提问、按键提示
const PROMPT_PATTERNS = [/\(y\/n\)/i,
// (Y/n), (y/N)
/\[y\/n\]/i,
// [Y/n], [y/N]
/\(yes\/no\)/i, /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\? *$/i,
// directed questions
/Press (any key|Enter)/i, /Continue\?/i, /Overwrite\?/i];
// 只看最后一行：命令行工具把提示写在末尾，先前的输出不参与判断
export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.trimEnd().split('\n').pop() ?? '';
  return PROMPT_PATTERNS.some(p => p.test(lastLine));
}

// Output-side analog of peekForStdinData (utils/process.ts): fire a one-shot
// notification if output stops growing and the tail looks like a prompt.
// 卡顿看门狗：输出侧与输入侧探测的对称实现，返回取消函数
function startStallWatchdog(taskId: string, description: string, kind: BashTaskKind | undefined, toolUseId?: string, agentId?: AgentId): () => void {
// 监控类任务不装看门狗：它本来就会长期没有输出，装了只会误报
  if (kind === 'monitor') return () => {};
  const outputPath = getTaskOutputPath(taskId);
  let lastSize = 0;
  let lastGrowth = Date.now();
  let cancelled = false;
// 定时器每五秒读一次文件大小，读取失败静默——文件可能还没建出来
  const timer = setInterval(() => {
    void stat(outputPath).then(s => {
// 变大就记下新大小与时间，继续等
      if (s.size > lastSize) {
        lastSize = s.size;
        lastGrowth = Date.now();
        return;
      }
// 没到阈值就什么都不做，这是最省的一次判断
      if (Date.now() - lastGrowth < STALL_THRESHOLD_MS) return;
// 超过阈值才去读尾部，避免每五秒都做一次磁盘读
      void tailFile(outputPath, STALL_TAIL_BYTES).then(({
        content
      }) => {
        if (cancelled) return;
// 尾部不像提示就当作只是慢，并且重置计时——下一次检查要再等满四十五秒，而不是立刻重读
        if (!looksLikePrompt(content)) {
          // Not a prompt — keep watching. Reset so the next check is
          // 45s out instead of re-reading the tail on every tick.
          lastGrowth = Date.now();
          return;
        }
// 先把取消标记置位再去做副作用：并发的另一拍回调看到标记就会退出，不会发第二条通知
        // Latch before the async-boundary-visible side effects so an
        // overlapping tick's callback sees cancelled=true and bails.
        cancelled = true;
        clearInterval(timer);
// 带上工具调用标识，让上层能把通知挂回具体的调用
        const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
        const summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" appears to be waiting for interactive input`;
// 这里刻意不加状态标签：上层把状态标签当作终止信号，未知值会被当成已完成，等于误报任务结束
        // No <status> tag — print.ts treats <status> as a terminal
        // signal and an unknown value falls through to 'completed',
        // falsely closing the task for SDK consumers. Statusless
        // notifications are skipped by the SDK emitter (progress ping).
        const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
Last output:
${content.trimEnd()}

The command is likely blocked on an interactive prompt. Kill this task and re-run with piped input (e.g., \`echo y | command\`) or a non-interactive flag if one exists.`;
// 以次高优先级入队：用户还在等命令的输出，这条提示要尽快送到
        enqueuePendingNotification({
          value: message,
          mode: 'task-notification',
          priority: 'next',
          agentId
        });
      }, () => {});
    }, () => {} // File may not exist yet
    );
  }, STALL_CHECK_INTERVAL_MS);
// 定时器不阻止进程退出：桥接关闭时不该被一个看门狗拖着
  timer.unref();
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
// 完成通知：所有路径（自然结束、失败、被杀）都汇到这里
function enqueueShellNotification(taskId: string, description: string, status: 'completed' | 'failed' | 'killed', exitCode: number | undefined, setAppState: SetAppState, toolUseId?: string, kind: BashTaskKind = 'bash', agentId?: AgentId): void {
// 在同一次状态更新里检查并置位通知标记：两个完成路径并发时只有一个能通过
  // Atomically check and set notified flag to prevent duplicate notifications.
  // If the task was already marked as notified (e.g., by TaskStopTool), skip
  // enqueueing to avoid sending redundant messages to the model.
  let shouldEnqueue = false;
  updateTaskState(taskId, setAppState, task => {
    if (task.notified) {
      return task;
    }
    shouldEnqueue = true;
    return {
      ...task,
      notified: true
    };
  });
// 已经通知过就直接返回，避免重复消息污染模型的上下文
  if (!shouldEnqueue) {
    return;
  }

  // Abort any active speculation — background task state changed, so speculated
  // results may reference stale task output. The prompt suggestion text is
  // preserved; only the pre-computed response is discarded.
// 后台任务状态变了，之前推测出来的回复可能引用旧输出，先作废推测但保留建议文本
  abortSpeculation(setAppState);
  let summary: string;
// 监控任务用另一套文案与前缀：它是流式的，脚本退出意味着流结束而不是条件达成
  if (feature('MONITOR_TOOL') && kind === 'monitor') {
    // Monitor is streaming-only (post-#22764) — the script exiting means
    // the stream ended, not "condition met". Distinct from the bash prefix
    // so Monitor completions don't fold into the "N background commands
    // completed" collapse.
// 三种结束语各自对应流结束、脚本失败、被停止
    switch (status) {
      case 'completed':
        summary = `Monitor "${description}" stream ended`;
        break;
      case 'failed':
        summary = `Monitor "${description}" script failed${exitCode !== undefined ? ` (exit ${exitCode})` : ''}`;
        break;
      case 'killed':
        summary = `Monitor "${description}" stopped`;
        break;
    }
  } else {
    switch (status) {
      case 'completed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" completed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}`;
        break;
      case 'failed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" failed${exitCode !== undefined ? ` with exit code ${exitCode}` : ''}`;
        break;
      case 'killed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" was stopped`;
        break;
    }
  }
// 输出文件路径由任务标识推导，通知里带上它，模型可以直接去读全文
  const outputPath = getTaskOutputPath(taskId);
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
// 这条消息带状态标签，与卡顿通知刻意不同
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
// 监控任务的通知优先级更高：它是长期跑的后台流，用户更关心它的变化
    priority: feature('MONITOR_TOOL') ? 'next' : 'later',
    agentId
  });
}
// 任务对象本身只有名字、类型与终止方法：真正的生命周期在下面的生成函数里
export const LocalShellTask: Task = {
  name: 'LocalShellTask',
  type: 'local_bash',
  async kill(taskId, setAppState) {
    killTask(taskId, setAppState);
  }
};
// 生成一个后台命令任务：数据面由命令对象自己的输出通道负责，这里只管状态与通知
export async function spawnShellTask(input: LocalShellSpawnInput & {
  shellCommand: ShellCommand;
}, context: TaskContext): Promise<TaskHandle> {
  const {
    command,
    description,
    shellCommand,
    toolUseId,
    agentId,
    kind
  } = input;
  const {
    setAppState
  } = context;

// 任务标识取自命令的输出对象，保证磁盘上的输出文件名与任务标识一致
  // TaskOutput owns the data — use its taskId so disk writes are consistent
  const {
    taskOutput
  } = shellCommand;
  const taskId = taskOutput.taskId;
// 注册清理钩子：进程退出时把子进程一起杀掉，避免留下孤儿
  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState);
  });
// 初始状态直接是已后台化，与前台注册区分开
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
    agentId,
    kind
  };
// 注册进全局任务表，界面从这里渲染
  registerTask(taskState, setAppState);

  // Data flows through TaskOutput automatically — no stream listeners needed.
  // Just transition to backgrounded state so the process keeps running.
// 只是把命令切到后台模式，不重建流监听——数据本来就一直在往输出对象里写
  shellCommand.background(taskId);
  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);
// 命令结束的承诺：取消看门狗、落盘清理、更新状态、发通知、驱逐输出
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
// 已被杀的任务不再改状态：终止路径已经写过最终状态，这里覆盖会把被杀改成失败
    updateTaskState<LocalShellTaskState>(taskId, setAppState, task => {
      if (task.status === 'killed') {
        wasKilled = true;
        return task;
      }
      return {
        ...task,
// 退出码决定完成还是失败，中断标志单独保留给上层判断
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
// 把命令对象置空以释放句柄，清理函数也一并摘掉
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      };
    });
// 状态写完才发通知，保证模型看到通知时任务状态已经一致
    enqueueShellNotification(taskId, description, wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed', result.code, setAppState, toolUseId, kind, agentId);
// 输出文件按需驱逐：任务结束后不再需要长期保留全文
    void evictTaskOutput(taskId);
  });
  return {
    taskId,
    cleanup: () => {
      unregisterCleanup();
    }
  };
}

/**
 * Register a foreground task that could be backgrounded later.
 * Called when a bash command has been running long enough to show the BackgroundHint.
 * @returns taskId for the registered task
 */
// 注册一个可能稍后被转后台的前台任务：命令跑够久、界面开始提示可以转后台时调用
export function registerForeground(input: LocalShellSpawnInput & {
  shellCommand: ShellCommand;
}, setAppState: SetAppState, toolUseId?: string): string {
  const {
    command,
    description,
    shellCommand,
    agentId
  } = input;
  const taskId = shellCommand.taskOutput.taskId;
  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState);
  });
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
// 这里标记为未后台化，转后台时再翻这个位
    isBackgrounded: false,
    // Not yet backgrounded - running in foreground
    agentId
  };
  registerTask(taskState, setAppState);
  return taskId;
}

/**
 * Background a specific foreground task.
 * @returns true if backgrounded successfully, false otherwise
 */
// 把一个已注册的前台任务转后台
function backgroundTask(taskId: string, getAppState: () => AppState, setAppState: SetAppState): boolean {
  // Step 1: Get the task and shell command from current state
  const state = getAppState();
  const task = state.tasks[taskId];
// 三个前置条件缺一不可：是本类任务、还没后台化、命令对象还在
  if (!isLocalShellTask(task) || task.isBackgrounded || !task.shellCommand) {
    return false;
  }
  const shellCommand = task.shellCommand;
  const description = task.description;
  const {
    toolUseId,
    kind,
    agentId
  } = task;

  // Transition to backgrounded — TaskOutput continues receiving data automatically
// 切换失败就放弃：命令可能已经结束，此时没有可切的东西
  if (!shellCommand.background(taskId)) {
    return false;
  }
// 状态更新里再判一次是否已后台化，防止与另一条路径重复处理
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...prevTask,
          isBackgrounded: true
        }
      }
    };
  });
// 转后台之后才装看门狗：前台时用户看得见输出，不需要提醒
  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);

  // Set up result handler
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    let cleanupFn: (() => void) | undefined;
    updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
      if (t.status === 'killed') {
        wasKilled = true;
        return t;
      }

      // Capture cleanup function to call outside of updater
// 把清理函数带出更新函数，在外面调用——状态更新函数必须是纯的，不能有副作用
      cleanupFn = t.unregisterCleanup;
      return {
        ...t,
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      };
    });

    // Call cleanup outside of the state updater (avoid side effects in updater)
// 副作用统一放在更新函数之外执行
    cleanupFn?.();
    if (wasKilled) {
      enqueueShellNotification(taskId, description, 'killed', result.code, setAppState, toolUseId, kind, agentId);
    } else {
      const finalStatus = result.code === 0 ? 'completed' : 'failed';
      enqueueShellNotification(taskId, description, finalStatus, result.code, setAppState, toolUseId, kind, agentId);
    }
    void evictTaskOutput(taskId);
  });
  return true;
}

/**
 * Background ALL foreground tasks (bash commands and agents).
 * Called when user presses Ctrl+B to background all running tasks.
 */
/**
 * Check if there are any foreground tasks (bash or agent) that can be backgrounded.
 * Used to determine whether Ctrl+B should background existing tasks vs. background the session.
 */
// 判断有没有可转后台的前台任务：决定快捷键是转后台还是把整个会话转后台
export function hasForegroundTasks(state: AppState): boolean {
  return Object.values(state.tasks).some(task => {
    if (isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand) {
      return true;
    }
    // Exclude main session tasks - they display in the main view, not as foreground tasks
// 排除主会话任务：它显示在主视图里，不算前台任务
    if (isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task)) {
      return true;
    }
    return false;
  });
}
// 一键把所有前台任务转后台：命令与代理两类分别处理
export function backgroundAll(getAppState: () => AppState, setAppState: SetAppState): void {
  const state = getAppState();

  // Background all foreground bash tasks
  const foregroundBashTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand;
  });
  for (const taskId of foregroundBashTaskIds) {
    backgroundTask(taskId, getAppState, setAppState);
  }

  // Background all foreground agent tasks
  const foregroundAgentTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalAgentTask(task) && !task.isBackgrounded;
  });
  for (const taskId of foregroundAgentTaskIds) {
    backgroundAgentTask(taskId, getAppState, setAppState);
  }
}

/**
 * Background an already-registered foreground task in-place.
 * Unlike spawn(), this does NOT re-register the task — it flips isBackgrounded
 * on the existing registration and sets up a completion handler.
 * Used when the auto-background timer fires after registerForeground() has
 * already registered the task (avoiding duplicate task_started SDK events
 * and leaked cleanup callbacks).
 */
// 转后台但不重新注册：重新注册会重复发出任务开始事件并泄漏上一份清理回调
export function backgroundExistingForegroundTask(taskId: string, shellCommand: ShellCommand, description: string, setAppState: SetAppState, toolUseId?: string): boolean {
  if (!shellCommand.background(taskId)) {
    return false;
  }
  let agentId: AgentId | undefined;
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
    agentId = prevTask.agentId;
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...prevTask,
          isBackgrounded: true
        }
      }
    };
  });
  const cancelStallWatchdog = startStallWatchdog(taskId, description, undefined, toolUseId, agentId);

  // Set up result handler (mirrors backgroundTask's handler)
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    let cleanupFn: (() => void) | undefined;
    updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
      if (t.status === 'killed') {
        wasKilled = true;
        return t;
      }
      cleanupFn = t.unregisterCleanup;
      return {
        ...t,
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      };
    });
    cleanupFn?.();
    const finalStatus = wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed';
    enqueueShellNotification(taskId, description, finalStatus, result.code, setAppState, toolUseId, undefined, agentId);
    void evictTaskOutput(taskId);
  });
  return true;
}

/**
 * Mark a task as notified to suppress a pending enqueueShellNotification.
 * Used when backgrounding raced with completion — the tool result already
 * carries the full output, so the <task_notification> would be redundant.
 */
// 标记已通知以抑制待发的完成通知：转后台与完成撞在一起时，工具结果里已经有完整输出
export function markTaskNotified(taskId: string, setAppState: SetAppState): void {
  updateTaskState(taskId, setAppState, t => t.notified ? t : {
    ...t,
    notified: true
  });
}

/**
 * Unregister a foreground task when the command completes without being backgrounded.
 */
// 命令自然结束且没转后台时把它从前台任务表里摘掉
export function unregisterForeground(taskId: string, setAppState: SetAppState): void {
  let cleanupFn: (() => void) | undefined;
  setAppState(prev => {
    const task = prev.tasks[taskId];
    // Only remove if it's a foreground task (not backgrounded)
// 只摘前台任务：已后台化的任务由自己的完成流程负责清理
    if (!isLocalShellTask(task) || task.isBackgrounded) {
      return prev;
    }

    // Capture cleanup function to call outside of updater
    cleanupFn = task.unregisterCleanup;
    const {
      [taskId]: removed,
      ...rest
    } = prev.tasks;
    return {
      ...prev,
      tasks: rest
    };
  });

  // Call cleanup outside of the state updater (avoid side effects in updater)
  cleanupFn?.();
}
// 收尾两步：先等输出落盘再清理资源，任何异常只记日志不影响状态推进
async function flushAndCleanup(shellCommand: ShellCommand): Promise<void> {
  try {
    await shellCommand.taskOutput.flush();
    shellCommand.cleanup();
  } catch (error) {
    logError(error);
  }
}
// 原文件此处有一行 47656 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。