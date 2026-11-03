import { c as _c } from "react/compiler-runtime";
// 引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。
import figures from 'figures';
import * as React from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { AGENT_COLOR_TO_THEME_COLOR, type AgentColorName } from '../tools/AgentTool/agentColorManager.js';
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js';
import { count } from '../utils/array.js';
import { summarizeRecentActivities } from '../utils/collapseReadSearch.js';
import { truncateToWidth } from '../utils/format.js';
import { isTodoV2Enabled, type Task } from '../utils/tasks.js';
import type { Theme } from '../utils/theme.js';
import ThemedText from './design-system/ThemedText.js';
// 末尾导入 ThemedText，用于在任务 owner 处渲染带主题色的名字。
type Props = {
  tasks: Task[];
  isStandalone?: boolean;
};
// Props 类型：任务数组与是否独立模式（独立模式会额外显示总数统计）。
const RECENT_COMPLETED_TTL_MS = 30_000;
// 最近完成的任务在界面上保留 30 秒（TTL），过期后从高亮区移除。
function byIdAsc(a: Task, b: Task): number {
  const aNum = parseInt(a.id, 10);
  const bNum = parseInt(b.id, 10);
  if (!isNaN(aNum) && !isNaN(bNum)) {
    return aNum - bNum;
  }
  return a.id.localeCompare(b.id);
}
// byIdAsc 按 id 数字或字典序排序，用于任务列表的稳定排序。
export function TaskListV2({
  tasks,
  isStandalone = false
}: Props): React.ReactNode {
// TaskListV2 组件入口：渲染当前会话的任务列表，支持截断与队友活动展示。
  const teamContext = useAppState(s => s.teamContext);
  const appStateTasks = useAppState(s_0 => s_0.tasks);
  const [, forceUpdate] = React.useState(0);
  const {
    rows,
    columns
  } = useTerminalSize();

  // Track when each task was last observed transitioning to completed
  const completionTimestampsRef = React.useRef(new Map<string, number>());
// 用 ref 记录每个任务转入完成态的时间戳，用于「最近完成」高亮与自动过期。
  const previousCompletedIdsRef = React.useRef<Set<string> | null>(null);
  if (previousCompletedIdsRef.current === null) {
    previousCompletedIdsRef.current = new Set(tasks.filter(t => t.status === 'completed').map(t_0 => t_0.id));
  }
  const maxDisplay = rows <= 10 ? 0 : Math.min(10, Math.max(3, rows - 14));
// 根据终端高度算最多显示几行（至少 3、至多 10，太矮则 0 表示不截断）。

  // Update completion timestamps: reset when a task transitions to completed
  const currentCompletedIds = new Set(tasks.filter(t_1 => t_1.status === 'completed').map(t_2 => t_2.id));
  const now = Date.now();
  for (const id of currentCompletedIds) {
    if (!previousCompletedIdsRef.current.has(id)) {
      completionTimestampsRef.current.set(id, now);
    }
  }
  for (const id_0 of completionTimestampsRef.current.keys()) {
    if (!currentCompletedIds.has(id_0)) {
      completionTimestampsRef.current.delete(id_0);
    }
  }
  previousCompletedIdsRef.current = currentCompletedIds;

  // Schedule re-render when the next recent completion expires.
  // Depend on `tasks` so the timer is only reset when the task list changes,
  // not on every render (which was causing unnecessary work).
  React.useEffect(() => {
    if (completionTimestampsRef.current.size === 0) {
      return;
    }
    const currentNow = Date.now();
    let earliestExpiry = Infinity;
    for (const ts of completionTimestampsRef.current.values()) {
      const expiry = ts + RECENT_COMPLETED_TTL_MS;
      if (expiry > currentNow && expiry < earliestExpiry) {
        earliestExpiry = expiry;
      }
    }
    if (earliestExpiry === Infinity) {
      return;
    }
    const timer = setTimeout(forceUpdate_0 => forceUpdate_0((n: number) => n + 1), earliestExpiry - currentNow, forceUpdate);
    return () => clearTimeout(timer);
  }, [tasks]);
// 调度一次重渲染，在最近完成的任务刚过期时刷新界面，避免无谓的定时器。
  if (!isTodoV2Enabled()) {
    return null;
  }
// 未开启 TodoV2 时直接不渲染任务列表。
  if (tasks.length === 0) {
    return null;
  }
// 没有任何任务时也不渲染。

  // Build a map of teammate name -> theme color
  const teammateColors: Record<string, keyof Theme> = {};
  if (isAgentSwarmsEnabled() && teamContext?.teammates) {
    for (const teammate of Object.values(teamContext.teammates)) {
      if (teammate.color) {
        const themeColor = AGENT_COLOR_TO_THEME_COLOR[teammate.color as AgentColorName];
        if (themeColor) {
          teammateColors[teammate.name] = themeColor;
        }
      }
    }
  }
// 仅在 swarm 模式下，统计队友名到主题色的映射，用于给任务 owner 上色。

  // Build a map of teammate name -> current activity description
  // Map both agentName ("researcher") and agentId ("researcher@team") so
  // task owners match regardless of which format the model used.
  // Rolls up consecutive search/read tool uses into a compact summary.
  // Also track which teammates are still running (not shut down).
  const teammateActivity: Record<string, string> = {};
  const activeTeammates = new Set<string>();
  if (isAgentSwarmsEnabled()) {
    for (const bgTask of Object.values(appStateTasks)) {
      if (isInProcessTeammateTask(bgTask) && bgTask.status === 'running') {
        activeTeammates.add(bgTask.identity.agentName);
        activeTeammates.add(bgTask.identity.agentId);
        const activities = bgTask.progress?.recentActivities;
        const desc = (activities && summarizeRecentActivities(activities)) ?? bgTask.progress?.lastActivity?.activityDescription;
        if (desc) {
          teammateActivity[bgTask.identity.agentName] = desc;
          teammateActivity[bgTask.identity.agentId] = desc;
        }
      }
    }
  }
// 统计队友当前活动描述，并标记仍在运行的队友（用于显示活跃状态）。

  // Get task counts for display
  const completedCount = count(tasks, t_3 => t_3.status === 'completed');
  const pendingCount = count(tasks, t_4 => t_4.status === 'pending');
  const inProgressCount = tasks.length - completedCount - pendingCount;
// 统计已完成、待处理、进行中的任务数量。
  // Unresolved tasks (open or in_progress) block dependent tasks
  const unresolvedTaskIds = new Set(tasks.filter(t_5 => t_5.status !== 'completed').map(t_6 => t_6.id));

  // Check if we need to truncate
  const needsTruncation = tasks.length > maxDisplay;
// 判断任务总数是否超过可显示上限，决定要不要截断。
  let visibleTasks: Task[];
  let hiddenTasks: Task[];
  if (needsTruncation) {
    // Prioritize: recently completed (within 30s), in-progress, pending, older completed
    const recentCompleted: Task[] = [];
    const olderCompleted: Task[] = [];
    for (const task of tasks.filter(t_7 => t_7.status === 'completed')) {
      const ts_0 = completionTimestampsRef.current.get(task.id);
      if (ts_0 && now - ts_0 < RECENT_COMPLETED_TTL_MS) {
        recentCompleted.push(task);
      } else {
        olderCompleted.push(task);
      }
    }
    recentCompleted.sort(byIdAsc);
    olderCompleted.sort(byIdAsc);
    const inProgress = tasks.filter(t_8 => t_8.status === 'in_progress').sort(byIdAsc);
    const pending = tasks.filter(t_9 => t_9.status === 'pending').sort((a, b) => {
      const aBlocked = a.blockedBy.some(id_1 => unresolvedTaskIds.has(id_1));
      const bBlocked = b.blockedBy.some(id_2 => unresolvedTaskIds.has(id_2));
      if (aBlocked !== bBlocked) {
        return aBlocked ? 1 : -1;
      }
      return byIdAsc(a, b);
    });
    const prioritized = [...recentCompleted, ...inProgress, ...pending, ...olderCompleted];
    visibleTasks = prioritized.slice(0, maxDisplay);
    hiddenTasks = prioritized.slice(maxDisplay);
  } else {
    // No truncation needed — sort by ID for stable ordering
    visibleTasks = [...tasks].sort(byIdAsc);
    hiddenTasks = [];
  }
// 需要截断时按优先级排序：最近完成 > 进行中 > 待处理 > 较早完成。
  let hiddenSummary = '';
  if (hiddenTasks.length > 0) {
    const parts: string[] = [];
    const hiddenPending = count(hiddenTasks, t_10 => t_10.status === 'pending');
    const hiddenInProgress = count(hiddenTasks, t_11 => t_11.status === 'in_progress');
    const hiddenCompleted = count(hiddenTasks, t_12 => t_12.status === 'completed');
    if (hiddenInProgress > 0) {
      parts.push(`${hiddenInProgress} in progress`);
    }
    if (hiddenPending > 0) {
      parts.push(`${hiddenPending} pending`);
    }
    if (hiddenCompleted > 0) {
      parts.push(`${hiddenCompleted} completed`);
    }
    hiddenSummary = ` … +${parts.join(', ')}`;
  }
// 拼出被隐藏任务的摘要文案，例如「3 in progress, 2 pending」。
  const content = <>
      {visibleTasks.map(task_0 => <TaskItem key={task_0.id} task={task_0} ownerColor={task_0.owner ? teammateColors[task_0.owner] : undefined} openBlockers={task_0.blockedBy.filter(id_3 => unresolvedTaskIds.has(id_3))} activity={task_0.owner ? teammateActivity[task_0.owner] : undefined} ownerActive={task_0.owner ? activeTeammates.has(task_0.owner) : false} columns={columns} />)}
      {maxDisplay > 0 && hiddenSummary && <Text dimColor>{hiddenSummary}</Text>}
    </>;
// 渲染可见任务行（每个任务交给 TaskItem 处理）。
  if (isStandalone) {
    return <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Box>
          <Text dimColor>
            <Text bold>{tasks.length}</Text>
            {' tasks ('}
            <Text bold>{completedCount}</Text>
            {' done, '}
            {inProgressCount > 0 && <>
                <Text bold>{inProgressCount}</Text>
                {' in progress, '}
              </>}
            <Text bold>{pendingCount}</Text>
            {' open)'}
          </Text>
        </Box>
        {content}
      </Box>;
  }
// 独立模式下额外显示任务总数与分类计数，再叠加内容区。
  return <Box flexDirection="column">{content}</Box>;
// 非独立模式只渲染内容区，不带总数统计。
}
type TaskItemProps = {
  task: Task;
  ownerColor?: keyof Theme;
  openBlockers: string[];
  activity?: string;
  ownerActive: boolean;
  columns: number;
};
function getTaskIcon(status: Task['status']): {
  icon: string;
  color: keyof Theme | undefined;
} {
  switch (status) {
    case 'completed':
      return {
        icon: figures.tick,
        color: 'success'
      };
    case 'in_progress':
      return {
        icon: figures.squareSmallFilled,
        color: 'claude'
      };
    case 'pending':
      return {
        icon: figures.squareSmall,
        color: undefined
      };
  }
}
function TaskItem(t0) {
  const $ = _c(37);
  const {
    task,
    ownerColor,
    openBlockers,
    activity,
    ownerActive,
    columns
  } = t0;
  const isCompleted = task.status === "completed";
// 由任务状态推导 isCompleted / isInProgress / isBlocked 三个布尔值。
  const isInProgress = task.status === "in_progress";
  const isBlocked = openBlockers.length > 0;
  let t1;
  if ($[0] !== task.status) {
    t1 = getTaskIcon(task.status);
    $[0] = task.status;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const {
    icon,
    color
  } = t1;
  const showActivity = isInProgress && !isBlocked && activity;
  const showOwner = columns >= 60 && task.owner && ownerActive;
  let t2;
  if ($[2] !== showOwner || $[3] !== task.owner) {
    t2 = showOwner ? stringWidth(` (@${task.owner})`) : 0;
    $[2] = showOwner;
    $[3] = task.owner;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const ownerWidth = t2;
  const maxSubjectWidth = Math.max(15, columns - 15 - ownerWidth);
// maxSubjectWidth 留给主题文字的最大宽度（至少 15 列），超出截断。
  let t3;
  if ($[5] !== maxSubjectWidth || $[6] !== task.subject) {
    t3 = truncateToWidth(task.subject, maxSubjectWidth);
    $[5] = maxSubjectWidth;
    $[6] = task.subject;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const displaySubject = t3;
  const maxActivityWidth = Math.max(15, columns - 15);
  let t4;
  if ($[8] !== activity || $[9] !== maxActivityWidth) {
    t4 = activity ? truncateToWidth(activity, maxActivityWidth) : undefined;
    $[8] = activity;
    $[9] = maxActivityWidth;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  const displayActivity = t4;
  let t5;
  if ($[11] !== color || $[12] !== icon) {
    t5 = <Text color={color}>{icon} </Text>;
    $[11] = color;
    $[12] = icon;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const t6 = isCompleted || isBlocked;
// t6 标记该行是否需要删除线或变暗（完成任务加删除线，受阻/完成变暗）。
  let t7;
  if ($[14] !== displaySubject || $[15] !== isCompleted || $[16] !== isInProgress || $[17] !== t6) {
    t7 = <Text bold={isInProgress} strikethrough={isCompleted} dimColor={t6}>{displaySubject}</Text>;
    $[14] = displaySubject;
    $[15] = isCompleted;
    $[16] = isInProgress;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  let t8;
  if ($[19] !== ownerColor || $[20] !== showOwner || $[21] !== task.owner) {
    t8 = showOwner && <Text dimColor={true}>{" ("}{ownerColor ? <ThemedText color={ownerColor}>@{task.owner}</ThemedText> : `@${task.owner}`}{")"}</Text>;
    $[19] = ownerColor;
    $[20] = showOwner;
    $[21] = task.owner;
    $[22] = t8;
  } else {
    t8 = $[22];
  }
  let t9;
  if ($[23] !== isBlocked || $[24] !== openBlockers) {
    t9 = isBlocked && <Text dimColor={true}>{" "}{figures.pointerSmall} blocked by{" "}{[...openBlockers].sort(_temp).map(_temp2).join(", ")}</Text>;
    $[23] = isBlocked;
    $[24] = openBlockers;
    $[25] = t9;
  } else {
    t9 = $[25];
  }
  let t10;
  if ($[26] !== t5 || $[27] !== t7 || $[28] !== t8 || $[29] !== t9) {
    t10 = <Box>{t5}{t7}{t8}{t9}</Box>;
    $[26] = t5;
    $[27] = t7;
    $[28] = t8;
    $[29] = t9;
    $[30] = t10;
  } else {
    t10 = $[30];
  }
  let t11;
  if ($[31] !== displayActivity || $[32] !== showActivity) {
    t11 = showActivity && displayActivity && <Box><Text dimColor={true}>{"  "}{displayActivity}{figures.ellipsis}</Text></Box>;
    $[31] = displayActivity;
    $[32] = showActivity;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  let t12;
  if ($[34] !== t10 || $[35] !== t11) {
    t12 = <Box flexDirection="column">{t10}{t11}</Box>;
    $[34] = t10;
    $[35] = t11;
    $[36] = t12;
  } else {
    t12 = $[36];
  }
  return t12;
// 返回单个任务的完整节点（图标 + 主题文字 + owner + 阻塞 + 活动）。
}
function _temp2(id) {
  return `#${id}`;
}
function _temp(a, b) {
  return parseInt(a, 10) - parseInt(b, 10);
// _temp 按 id 数字升序比较两个任务，配合排序使用。
}
// 原文件此处有一行 37268 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。