// 本文件是终端转圈器家族：四种形态共用一套「动词加省略号加动画」的表达。SpinnerWithVerb 是主形态（分流到 brief 版或完整版），完整版负责选动词、算提示、拼状态行并把动画帧委托给子组件；BriefSpinner 是简报模式的单行版（带断线提示与后台计数）；BriefIdleStatus 是简报模式的空闲占位；Spinner 是最小的单字符圆点，供小面板内联使用。
import { c as _c } from "react/compiler-runtime";
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { Box, Text } from '../ink.js';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeGlimmerIndex, computeShimmerSegments, SHIMMER_INTERVAL_MS } from '../bridge/bridgeStatusUtil.js';
import { feature } from 'bun:bundle';
import { getKairosActive, getUserMsgOptIn } from '../bootstrap/state.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { count } from '../utils/array.js';
import sample from 'lodash-es/sample.js';
import { formatDuration, formatNumber, formatSecondsShort } from '../utils/format.js';
import type { Theme } from 'src/utils/theme.js';
import { activityManager } from '../utils/activityManager.js';
import { getSpinnerVerbs } from '../constants/spinnerVerbs.js';
import { MessageResponse } from './MessageResponse.js';
import { TaskListV2 } from './TaskListV2.js';
import { useTasksV2 } from '../hooks/useTasksV2.js';
import type { Task } from '../utils/tasks.js';
import { useAppState } from '../state/AppState.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { getDefaultCharacters, type SpinnerMode } from './Spinner/index.js';
import { SpinnerAnimationRow } from './Spinner/SpinnerAnimationRow.js';
import { useSettings } from '../hooks/useSettings.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { isBackgroundTask } from '../tasks/types.js';
import { getAllInProcessTeammateTasks } from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import { getEffortSuffix } from '../utils/effort.js';
import { getMainLoopModel } from '../utils/model/model.js';
import { getViewedTeammateTask } from '../state/selectors.js';
import { TEARDROP_ASTERISK } from '../constants/figures.js';
import figures from 'figures';
import { getCurrentTurnTokenBudget, getTurnOutputTokens } from '../bootstrap/state.js';
import { TeammateSpinnerTree } from './Spinner/TeammateSpinnerTree.js';
import { useAnimationFrame } from '../ink.js';
import { getGlobalConfig } from '../utils/config.js';
// 把 Spinner 模式类型原样再导出，调用方不必知道定义在 Spinner 子目录里。
export type { SpinnerMode } from './Spinner/index.js';
// 帧序列取「正序加逆序拼接」形成回文，动画到末尾自然折返——不需要在渲染里判断方向。
const DEFAULT_CHARACTERS = getDefaultCharacters();
const SPINNER_FRAMES = [...DEFAULT_CHARACTERS, ...[...DEFAULT_CHARACTERS].reverse()];
// Props 全是引用或标量：三个计时 ref（开始时间、累计暂停、暂停起点）、两个颜色覆盖、消息与后缀覆盖，加上 verbose 与两个状态标志。引用而非值，是为让子组件在动画帧里读最新值而不触发父组件重渲染。
type Props = {
  mode: SpinnerMode;
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
  pauseStartTimeRef: React.RefObject<number | null>;
  spinnerTip?: string;
  responseLengthRef: React.RefObject<number>;
  overrideColor?: keyof Theme | null;
  overrideShimmerColor?: keyof Theme | null;
  overrideMessage?: string | null;
  spinnerSuffix?: string | null;
  verbose: boolean;
  hasActiveTools?: boolean;
  /** Leader's turn has completed (no active query). Used to suppress stall-red spinner when only teammates are running. */
  leaderIsIdle?: boolean;
};

// Thin wrapper: branches on isBriefOnly so the two variants have independent
// hook call chains. Without this split, toggling /brief mid-render would
// violate Rules of Hooks (the inner variant calls ~10 more hooks).
// 分流外壳：只读两个状态就决定走简报版还是完整版。这样拆成两个组件而非在内部加 if，是因为简报版少调约十个钩子——同一组件内条件调用会违反 hooks 规则。
export function SpinnerWithVerb(props: Props): React.ReactNode {
// isBriefOnly 来自 AppState；REPL 在看队友转录时会把它覆盖成 false。
  const isBriefOnly = useAppState(s => s.isBriefOnly);
  // REPL overrides isBriefOnly→false when viewing a teammate transcript
  // (see isBriefOnly={viewedTeammateTask ? false : isBriefOnly}). That
  // prop isn't threaded here, so replicate the gate from the store —
  // teammate view needs the real spinner (which shows teammate status).
// viewingAgentTaskId 用来复刻 REPL 里那个门控：看队友时必须显示真转圈器（要展示队友状态），所以简报分支还要求没有正在查看的代理任务。
  const viewingAgentTaskId = useAppState(s_0 => s_0.viewingAgentTaskId);
// 环境开关提到挂载时算一次：本组件按动画帧率重渲染（其实现在已下沉到子组件，但这里仍按高频组件对待），不该每次读环境变量。
  // Hoisted to mount-time — this component re-renders at animation framerate.
  const briefEnvEnabled = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_BRIEF), []) : false;

  // Runtime gate mirrors isBriefEnabled() but inlined — importing from
  // BriefTool.ts would leak tool-name strings into external builds. Single
  // spinner instance → hooks stay unconditional (two subs, negligible).
// 简报分支的完整门控：功能开关打开、且（Kairos 激活或用户主动开启且环境或实验开关允许）、且当前是简报模式、且没有在看某个代理任务。运行时门控刻意内联而不是从简报工具导入——导入会把工具名字符串带进外部构建。
  if ((feature('KAIROS') || feature('KAIROS_BRIEF')) && (getKairosActive() || getUserMsgOptIn() && (briefEnvEnabled || getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_brief', false))) && isBriefOnly && !viewingAgentTaskId) {
    return <BriefSpinner mode={props.mode} overrideMessage={props.overrideMessage} />;
  }
  return <SpinnerWithVerbInner {...props} />;
}
// 完整版：本组件已不在 50 毫秒时钟上（动画在 SpinnerAnimationRow 里），只随 props 与应用状态变化重渲染，因此所有时间派生值都由子组件计算。
function SpinnerWithVerbInner({
  mode,
  loadingStartTimeRef,
  totalPausedMsRef,
  pauseStartTimeRef,
  spinnerTip,
  responseLengthRef,
  overrideColor,
  overrideShimmerColor,
  overrideMessage,
  spinnerSuffix,
  verbose,
  hasActiveTools = false,
  leaderIsIdle = false
}: Props): React.ReactNode {
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;

// 这条注释是重构留下的路标：动画帧、流光、停滞强度、token 计数器、思考微光、耗时计时器全部下沉到子组件，父组件只在「粗粒度状态变化」时重算提示与状态行。
  // NOTE: useAnimationFrame(50) lives in SpinnerAnimationRow, not here.
  // This component only re-renders when props or app state change —
  // it is no longer on the 50ms clock. All `time`-derived values
  // (frame, glimmer, stalled intensity, token counter, thinking shimmer,
  // elapsed-time timer) are computed inside the child.

// 五个 AppState 选择器：任务表、正在查看的代理任务、展开视图、选中的进程内代理下标、代理选择模式——分别服务队友树渲染与前台化判断。
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s_0 => s_0.viewingAgentTaskId);
  const expandedView = useAppState(s_1 => s_1.expandedView);
  const showExpandedTodos = expandedView === 'tasks';
  const showSpinnerTree = expandedView === 'teammates';
  const selectedIPAgentIndex = useAppState(s_2 => s_2.selectedIPAgentIndex);
  const viewSelectionMode = useAppState(s_3 => s_3.viewSelectionMode);
  // Get foregrounded teammate (if viewing a teammate's transcript)
// 前台队友：只有正在查看某个代理任务时才去查，用来把动词换成该队友的动词。
  const foregroundedTeammate = viewingAgentTaskId ? getViewedTeammateTask({
    viewingAgentTaskId,
    tasks
  }) : undefined;
  const {
    columns
  } = useTerminalSize();
  const tasksV2 = useTasksV2();

  // Track thinking status: 'thinking' | number (duration in ms) | null
  // Shows each state for minimum 2s to avoid UI jank
// 思考状态：三态（思考中、思考了 N 毫秒、空），设计上每态至少显示 2 秒，避免快速切换造成画面抖动。
  const [thinkingStatus, setThinkingStatus] = useState<'thinking' | number | null>(null);
  const thinkingStartRef = useRef<number | null>(null);
// 思考计时 effect：进入 thinking 记起点；离开时算时长，若不足 2 秒就先把「思考中」补足到 2 秒再显示时长，最后再挂 2 秒清空。三个定时器都在清理函数里取消。
  useEffect(() => {
    let showDurationTimer: ReturnType<typeof setTimeout> | null = null;
    let clearStatusTimer: ReturnType<typeof setTimeout> | null = null;
    if (mode === 'thinking') {
      // Started thinking
      if (thinkingStartRef.current === null) {
        thinkingStartRef.current = Date.now();
        setThinkingStatus('thinking');
      }
    } else if (thinkingStartRef.current !== null) {
      // Stopped thinking - calculate duration and ensure 2s minimum display
      const duration = Date.now() - thinkingStartRef.current;
      const elapsed = Date.now() - thinkingStartRef.current;
      const remainingThinkingTime = Math.max(0, 2000 - elapsed);
      thinkingStartRef.current = null;

      // Show "thinking..." for remaining time if < 2s elapsed, then show duration
      const showDuration = (): void => {
        setThinkingStatus(duration);
        // Clear after 2s
        clearStatusTimer = setTimeout(setThinkingStatus, 2000, null);
      };
      if (remainingThinkingTime > 0) {
        showDurationTimer = setTimeout(showDuration, remainingThinkingTime);
      } else {
        showDuration();
      }
    }
    return () => {
      if (showDurationTimer) clearTimeout(showDurationTimer);
      if (clearStatusTimer) clearTimeout(clearStatusTimer);
    };
  }, [mode]);

// 取当前进行中的任务与下一个待办：进行中指既非 pending 也非 completed；下一个待办由文件尾的 findNextPendingTask 按阻塞关系挑。
  // Find the current in-progress task and next pending task
  const currentTodo = tasksV2?.find(task => task.status !== 'pending' && task.status !== 'completed');
  const nextTask = findNextPendingTask(tasksV2);

  // Use useState with initializer to pick a random verb once on mount
// 随机动词只在挂载时抽一次（useState 的惰性初始化），避免每帧都换词。
  const [randomVerb] = useState(() => sample(getSpinnerVerbs()));

  // Leader's own verb (always the leader's, regardless of who is foregrounded)
// 动词优先级三层：显式覆盖消息、当前任务的进行时描述或标题、随机动词。若正在看某个未空闲队友，则改用该队友自己的动词——看谁就显示谁在干什么。
  const leaderVerb = overrideMessage ?? currentTodo?.activeForm ?? currentTodo?.subject ?? randomVerb;
  const effectiveVerb = foregroundedTeammate && !foregroundedTeammate.isIdle ? foregroundedTeammate.spinnerVerb ?? randomVerb : leaderVerb;
  const message = effectiveVerb + '…';

  // Track CLI activity when spinner is active
// 把转圈器登记为一项 CLI 活动（按模式区分操作 id），卸载时注销——空闲检测与状态栏都靠这个活动表。
  useEffect(() => {
    const operationId = 'spinner-' + mode;
    activityManager.startCLIActivity(operationId);
    return () => {
      activityManager.endCLIActivity(operationId);
    };
  }, [mode]);
  const effortValue = useAppState(s_4 => s_4.effortValue);
  const effortSuffix = getEffortSuffix(getMainLoopModel(), effortValue);

// 进程内队友的运行态聚合：runningTeammates 与 allIdle 同时服务「领导空闲」与「队友树」两处判断。
  // Check if any running in-process teammates exist (needed for both modes)
  const runningTeammates = getAllInProcessTeammateTasks(tasks).filter(t => t.status === 'running');
  const hasRunningTeammates = runningTeammates.length > 0;
  const allIdle = hasRunningTeammates && runningTeammates.every(t_0 => t_0.isIdle);

  // Gather aggregate token stats from all running swarm teammates
  // In spinner-tree mode, skip aggregation (teammates have their own lines in the tree)
// 队友 token 汇总：树形视图下跳过聚合（队友在树里各有自己的行，再汇总会重复计数）。
  let teammateTokens = 0;
  if (!showSpinnerTree) {
    for (const task_0 of Object.values(tasks)) {
      if (isInProcessTeammateTask(task_0) && task_0.status === 'running') {
        if (task_0.progress?.tokenCount) {
          teammateTokens += task_0.progress.tokenCount;
        }
      }
    }
  }

  // Stale read of the refs for showBtwTip below — we're off the 50ms clock
  // so this only updates when props/app state change, which is sufficient for
  // a coarse 30s threshold.
// 耗时快照：暂停中就只算到暂停起点，否则算到当前时刻；扣除累计暂停时长。这是粗读（本组件不在帧时钟上），只用于 30 秒与 30 分钟两个粗阈值判断。
  const elapsedSnapshot = pauseStartTimeRef.current !== null ? pauseStartTimeRef.current - loadingStartTimeRef.current - totalPausedMsRef.current : Date.now() - loadingStartTimeRef.current - totalPausedMsRef.current;

  // Leader token count for TeammateSpinnerTree — read raw (non-animated) from
  // the ref. The tree is only shown when teammates are running; teammate
  // progress updates to s.tasks trigger re-renders that keep this fresh.
  const leaderTokenCount = Math.round(responseLengthRef.current / 4);
  const defaultColor: keyof Theme = 'claude';
  const defaultShimmerColor = 'claudeShimmer';
  const messageColor = overrideColor ?? defaultColor;
  const shimmerColor = overrideShimmerColor ?? defaultShimmerColor;

  // Compute TTFT string here (off the 50ms animation clock) and pass to
  // SpinnerAnimationRow so it folds into the `(thought for Ns · ...)` status
  // line instead of taking a separate row. apiMetricsRef is a ref so this
  // doesn't trigger re-renders; we pick up updates on the parent's ~25x/turn
  // re-render cadence, same as the old ApiMetricsLine did.
// 首 token 时延文案在父层算好传下去，让子组件把它折进状态行而不是单占一行；指标引用是 ref，读取不触发重渲染。
  let ttftText: string | null = null;
  if ("external" === 'ant' && apiMetricsRef?.current && apiMetricsRef.current.length > 0) {
    ttftText = computeTtftText(apiMetricsRef.current);
  }

  // When leader is idle but teammates are running (and we're viewing the leader),
  // show a static dim idle display instead of the animated spinner — otherwise
  // useStalledAnimation detects no new tokens after 3s and turns the spinner red.
// 领导空闲但队友在跑：显示静止的暗色空闲行而不是动画转圈。否则停滞检测会在 3 秒无新 token 后把转圈染红，误导用户以为卡住了。
  if (leaderIsIdle && hasRunningTeammates && !foregroundedTeammate) {
    return <Box flexDirection="column" width="100%" alignItems="flex-start">
        <Box flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
          <Text dimColor>
            {TEARDROP_ASTERISK} Idle
            {!allIdle && ' · teammates running'}
          </Text>
        </Box>
        {showSpinnerTree && <TeammateSpinnerTree selectedIndex={selectedIPAgentIndex} isInSelectionMode={viewSelectionMode === 'selecting-agent'} allIdle={allIdle} leaderTokenCount={leaderTokenCount} leaderIdleText="Idle" />}
      </Box>;
  }

  // When viewing an idle teammate, show static idle display instead of animated spinner
// 正在看一个空闲队友：同样显示静止行，文案区分「全部队友都空闲（显示总工时）」与「这个队友空闲」。
  if (foregroundedTeammate?.isIdle) {
    const idleText = allIdle ? `${TEARDROP_ASTERISK} Worked for ${formatDuration(Date.now() - foregroundedTeammate.startTime)}` : `${TEARDROP_ASTERISK} Idle`;
    return <Box flexDirection="column" width="100%" alignItems="flex-start">
        <Box flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
          <Text dimColor>{idleText}</Text>
        </Box>
        {showSpinnerTree && hasRunningTeammates && <TeammateSpinnerTree selectedIndex={selectedIPAgentIndex} isInSelectionMode={viewSelectionMode === 'selecting-agent'} allIdle={allIdle} leaderVerb={leaderIsIdle ? undefined : leaderVerb} leaderIdleText={leaderIsIdle ? 'Idle' : undefined} leaderTokenCount={leaderTokenCount} />}
      </Box>;
  }

  // Time-based tip overrides: coarse thresholds so a stale ref read (we're
  // off the 50ms clock) is fine. Other triggers (mode change, setMessages)
  // cause re-renders that refresh this in practice.
  let contextTipsActive = false;
// 提示的粗阈值：启用提示后，超过 30 分钟提示用清理命令换话题，超过 30 秒且没用过侧问功能时提示侧问；两者都只在没有下一个待办时出现，有下一步就优先显示下一步。
  const tipsEnabled = settings.spinnerTipsEnabled !== false;
  const showClearTip = tipsEnabled && elapsedSnapshot > 1_800_000;
  const showBtwTip = tipsEnabled && elapsedSnapshot > 30_000 && !getGlobalConfig().btwUseCount;
  const effectiveTip = contextTipsActive ? undefined : showClearTip && !nextTask ? 'Use /clear to start fresh when switching topics and free up context' : showBtwTip && !nextTask ? "Use /btw to ask a quick side question without interrupting Claude's current work" : spinnerTip;

  // Budget text (ant-only) — shown above the tip line
// token 预算文案（内部特性）：超出目标显示已用与最小值，未超出显示百分比与按当前速率估算的剩余时长。
  let budgetText: string | null = null;
  if (feature('TOKEN_BUDGET')) {
    const budget = getCurrentTurnTokenBudget();
    if (budget !== null && budget > 0) {
      const tokens = getTurnOutputTokens();
      if (tokens >= budget) {
        budgetText = `Target: ${formatNumber(tokens)} used (${formatNumber(budget)} min ${figures.tick})`;
      } else {
        const pct = Math.round(tokens / budget * 100);
        const remaining = budget - tokens;
        const rate = elapsedSnapshot > 5000 && tokens >= 2000 ? tokens / elapsedSnapshot : 0;
        const eta = rate > 0 ? ` \u00B7 ~${formatDuration(remaining / rate, {
          mostSignificantOnly: true
        })}` : '';
        budgetText = `Target: ${formatNumber(tokens)} / ${formatNumber(budget)} (${pct}%)${eta}`;
      }
    }
  }
// 主渲染：状态行一行，下面是三选一——队友树（有运行中队友且处于树视图）、展开的待办列表、或提示行；都没有就返回空。提示行的容器必须写满宽度，否则终端极窄时 Ink 会把提示重复刷屏。
  return <Box flexDirection="column" width="100%" alignItems="flex-start">
      <SpinnerAnimationRow mode={mode} reducedMotion={reducedMotion} hasActiveTools={hasActiveTools} responseLengthRef={responseLengthRef} message={message} messageColor={messageColor} shimmerColor={shimmerColor} overrideColor={overrideColor} loadingStartTimeRef={loadingStartTimeRef} totalPausedMsRef={totalPausedMsRef} pauseStartTimeRef={pauseStartTimeRef} spinnerSuffix={spinnerSuffix} verbose={verbose} columns={columns} hasRunningTeammates={hasRunningTeammates} teammateTokens={teammateTokens} foregroundedTeammate={foregroundedTeammate} leaderIsIdle={leaderIsIdle} thinkingStatus={thinkingStatus} effortSuffix={effortSuffix} />
      {showSpinnerTree && hasRunningTeammates ? <TeammateSpinnerTree selectedIndex={selectedIPAgentIndex} isInSelectionMode={viewSelectionMode === 'selecting-agent'} allIdle={allIdle} leaderVerb={leaderIsIdle ? undefined : leaderVerb} leaderIdleText={leaderIsIdle ? 'Idle' : undefined} leaderTokenCount={leaderTokenCount} /> : showExpandedTodos && tasksV2 && tasksV2.length > 0 ? <Box width="100%" flexDirection="column">
          <MessageResponse>
            <TaskListV2 tasks={tasksV2} />
          </MessageResponse>
        </Box> : nextTask || effectiveTip || budgetText ?
    // IMPORTANT: we need this width="100%" to avoid an Ink bug where the
    // tip gets duplicated over and over while the spinner is running if
    // the terminal is very small. TODO: fix this in Ink.
    <Box width="100%" flexDirection="column">
          {budgetText && <MessageResponse>
              <Text dimColor>{budgetText}</Text>
            </MessageResponse>}
          {(nextTask || effectiveTip) && <MessageResponse>
              <Text dimColor>
                {nextTask ? `Next: ${nextTask.subject}` : `Tip: ${effectiveTip}`}
              </Text>
            </MessageResponse>}
        </Box> : null}
    </Box>;
}

// Brief/assistant mode spinner: single status line. PromptInput drops its
// own marginTop when isBriefOnly is active, so this component owns the
// 2-row footprint between messages and input. Footprint is [blank, content]
// — one blank row above (breathing room under the messages list), spinner
// flush against the input bar. PromptInput's absolute-positioned
// Notifications overlay compensates with marginTop=-2 in brief mode
// (PromptInput.tsx:~2928) so it floats into the blank row above the
// spinner, not over the spinner content. Paired with BriefIdleStatus which
// keeps the same footprint when idle.
type BriefSpinnerProps = {
  mode: SpinnerMode;
  overrideMessage?: string | null;
};
// 简报版转圈器：单行状态（动词加断点动画或断线文案，右侧可带后台任务计数）。占位是两行「空行加内容」，与空闲态占位一致，切换时输入条不跳动。
function BriefSpinner(t0) {
  const $ = _c(31);
  const {
    mode,
    overrideMessage
  } = t0;
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const [randomVerb] = useState(_temp4);
  const verb = overrideMessage ?? randomVerb;
  const connStatus = useAppState(_temp5);
  let t1;
  let t2;
  if ($[0] !== mode) {
    t1 = () => {
      const operationId = "spinner-" + mode;
      activityManager.startCLIActivity(operationId);
      return () => {
        activityManager.endCLIActivity(operationId);
      };
    };
    t2 = [mode];
    $[0] = mode;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
// 动画帧：减少动效时传 null 关闭帧循环；正常按 120 毫秒推进。
  useEffect(t1, t2);
  const [, time] = useAnimationFrame(reducedMotion ? null : 120);
  const runningCount = useAppState(_temp6);
  const showConnWarning = connStatus === "reconnecting" || connStatus === "disconnected";
  const connText = connStatus === "reconnecting" ? "Reconnecting" : "Disconnected";
  const dotFrame = Math.floor(time / 300) % 3;
  let t3;
  if ($[3] !== dotFrame || $[4] !== reducedMotion) {
    t3 = reducedMotion ? "\u2026  " : ".".repeat(dotFrame + 1).padEnd(3);
    $[3] = dotFrame;
    $[4] = reducedMotion;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const dots = t3;
  let t4;
  if ($[6] !== verb) {
    t4 = stringWidth(verb);
    $[6] = verb;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const verbWidth = t4;
  let t5;
// 流光切段：断线或减少动效时把索引压到 -100（等价于不亮），否则按时间算流光位置再切成「前段、亮段、后段」三段分别着色。
  if ($[8] !== reducedMotion || $[9] !== showConnWarning || $[10] !== time || $[11] !== verb || $[12] !== verbWidth) {
    const glimmerIndex = reducedMotion || showConnWarning ? -100 : computeGlimmerIndex(Math.floor(time / SHIMMER_INTERVAL_MS), verbWidth);
    t5 = computeShimmerSegments(verb, glimmerIndex);
    $[8] = reducedMotion;
    $[9] = showConnWarning;
    $[10] = time;
    $[11] = verb;
    $[12] = verbWidth;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const {
    before,
    shimmer,
    after
  } = t5;
  const {
    columns
  } = useTerminalSize();
// 右侧文案与填充：有后台任务时显示计数；填充宽度等于终端宽减两侧留白与左右文本宽度，至少留 1 格。
  const rightText = runningCount > 0 ? `${runningCount} in background` : "";
  let t6;
  if ($[14] !== connText || $[15] !== showConnWarning || $[16] !== verbWidth) {
    t6 = showConnWarning ? stringWidth(connText) : verbWidth;
    $[14] = connText;
    $[15] = showConnWarning;
    $[16] = verbWidth;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  const leftWidth = t6 + 3;
  const pad = Math.max(1, columns - 2 - leftWidth - stringWidth(rightText));
  let t7;
  if ($[18] !== after || $[19] !== before || $[20] !== connText || $[21] !== dots || $[22] !== shimmer || $[23] !== showConnWarning) {
    t7 = showConnWarning ? <Text color="error">{connText + dots}</Text> : <>{before ? <Text dimColor={true}>{before}</Text> : null}{shimmer ? <Text>{shimmer}</Text> : null}{after ? <Text dimColor={true}>{after}</Text> : null}<Text dimColor={true}>{dots}</Text></>;
    $[18] = after;
    $[19] = before;
    $[20] = connText;
    $[21] = dots;
    $[22] = shimmer;
    $[23] = showConnWarning;
    $[24] = t7;
  } else {
    t7 = $[24];
  }
  let t8;
  if ($[25] !== pad || $[26] !== rightText) {
    t8 = rightText ? <><Text>{" ".repeat(pad)}</Text><Text color="subtle">{rightText}</Text></> : null;
    $[25] = pad;
    $[26] = rightText;
    $[27] = t8;
  } else {
    t8 = $[27];
  }
  let t9;
  if ($[28] !== t7 || $[29] !== t8) {
    t9 = <Box flexDirection="row" width="100%" marginTop={1} paddingLeft={2}>{t7}{t8}</Box>;
    $[28] = t7;
    $[29] = t8;
    $[30] = t9;
  } else {
    t9 = $[30];
  }
  return t9;
}

// Idle placeholder for brief mode. Same 2-row [blank, content] footprint
// as BriefSpinner so the input bar never jumps when toggling between
// working/idle/disconnected. See BriefSpinner's comment for the
// Notifications overlay coupling.
function _temp6(s_0) {
  return count(Object.values(s_0.tasks), isBackgroundTask) + s_0.remoteBackgroundTaskCount;
}
function _temp5(s) {
  return s.remoteConnectionStatus;
}
function _temp4() {
  return sample(getSpinnerVerbs()) ?? "Working";
}
// 简报模式的空闲占位：与简报转圈器同样两行占位；左侧只在断线时出现，右侧在有后台任务时出现，两者都空就返回一个固定两行高的空盒。
export function BriefIdleStatus() {
  const $ = _c(9);
  const connStatus = useAppState(_temp7);
  const runningCount = useAppState(_temp8);
  const {
    columns
  } = useTerminalSize();
  const showConnWarning = connStatus === "reconnecting" || connStatus === "disconnected";
  const connText = connStatus === "reconnecting" ? "Reconnecting\u2026" : "Disconnected";
  const leftText = showConnWarning ? connText : "";
  const rightText = runningCount > 0 ? `${runningCount} in background` : "";
  if (!leftText && !rightText) {
    let t0;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t0 = <Box height={2} />;
      $[0] = t0;
    } else {
      t0 = $[0];
    }
    return t0;
  }
  const pad = Math.max(1, columns - 2 - stringWidth(leftText) - stringWidth(rightText));
  let t0;
  if ($[1] !== leftText) {
    t0 = leftText ? <Text color="error">{leftText}</Text> : null;
    $[1] = leftText;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  let t1;
  if ($[3] !== pad || $[4] !== rightText) {
    t1 = rightText ? <><Text>{" ".repeat(pad)}</Text><Text color="subtle">{rightText}</Text></> : null;
    $[3] = pad;
    $[4] = rightText;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  let t2;
  if ($[6] !== t0 || $[7] !== t1) {
    t2 = <Box marginTop={1} paddingLeft={2}><Text>{t0}{t1}</Text></Box>;
    $[6] = t0;
    $[7] = t1;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  return t2;
}
function _temp8(s_0) {
  return count(Object.values(s_0.tasks), isBackgroundTask) + s_0.remoteBackgroundTaskCount;
}
function _temp7(s) {
  return s.remoteConnectionStatus;
}
// 最小圆点转圈器：减少动效时固定一个实心点，否则按 120 毫秒在回文帧序列里取字符。宽度固定 2 格，供状态行内联使用。
export function Spinner() {
  const $ = _c(8);
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const [ref, time] = useAnimationFrame(reducedMotion ? null : 120);
  if (reducedMotion) {
    let t0;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t0 = <Text color="text">●</Text>;
      $[0] = t0;
    } else {
      t0 = $[0];
    }
    let t1;
    if ($[1] !== ref) {
      t1 = <Box ref={ref} flexWrap="wrap" height={1} width={2}>{t0}</Box>;
      $[1] = ref;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    return t1;
  }
  const frame = Math.floor(time / 120) % SPINNER_FRAMES.length;
  const t0 = SPINNER_FRAMES[frame];
  let t1;
  if ($[3] !== t0) {
    t1 = <Text color="text">{t0}</Text>;
    $[3] = t0;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  let t2;
  if ($[5] !== ref || $[6] !== t1) {
    t2 = <Box ref={ref} flexWrap="wrap" height={1} width={2}>{t1}</Box>;
    $[5] = ref;
    $[6] = t1;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
}
// 下一个待办：在所有待办里挑一个没有被未完成项阻塞的；全都阻塞就退回第一个待办（总得给用户看点什么）。
function findNextPendingTask(tasks: Task[] | undefined): Task | undefined {
  if (!tasks) {
    return undefined;
  }
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  if (pendingTasks.length === 0) {
    return undefined;
  }
  const unresolvedIds = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id));
  return pendingTasks.find(t => !t.blockedBy.some(id => unresolvedIds.has(id))) ?? pendingTasks[0];
}
// 原文件此处有一行 63744 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。