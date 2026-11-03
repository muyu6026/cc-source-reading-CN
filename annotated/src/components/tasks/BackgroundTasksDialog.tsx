// 本文件是后台任务总管对话框（/tasks 入口）：把七类后台任务（本地 shell、远程代理、本地代理、进程内队友、工作流、MCP 监视器、dream）统一列进一个可导航列表，Enter 进详情、x 停止、f 前台化。文件由 React Compiler 编译，主组件外的 Item / TeammateTaskGroups 是编译出的子组件，尾部 _temp / _temp2 是提升出来的谓词。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import figures from 'figures';
import React, { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView } from 'src/state/teammateViewHelpers.js';
import type { ToolUseContext } from 'src/Tool.js';
import { DreamTask, type DreamTaskState } from 'src/tasks/DreamTask/DreamTask.js';
import { InProcessTeammateTask } from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { LocalAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import { LocalShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
// Type import is erased at build time — safe even though module is ant-gated.
import type { LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { MonitorMcpTaskState } from 'src/tasks/MonitorMcpTask/MonitorMcpTask.js';
import { RemoteAgentTask, type RemoteAgentTaskState } from 'src/tasks/RemoteAgentTask/RemoteAgentTask.js';
import { type BackgroundTaskState, isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { intersperse } from 'src/utils/array.js';
import { TEAM_LEAD_NAME } from 'src/utils/swarm/constants.js';
import { stopUltraplan } from '../../commands/ultraplan.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { count } from '../../utils/array.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';
import { BackgroundTask as BackgroundTaskComponent } from './BackgroundTask.js';
import { DreamDetailDialog } from './DreamDetailDialog.js';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';
import { RemoteSessionDetailDialog } from './RemoteSessionDetailDialog.js';
import { ShellDetailDialog } from './ShellDetailDialog.js';
// ViewState：两种形态——list 是总列表，detail 是按任务 id 进详情。用单个状态对象而非布尔标记，避免「列表 + 详情同时存在」的非法中间态。
type ViewState = {
  mode: 'list';
} | {
  mode: 'detail';
  itemId: string;
};
// Props：onDone 关闭对话框并上报结果文案；initialDetailTaskId 允许调用方直接跳进某个任务的详情（如通知点击直达）。
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  toolUseContext: ToolUseContext;
  initialDetailTaskId?: string;
};
// ListItem：七类任务加上 leader（队长入口）的可辨识联合。每类带各自的 task 状态快照（DeepImmutable 包裹，防止列表渲染时误改），type 字段驱动后续的停止与详情分派。
type ListItem = {
  id: string;
  type: 'local_bash';
  label: string;
  status: string;
  task: DeepImmutable<LocalShellTaskState>;
} | {
  id: string;
  type: 'remote_agent';
  label: string;
  status: string;
  task: DeepImmutable<RemoteAgentTaskState>;
} | {
  id: string;
  type: 'local_agent';
  label: string;
  status: string;
  task: DeepImmutable<LocalAgentTaskState>;
} | {
  id: string;
  type: 'in_process_teammate';
  label: string;
  status: string;
  task: DeepImmutable<InProcessTeammateTaskState>;
} | {
  id: string;
  type: 'local_workflow';
  label: string;
  status: string;
  task: DeepImmutable<LocalWorkflowTaskState>;
} | {
  id: string;
  type: 'monitor_mcp';
  label: string;
  status: string;
  task: DeepImmutable<MonitorMcpTaskState>;
} | {
  id: string;
  type: 'dream';
  label: string;
  status: string;
  task: DeepImmutable<DreamTaskState>;
} | {
  id: string;
  type: 'leader';
  label: string;
  status: 'running';
};

// 特性门控的动态 require：WORKFLOW_SCRIPTS 是 ant 内部特性（构建旗标），静态 import 会把约 1.3K 行泄漏进外部构建，所以用 feature() + require 让打包器死代码消除整条分支。注意 116 行注释的坑：require 路径必须用相对路径，src/... 路径映射字符串 Bun 的 DCE 解析不了，会作为死字面量残留在产物里。
// WORKFLOW_SCRIPTS is ant-only (build_flags.yaml). Static imports would leak
// ~1.3K lines into external builds. Gate with feature() + require so the
// bundler can dead-code-eliminate the branch.
/* eslint-disable @typescript-eslint/no-require-imports */
const WorkflowDetailDialog = feature('WORKFLOW_SCRIPTS') ? (require('./WorkflowDetailDialog.js') as typeof import('./WorkflowDetailDialog.js')).WorkflowDetailDialog : null;
const workflowTaskModule = feature('WORKFLOW_SCRIPTS') ? require('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') as typeof import('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') : null;
const killWorkflowTask = workflowTaskModule?.killWorkflowTask ?? null;
const skipWorkflowAgent = workflowTaskModule?.skipWorkflowAgent ?? null;
const retryWorkflowAgent = workflowTaskModule?.retryWorkflowAgent ?? null;
// MonitorMcp 同样走特性门控（MONITOR_TOOL）。这一段是「可选功能不进发行包」的通用模式：模块、对话框、kill 函数三者都要门控，缺一个就漏。
// Relative path, not `src/...` path-mapping — Bun's DCE can statically
// resolve + eliminate `./` requires, but path-mapped strings stay opaque
// and survive as dead literals in the bundle. Matches tasks.ts pattern.
const monitorMcpModule = feature('MONITOR_TOOL') ? require('../../tasks/MonitorMcpTask/MonitorMcpTask.js') as typeof import('../../tasks/MonitorMcpTask/MonitorMcpTask.js') : null;
const killMonitorMcp = monitorMcpModule?.killMonitorMcp ?? null;
const MonitorMcpDetailDialog = feature('MONITOR_TOOL') ? (require('./MonitorMcpDetailDialog.js') as typeof import('./MonitorMcpDetailDialog.js')).MonitorMcpDetailDialog : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Helper to get filtered background tasks (excludes foregrounded local_agent)
// getSelectableBackgroundTasks：从全局任务表里筛出后台任务，并排除正在前台展示的 local_agent——它已在主界面显示，再进列表会重复。
function getSelectableBackgroundTasks(tasks: Record<string, TaskState> | undefined, foregroundedTaskId: string | undefined): TaskState[] {
  const backgroundTasks = Object.values(tasks ?? {}).filter(isBackgroundTask);
  return backgroundTasks.filter(task => !(task.type === 'local_agent' && task.id === foregroundedTaskId));
}
// BackgroundTasksDialog 主组件。
export function BackgroundTasksDialog({
  onDone,
  toolUseContext,
  initialDetailTaskId
}: Props): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const foregroundedTaskId = useAppState(s_0 => s_0.foregroundedTaskId);
  const showSpinnerTree = useAppState(s_1 => s_1.expandedView) === 'teammates';
  const setAppState = useSetAppState();
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const typedTasks = tasks as Record<string, TaskState> | undefined;

  // Track if we skipped list view on mount (for back button behavior)
  const skippedListOnMount = useRef(false);
// skippedListOnMount：记录挂载时是否跳过了列表页（调用方直达详情，或恰好只有一个任务自动直达）。它决定返回键是「回列表」还是「直接关对话框」。用 ref 而非 state，因为它只是行为标记，不需要触发重渲染。

  // Compute initial view state - skip list if caller provided a specific task,
  // or if there's exactly one task
// 初始视图惰性求值：有指定任务或只有一个可选任务就直接进详情。一个任务也自动跳详情是刻意设计——单独弹个列表再选一次太浪费交互。
  const [viewState, setViewState] = useState<ViewState>(() => {
    if (initialDetailTaskId) {
      skippedListOnMount.current = true;
      return {
        mode: 'detail',
        itemId: initialDetailTaskId
      };
    }
    const allItems = getSelectableBackgroundTasks(typedTasks, foregroundedTaskId);
    if (allItems.length === 1) {
      skippedListOnMount.current = true;
      return {
        mode: 'detail',
        itemId: allItems[0]!.id
      };
    }
    return {
      mode: 'list'
    };
  });
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Register as modal overlay so parent Chat keybindings (up/down for history)
  // are deactivated while this dialog is open
  useRegisterOverlay('background-tasks-dialog');
// useRegisterOverlay：注册成模态覆盖层，挂起父级 Chat 的上下键（历史回溯）等快捷键，避免两层键盘处理打架。

  // Memoize the sorted and categorized items together to ensure stable references
  const {
    bashTasks,
    remoteSessions,
    agentTasks,
    teammateTasks,
    workflowTasks,
    mcpMonitors,
    dreamTasks: dreamTasks_0,
    allSelectableItems
  } = useMemo(() => {
    // Filter to only show running/pending background tasks, matching the status bar count
    const backgroundTasks = Object.values(typedTasks ?? {}).filter(isBackgroundTask);
    const allItems_0 = backgroundTasks.map(toListItem);
    const sorted = allItems_0.sort((a, b) => {
      const aStatus = a.status;
      const bStatus = b.status;
      if (aStatus === 'running' && bStatus !== 'running') return -1;
      if (aStatus !== 'running' && bStatus === 'running') return 1;
      const aTime = 'task' in a ? a.task.startTime : 0;
      const bTime = 'task' in b ? b.task.startTime : 0;
      return bTime - aTime;
    });
    const bash = sorted.filter(item => item.type === 'local_bash');
    const remote = sorted.filter(item_0 => item_0.type === 'remote_agent');
    // Exclude foregrounded task - it's being viewed in the main UI, not a background task
    const agent = sorted.filter(item_1 => item_1.type === 'local_agent' && item_1.id !== foregroundedTaskId);
    const workflows = sorted.filter(item_2 => item_2.type === 'local_workflow');
    const monitorMcp = sorted.filter(item_3 => item_3.type === 'monitor_mcp');
    const dreamTasks = sorted.filter(item_4 => item_4.type === 'dream');
    // In spinner-tree mode, exclude teammates from the dialog (they appear in the tree)
    const teammates = showSpinnerTree ? [] : sorted.filter(item_5 => item_5.type === 'in_process_teammate');
    // Add leader entry when there are teammates, so users can foreground back to leader
    const leaderItem: ListItem[] = teammates.length > 0 ? [{
      id: '__leader__',
      type: 'leader',
      label: `@${TEAM_LEAD_NAME}`,
      status: 'running'
    }] : [];
    return {
      bashTasks: bash,
      remoteSessions: remote,
      agentTasks: agent,
      workflowTasks: workflows,
      mcpMonitors: monitorMcp,
      dreamTasks,
      teammateTasks: [...leaderItem, ...teammates],
      // Order MUST match JSX render order (teammates \u2192 bash \u2192 monitorMcp \u2192
      // remote \u2192 agent \u2192 workflows \u2192 dream) so \u2193/\u2191 navigation moves the cursor
      // visually downward.
      allSelectableItems: [...leaderItem, ...teammates, ...bash, ...monitorMcp, ...remote, ...agent, ...workflows, ...dreamTasks]
    };
  }, [typedTasks, foregroundedTaskId, showSpinnerTree]);
// allSelectableItems 的顺序契约：必须与下方 JSX 的分组渲染顺序一致（队友 → shell → 监视器 → 远程 → 本地代理 → 工作流 → dream），否则上下键移动的光标与视觉位置错位。这是本文件最脆弱的隐式约定，改渲染顺序必须同步改这里。
  const currentSelection = allSelectableItems[selectedIndex] ?? null;
// currentSelection：selectedIndex 越界时落 null，渲染与键盘处理都要容忍空值。

  // Use configurable keybindings for standard navigation and confirm/cancel.
  // confirm:no is handled by Dialog's onCancel prop.
// 标准导航走可配置键绑定（confirm:previous / next / yes），只在 list 模式激活；详情模式下这些键交回给详情对话框。
  useKeybindings({
    'confirm:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
    'confirm:next': () => setSelectedIndex(prev_0 => Math.min(allSelectableItems.length - 1, prev_0 + 1)),
    'confirm:yes': () => {
      const current = allSelectableItems[selectedIndex];
      if (current) {
        if (current.type === 'leader') {
          exitTeammateView(setAppState);
          onDone('Viewing leader', {
            display: 'system'
          });
        } else {
          setViewState({
            mode: 'detail',
            itemId: current.id
          });
        }
      }
    }
  }, {
    context: 'Confirmation',
    isActive: viewState.mode === 'list'
  });

  // Component-specific shortcuts (x=stop, f=foreground, right=zoom) shown in UI.
  // These are task-type and status dependent, not standard dialog keybindings.
// handleKeyDown：组件专属快捷键（x 停止、f 前台化、左键关闭）。这些是任务类型与状态相关的动作，不适合进全局键绑定表，所以用原生 onKeyDown。
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle input when in list mode
    if (viewState.mode !== 'list') return;
    if (e.key === 'left') {
      e.preventDefault();
      onDone('Background tasks dialog dismissed', {
        display: 'system'
      });
      return;
    }

    // Compute current selection at the time of the key press
    const currentSelection_0 = allSelectableItems[selectedIndex];
    if (!currentSelection_0) return; // everything below requires a selection

// x 键的停止分派：按任务类型调各自的 kill 静态方法。远程代理再分叉——ultraplan 会话要走 stopUltraplan（要连带清理计划状态），普通远程代理直接 kill。每支都先查 status 是否 running，停掉的任务再按 x 无效。
    if (e.key === 'x') {
      e.preventDefault();
      if (currentSelection_0.type === 'local_bash' && currentSelection_0.status === 'running') {
        void killShellTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_agent' && currentSelection_0.status === 'running') {
        void killAgentTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'in_process_teammate' && currentSelection_0.status === 'running') {
        void killTeammateTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_workflow' && currentSelection_0.status === 'running' && killWorkflowTask) {
        killWorkflowTask(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'monitor_mcp' && currentSelection_0.status === 'running' && killMonitorMcp) {
        killMonitorMcp(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'dream' && currentSelection_0.status === 'running') {
        void killDreamTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'remote_agent' && currentSelection_0.status === 'running') {
        if (currentSelection_0.task.isUltraplan) {
          void stopUltraplan(currentSelection_0.id, currentSelection_0.task.sessionId, setAppState);
        } else {
          void killRemoteAgentTask(currentSelection_0.id);
        }
      }
    }
// f 键：进程内队友进其专属视图（enterTeammateView），leader 则退出队友视图回到队长本体。这是多智能体 swarm 的视图切换入口。
    if (e.key === 'f') {
      if (currentSelection_0.type === 'in_process_teammate' && currentSelection_0.status === 'running') {
        e.preventDefault();
        enterTeammateView(currentSelection_0.id, setAppState);
        onDone('Viewing teammate', {
          display: 'system'
        });
      } else if (currentSelection_0.type === 'leader') {
        e.preventDefault();
        exitTeammateView(setAppState);
        onDone('Viewing leader', {
          display: 'system'
        });
      }
    }
  };
// 五个 kill 辅助函数：纯粹是给各类任务的静态 kill 包一层 async 语法糖（void 调用不阻塞键盘处理）。分开写而非用一个 map 分派，是为了类型收窄——每类的 task 状态形状不同。
  async function killShellTask(taskId: string): Promise<void> {
    await LocalShellTask.kill(taskId, setAppState);
  }
  async function killAgentTask(taskId_0: string): Promise<void> {
    await LocalAgentTask.kill(taskId_0, setAppState);
  }
  async function killTeammateTask(taskId_1: string): Promise<void> {
    await InProcessTeammateTask.kill(taskId_1, setAppState);
  }
  async function killDreamTask(taskId_2: string): Promise<void> {
    await DreamTask.kill(taskId_2, setAppState);
  }
  async function killRemoteAgentTask(taskId_3: string): Promise<void> {
    await RemoteAgentTask.kill(taskId_3, setAppState);
  }

  // Wrap onDone in useEffectEvent to get a stable reference that always calls
  // the current onDone callback without causing the effect to re-fire.
  const onDoneEvent = useEffectEvent(onDone);
// onDoneEvent：useEffectEvent 包装 onDone，得到「引用稳定但永远调最新回调」的函数——下面的 useEffect 依赖它不会反复重跑，调用时又不会捕获旧闭包。这是 React 官方为「事件与 effect 解耦」提供的原语。
  useEffect(() => {
    if (viewState.mode !== 'list') {
      const task = (typedTasks ?? {})[viewState.itemId];
      // Workflow tasks get a grace: their detail view stays open through
      // completion so the user sees the final state before eviction.
      if (!task || task.type !== 'local_workflow' && !isBackgroundTask(task)) {
        // Task was removed or is no longer a background task (e.g. killed).
        // If we skipped the list on mount, close the dialog entirely.
        if (skippedListOnMount.current) {
          onDoneEvent('Background tasks dialog dismissed', {
            display: 'system'
          });
        } else {
          setViewState({
            mode: 'list'
          });
        }
      }
    }
    const totalItems = allSelectableItems.length;
    if (selectedIndex >= totalItems && totalItems > 0) {
      setSelectedIndex(totalItems - 1);
    }
  }, [viewState, typedTasks, selectedIndex, allSelectableItems, onDoneEvent]);

  // Helper to go back to list view (or close dialog if we skipped list on
  // mount AND there's still only ≤1 item). Checking current count prevents
  // the stale-state trap: if you opened with 1 task (auto-skipped to detail),
  // then a second task started, 'back' should show the list — not close.
// goBackToList：返回列表或关闭对话框的判定。注意注释里的过期状态陷阱：如果挂载时只有 1 个任务（自动跳过了列表），之后第二个任务启动了，此时按返回应该看到列表而不是关掉对话框——所以要用当前数量重新判定，不能只看 skippedListOnMount。
  const goBackToList = () => {
    if (skippedListOnMount.current && allSelectableItems.length <= 1) {
      onDone('Background tasks dialog dismissed', {
        display: 'system'
      });
    } else {
      skippedListOnMount.current = false;
      setViewState({
        mode: 'list'
      });
    }
  };

  // If an item is selected, show the appropriate view
// 详情模式分派：按任务类型渲染对应的详情对话框，每个都用 key 绑定任务 id，任务切换时强制重建组件内部状态。workflow 与 monitor 的对话框可能是 null（特性门控未开），渲染前判空。
  if (viewState.mode !== 'list' && typedTasks) {
    const task_0 = typedTasks[viewState.itemId];
    if (!task_0) {
      return null;
    }

    // Detail mode - show appropriate detail dialog
    switch (task_0.type) {
      case 'local_bash':
        return <ShellDetailDialog shell={task_0} onDone={onDone} onKillShell={() => void killShellTask(task_0.id)} onBack={goBackToList} key={`shell-${task_0.id}`} />;
      case 'local_agent':
        return <AsyncAgentDetailDialog agent={task_0} onDone={onDone} onKillAgent={() => void killAgentTask(task_0.id)} onBack={goBackToList} key={`agent-${task_0.id}`} />;
      case 'remote_agent':
        return <RemoteSessionDetailDialog session={task_0} onDone={onDone} toolUseContext={toolUseContext} onBack={goBackToList} onKill={task_0.status !== 'running' ? undefined : task_0.isUltraplan ? () => void stopUltraplan(task_0.id, task_0.sessionId, setAppState) : () => void killRemoteAgentTask(task_0.id)} key={`session-${task_0.id}`} />;
      case 'in_process_teammate':
        return <InProcessTeammateDetailDialog teammate={task_0} onDone={onDone} onKill={task_0.status === 'running' ? () => void killTeammateTask(task_0.id) : undefined} onBack={goBackToList} onForeground={task_0.status === 'running' ? () => {
          enterTeammateView(task_0.id, setAppState);
          onDone('Viewing teammate', {
            display: 'system'
          });
        } : undefined} key={`teammate-${task_0.id}`} />;
      case 'local_workflow':
        if (!WorkflowDetailDialog) return null;
        return <WorkflowDetailDialog workflow={task_0} onDone={onDone} onKill={task_0.status === 'running' && killWorkflowTask ? () => killWorkflowTask(task_0.id, setAppState) : undefined} onSkipAgent={task_0.status === 'running' && skipWorkflowAgent ? agentId => skipWorkflowAgent(task_0.id, agentId, setAppState) : undefined} onRetryAgent={task_0.status === 'running' && retryWorkflowAgent ? agentId_0 => retryWorkflowAgent(task_0.id, agentId_0, setAppState) : undefined} onBack={goBackToList} key={`workflow-${task_0.id}`} />;
      case 'monitor_mcp':
        if (!MonitorMcpDetailDialog) return null;
        return <MonitorMcpDetailDialog task={task_0} onKill={task_0.status === 'running' && killMonitorMcp ? () => killMonitorMcp(task_0.id, setAppState) : undefined} onBack={goBackToList} key={`monitor-mcp-${task_0.id}`} />;
      case 'dream':
        return <DreamDetailDialog task={task_0} onDone={() => onDone('Background tasks dialog dismissed', {
          display: 'system'
        })} onBack={goBackToList} onKill={task_0.status === 'running' ? () => void killDreamTask(task_0.id) : undefined} key={`dream-${task_0.id}`} />;
    }
  }
  const runningBashCount = count(bashTasks, _ => _.status === 'running');
  const runningAgentCount = count(remoteSessions, __0 => __0.status === 'running' || __0.status === 'pending') + count(agentTasks, __1 => __1.status === 'running');
  const runningTeammateCount = count(teammateTasks, __2 => __2.status === 'running');
// 统计各组的运行数，拼成副标题（如 2 agents · 1 active shell · 3 active agents），单复数在 JSX 里处理。
  const subtitle = intersperse([...(runningTeammateCount > 0 ? [<Text key="teammates">
              {runningTeammateCount}{' '}
              {runningTeammateCount !== 1 ? 'agents' : 'agent'}
            </Text>] : []), ...(runningBashCount > 0 ? [<Text key="shells">
              {runningBashCount}{' '}
              {runningBashCount !== 1 ? 'active shells' : 'active shell'}
            </Text>] : []), ...(runningAgentCount > 0 ? [<Text key="agents">
              {runningAgentCount}{' '}
              {runningAgentCount !== 1 ? 'active agents' : 'active agent'}
            </Text>] : [])], index => <Text key={`separator-${index}`}> · </Text>);
  const actions = [<KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />, <KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />, ...(currentSelection?.type === 'in_process_teammate' && currentSelection.status === 'running' ? [<KeyboardShortcutHint key="foreground" shortcut="f" action="foreground" />] : []), ...((currentSelection?.type === 'local_bash' || currentSelection?.type === 'local_agent' || currentSelection?.type === 'in_process_teammate' || currentSelection?.type === 'local_workflow' || currentSelection?.type === 'monitor_mcp' || currentSelection?.type === 'dream' || currentSelection?.type === 'remote_agent') && currentSelection.status === 'running' ? [<KeyboardShortcutHint key="kill" shortcut="x" action="stop" />] : []), ...(agentTasks.some(t => t.status === 'running') ? [<KeyboardShortcutHint key="kill-all" shortcut={killAgentsShortcut} action="stop all agents" />] : []), <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />];
  const handleCancel = () => onDone('Background tasks dialog dismissed', {
    display: 'system'
  });
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <Byline>{actions}</Byline>;
  }
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title="Background tasks" subtitle={<>{subtitle}</>} onCancel={handleCancel} color="background" inputGuide={renderInputGuide}>
        {allSelectableItems.length === 0 ? <Text dimColor>No tasks currently running</Text> : <Box flexDirection="column">
            {teammateTasks.length > 0 && <Box flexDirection="column">
                {(bashTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0) && <Text dimColor>
                    <Text bold>{'  '}Agents</Text> (
                    {count(teammateTasks, i => i.type !== 'leader')})
                  </Text>}
                <Box flexDirection="column">
                  <TeammateTaskGroups teammateTasks={teammateTasks} currentSelectionId={currentSelection?.id} />
                </Box>
              </Box>}

            {bashTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 ? 1 : 0}>
                {(teammateTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0) && <Text dimColor>
                    <Text bold>{'  '}Shells</Text> ({bashTasks.length})
                  </Text>}
                <Box flexDirection="column">
                  {bashTasks.map(item_6 => <Item key={item_6.id} item={item_6} isSelected={item_6.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {mcpMonitors.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Monitors</Text> ({mcpMonitors.length})
                </Text>
                <Box flexDirection="column">
                  {mcpMonitors.map(item_7 => <Item key={item_7.id} item={item_7} isSelected={item_7.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {remoteSessions.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Remote agents</Text> ({remoteSessions.length}
                  )
                </Text>
                <Box flexDirection="column">
                  {remoteSessions.map(item_8 => <Item key={item_8.id} item={item_8} isSelected={item_8.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {agentTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Local agents</Text> ({agentTasks.length})
                </Text>
                <Box flexDirection="column">
                  {agentTasks.map(item_9 => <Item key={item_9.id} item={item_9} isSelected={item_9.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {workflowTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Workflows</Text> ({workflowTasks.length})
                </Text>
                <Box flexDirection="column">
                  {workflowTasks.map(item_10 => <Item key={item_10.id} item={item_10} isSelected={item_10.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {dreamTasks_0.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 || workflowTasks.length > 0 ? 1 : 0}>
                <Box flexDirection="column">
                  {dreamTasks_0.map(item_11 => <Item key={item_11.id} item={item_11} isSelected={item_11.id === currentSelection?.id} />)}
                </Box>
              </Box>}
          </Box>}
      </Dialog>
    </Box>;
}
// toListItem：TaskState 到 ListItem 的映射。label 按类型取最语义化的字段：shell 用命令行（monitor 型用描述）、远程用标题、队友加 @ 前缀、工作流优先 summary。
function toListItem(task: BackgroundTaskState): ListItem {
  switch (task.type) {
    case 'local_bash':
      return {
        id: task.id,
        type: 'local_bash',
        label: task.kind === 'monitor' ? task.description : task.command,
        status: task.status,
        task
      };
    case 'remote_agent':
      return {
        id: task.id,
        type: 'remote_agent',
        label: task.title,
        status: task.status,
        task
      };
    case 'local_agent':
      return {
        id: task.id,
        type: 'local_agent',
        label: task.description,
        status: task.status,
        task
      };
    case 'in_process_teammate':
      return {
        id: task.id,
        type: 'in_process_teammate',
        label: `@${task.identity.agentName}`,
        status: task.status,
        task
      };
    case 'local_workflow':
      return {
        id: task.id,
        type: 'local_workflow',
        label: task.summary ?? task.description,
        status: task.status,
        task
      };
    case 'monitor_mcp':
      return {
        id: task.id,
        type: 'monitor_mcp',
        label: task.description,
        status: task.status,
        task
      };
    case 'dream':
      return {
        id: task.id,
        type: 'dream',
        label: task.description,
        status: task.status,
        task
      };
  }
}
// Item：列表行。maxActivityWidth 按终端列数自适应（至少 30 列），coordinator 模式下选中行用灰指针（isCoordinatorMode 只调一次，缓存在记忆槽 0——这是编译器把「运行时不变量」提升到首次渲染求值的例子）。
function Item(t0) {
  const $ = _c(14);
  const {
    item,
    isSelected
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const maxActivityWidth = Math.max(30, columns - 26);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = isCoordinatorMode();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const useGreyPointer = t1;
  const t2 = useGreyPointer && isSelected;
  const t3 = isSelected ? figures.pointer + " " : "  ";
  let t4;
  if ($[1] !== t2 || $[2] !== t3) {
    t4 = <Text dimColor={t2}>{t3}</Text>;
    $[1] = t2;
    $[2] = t3;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const t5 = isSelected && !useGreyPointer ? "suggestion" : undefined;
  let t6;
  if ($[4] !== item.task || $[5] !== item.type || $[6] !== maxActivityWidth) {
    t6 = item.type === "leader" ? <Text>@{TEAM_LEAD_NAME}</Text> : <BackgroundTaskComponent task={item.task} maxActivityWidth={maxActivityWidth} />;
    $[4] = item.task;
    $[5] = item.type;
    $[6] = maxActivityWidth;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  let t7;
  if ($[8] !== t5 || $[9] !== t6) {
    t7 = <Text color={t5}>{t6}</Text>;
    $[8] = t5;
    $[9] = t6;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== t4 || $[12] !== t7) {
    t8 = <Box flexDirection="row">{t4}{t7}</Box>;
    $[11] = t4;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
// TeammateTaskGroups：把队友按 teamName 分组展示，leader 条目在每个组头重复出现（key 带 teamName 后缀避免重复）。
function TeammateTaskGroups(t0) {
  const $ = _c(3);
  const {
    teammateTasks,
    currentSelectionId
  } = t0;
  let t1;
  if ($[0] !== currentSelectionId || $[1] !== teammateTasks) {
    const leaderItems = teammateTasks.filter(_temp);
// 分组逻辑：leader 条目单列（type 等于 leader 的谓词在 _temp），其余按 identity.teamName 进 Map，再展开成组数组。成员数 = 组员 + leader（每个组都算上队长）。
    const teammateItems = teammateTasks.filter(_temp2);
    const teams = new Map();
    for (const item of teammateItems) {
      const teamName = item.task.identity.teamName;
      const group = teams.get(teamName);
      if (group) {
        group.push(item);
      } else {
        teams.set(teamName, [item]);
      }
    }
    const teamEntries = [...teams.entries()];
    t1 = <>{teamEntries.map(t2 => {
        const [teamName_0, items] = t2;
        const memberCount = items.length + leaderItems.length;
        return <Box key={teamName_0} flexDirection="column"><Text dimColor={true}>{"  "}Team: {teamName_0} ({memberCount})</Text>{leaderItems.map(item_0 => <Item key={`${item_0.id}-${teamName_0}`} item={item_0} isSelected={item_0.id === currentSelectionId} />)}{items.map(item_1 => <Item key={item_1.id} item={item_1} isSelected={item_1.id === currentSelectionId} />)}</Box>;
      })}</>;
    $[0] = currentSelectionId;
    $[1] = teammateTasks;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
function _temp2(i_0) {
  return i_0.type === "in_process_teammate";
}
function _temp(i) {
  return i.type === "leader";
}
// 原文件此处有一行 86912 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。