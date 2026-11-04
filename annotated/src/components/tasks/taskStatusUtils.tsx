// 任务状态展示的共享工具集：图标、颜色、队员活动文案、页脚隐藏判定四件套，供任务面板与状态条等处共用——同一状态在所有界面上必须长一个样。
/**
 * Shared utilities for displaying task status across different task types.
 */

import figures from 'figures';
import type { TaskStatus } from 'src/Task.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import { isPanelAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { summarizeRecentActivities } from 'src/utils/collapseReadSearch.js';

/**
 * Returns true if the given task status represents a terminal (finished) state.
 */
// isTerminalStatus：completed、failed、killed 三种终态。轮询逻辑用它判断是否停止刷新。
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

/**
 * Returns the appropriate icon for a task based on status and state flags.
 */
// getTaskStatusIcon 优先级链：出错大于等待审批大于请求关停大于运行态（空闲显省略号、忙碌显播放）大于终态，最后落到普通圆点。状态标志优先于 status 字段——附加信息比基础状态更能说明当前卡在哪。
export function getTaskStatusIcon(status: TaskStatus, options?: {
  isIdle?: boolean;
  awaitingApproval?: boolean;
  hasError?: boolean;
  shutdownRequested?: boolean;
}): string {
  const {
    isIdle,
    awaitingApproval,
    hasError,
    shutdownRequested
  } = options ?? {};
  if (hasError) return figures.cross;
  if (awaitingApproval) return figures.questionMarkPrefix;
  if (shutdownRequested) return figures.warning;
  if (status === 'running') {
    if (isIdle) return figures.ellipsis;
    return figures.play;
  }
  if (status === 'completed') return figures.tick;
  if (status === 'failed' || status === 'killed') return figures.cross;
  return figures.bullet;
}

/**
 * Returns the appropriate semantic color for a task based on status and state flags.
 */
// getTaskStatusColor 与图标同构映射：killed 显 warning 而非 error——用户主动杀掉的任务不是故障。killed 的图标和 error 同为叉号，颜色是两者唯一的区别。
export function getTaskStatusColor(status: TaskStatus, options?: {
  isIdle?: boolean;
  awaitingApproval?: boolean;
  hasError?: boolean;
  shutdownRequested?: boolean;
}): 'success' | 'error' | 'warning' | 'background' {
  const {
    isIdle,
    awaitingApproval,
    hasError,
    shutdownRequested
  } = options ?? {};
  if (hasError) return 'error';
  if (awaitingApproval) return 'warning';
  if (shutdownRequested) return 'warning';
  if (isIdle) return 'background';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'killed') return 'warning';
  return 'background';
}

/**
 * Derives a human-readable activity string for an in-process teammate,
 * accounting for shutdown/approval/idle states and falling back through
 * recent-activity summary → last activity description → 'working'.
 */
// describeTeammateActivity 三级兜底：stopping、awaiting approval、idle 三个显式态优先；然后最近活动摘要（collapseReadSearch 把连续读搜折叠成一句话）、最后活动描述、working 文案依次回退——宁可显示笼统的 working 也不留空白。
export function describeTeammateActivity(t: DeepImmutable<InProcessTeammateTaskState>): string {
  if (t.shutdownRequested) return 'stopping';
  if (t.awaitingPlanApproval) return 'awaiting approval';
  if (t.isIdle) return 'idle';
  return (t.progress?.recentActivities && summarizeRecentActivities(t.progress.recentActivities)) ?? t.progress?.lastActivity?.activityDescription ?? 'working';
}

/**
 * Returns true when BackgroundTaskStatus would render nothing because the
 * spinner tree is active and every visible background task is an in-process
 * teammate (teammates are shown in the spinner tree instead).
 *
 * Uses the same task filtering as BackgroundTaskStatus: `isBackgroundTask()`
 * plus exclusion of panel-managed agent tasks for ants (those are shown
 * by CoordinatorTaskPanel).
 */
// shouldHideTasksFooter：spinner 树激活且所有可见任务都是 in_process 队友时隐藏任务页脚——队友已在树的节点里显示，页脚再列一遍是重复。注释强调与 BackgroundTaskStatus 用同一套过滤谓词，防止两处判定漂移后出现「树里没有、页脚有」的幽灵任务。
export function shouldHideTasksFooter(tasks: {
  [taskId: string]: TaskState;
}, showSpinnerTree: boolean): boolean {
  if (!showSpinnerTree) return false;
  let hasVisibleTask = false;
  for (const t of Object.values(tasks) as TaskState[]) {
// external 与 ant 的比较被编译期内联成字面量——特性常量（区分发行版本）的痕迹，正式构建里该分支恒假或恒真由构建期决定。
    if (!isBackgroundTask(t) || "external" === 'ant' && isPanelAgentTask(t)) {
      continue;
    }
    hasVisibleTask = true;
    if (t.type !== 'in_process_teammate') return false;
  }
  return hasVisibleTask;
}
// 原文件此处有一行 9792 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。