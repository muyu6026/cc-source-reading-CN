// 底部状态栏。用户在 settings 里配一条 shell 命令（例如自己写个 `~/.claude/statusline.sh`），Claude Code 就把当前会话的一整套快照喂给它、把它的 stdout 原样显示在输入框下方。所以这份文件有两个重心：**快照结构**（定义了插件能拿到什么，等于一个对外契约）与**刷新时机**（极其克制的防抖与依赖判断，因为每次刷新都要起一个子进程）。
import { feature } from 'bun:bundle';
import * as React from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js';
import { getIsRemoteMode, getKairosActive, getMainThreadAgentType, getOriginalCwd, getSdkBetas, getSessionId } from '../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from '../constants/outputStyles.js';
import { useNotifications } from '../context/notifications.js';
import { getTotalAPIDuration, getTotalCost, getTotalDuration, getTotalInputTokens, getTotalLinesAdded, getTotalLinesRemoved, getTotalOutputTokens } from '../cost-tracker.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { type ReadonlySettings, useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, Text } from '../ink.js';
import { getRawUtilization } from '../services/claudeAiLimits.js';
import type { Message } from '../types/message.js';
import type { StatusLineCommandInput } from '../types/statusLine.js';
import type { VimMode } from '../types/textInputTypes.js';
import { checkHasTrustDialogAccepted } from '../utils/config.js';
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { createBaseHookInput, executeStatusLineCommand } from '../utils/hooks.js';
import { getLastAssistantMessage } from '../utils/messages.js';
import { getRuntimeMainLoopModel, type ModelName, renderModelName } from '../utils/model/model.js';
import { getCurrentSessionTitle } from '../utils/sessionStorage.js';
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage } from '../utils/tokens.js';
import { getCurrentWorktreeSession } from '../utils/worktree.js';
import { isVimModeEnabled } from './PromptInput/utils.js';
// 是否显示状态栏只有一个判据——settings 里配了 statusLine。唯一的例外是 KAIROS（助手模式）：那种模式下本进程只是个 REPL/守护壳，模型、权限模式、cwd 全是壳的、不是子代理真实跑的东西，显示出来会误导，所以直接隐藏。
export function statusLineShouldDisplay(settings: ReadonlySettings): boolean {
  // Assistant mode: statusline fields (model, permission mode, cwd) reflect the
  // REPL/daemon process, not what the agent child is actually running. Hide it.
  if (feature('KAIROS') && getKairosActive()) return false;
  return settings?.statusLine !== undefined;
}
// 这个函数是整份文件里唯一的「对外契约」：它把散落在各处的运行时状态拼成一个纯数据对象交给子进程。注意它**不读 React 状态**，所有入参都由调用方传进来——这样它可以被单独测试，也避免了在函数内部踩到 hook 规则。
function buildStatusLineCommandInput(permissionMode: PermissionMode, exceeds200kTokens: boolean, settings: ReadonlySettings, messages: Message[], addedDirs: string[], mainLoopModel: ModelName, vimMode?: VimMode): StatusLineCommandInput {
  const agentType = getMainThreadAgentType();
  const worktreeSession = getCurrentWorktreeSession();
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens
  });
  const outputStyleName = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME;
  const currentUsage = getCurrentUsage(messages);
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas());
  const contextPercentages = calculateContextPercentages(currentUsage, contextWindowSize);
  const sessionId = getSessionId();
  const sessionName = getCurrentSessionTitle(sessionId);
  const rawUtil = getRawUtilization();
// rate_limits 用两层条件展开构造：外层只在真有五小时/七天任一窗口时才加整个字段，内层各自展开。这样最终对象里**不存在值为 undefined 的键**——因为 JSON 序列化会把 undefined 键整个丢掉，而下游脚本可能用 `「five_hour」 in data` 判断，键在但值空会导致误判。
  const rateLimits: StatusLineCommandInput['rate_limits'] = {
    ...(rawUtil.five_hour && {
      five_hour: {
        used_percentage: rawUtil.five_hour.utilization * 100,
        resets_at: rawUtil.five_hour.resets_at
      }
    }),
    ...(rawUtil.seven_day && {
      seven_day: {
        used_percentage: rawUtil.seven_day.utilization * 100,
        resets_at: rawUtil.seven_day.resets_at
      }
    })
  };
// 返回值一律用 `...(cond && { ... })` 展开，同理：可选段在不需要时**不存在**，而不是存在且为空。这份结构里有七个可选段（session_name / rate_limits / vim / agent / remote / worktree），全部遵守同一约定。
  return {
    ...createBaseHookInput(),
    ...(sessionName && {
      session_name: sessionName
    }),
    model: {
      id: runtimeModel,
      display_name: renderModelName(runtimeModel)
    },
    workspace: {
      current_dir: getCwd(),
      project_dir: getOriginalCwd(),
      added_dirs: addedDirs
    },
    version: MACRO.VERSION,
    output_style: {
      name: outputStyleName
    },
    cost: {
      total_cost_usd: getTotalCost(),
      total_duration_ms: getTotalDuration(),
      total_api_duration_ms: getTotalAPIDuration(),
      total_lines_added: getTotalLinesAdded(),
      total_lines_removed: getTotalLinesRemoved()
    },
    context_window: {
      total_input_tokens: getTotalInputTokens(),
      total_output_tokens: getTotalOutputTokens(),
      context_window_size: contextWindowSize,
      current_usage: currentUsage,
      used_percentage: contextPercentages.used,
      remaining_percentage: contextPercentages.remaining
    },
    exceeds_200k_tokens: exceeds200kTokens,
    ...((rateLimits.five_hour || rateLimits.seven_day) && {
      rate_limits: rateLimits
    }),
// vim 段只在用户开了 vim 模式时才出现，且 `mode` 兜底到 INSERT。这个兜底有实际意义：模式状态在输入框卸载的瞬间可能是 undefined，对脚本来说 undefined 不如 INSERT 有用。
    ...(isVimModeEnabled() && {
      vim: {
        mode: vimMode ?? 'INSERT'
      }
    }),
    ...(agentType && {
      agent: {
        name: agentType
      }
    }),
    ...(getIsRemoteMode() && {
      remote: {
        session_id: getSessionId()
      }
    }),
// worktree 段把五个字段全给：名字、路径、分支、原始 cwd、原始分支。这是全份结构里最「厚」的一段，因为 worktree 会话下用户最常搞混的就是「我现在到底在哪个目录、哪个分支、相对哪个基线」——状态栏是唯一能常驻提示的地方。
    ...(worktreeSession && {
      worktree: {
        name: worktreeSession.worktreeName,
        path: worktreeSession.worktreePath,
        branch: worktreeSession.worktreeBranch,
        original_cwd: worktreeSession.originalCwd,
        original_branch: worktreeSession.originalBranch
      }
    })
  };
}
// messages 走 ref、只有 lastAssistantMessageId 是真正的重渲染触发源。这两个字段是配套的：ref 保证回调里能读到最新消息列表，id 保证「消息没变就不重渲染」。若把 messages 直接当 prop，每来一条流式片段都会重渲染一次状态栏。
type Props = {
  // messages stays behind a ref (read only in the debounced callback);
  // lastAssistantMessageId is the actual re-render trigger.
  messagesRef: React.RefObject<Message[]>;
  lastAssistantMessageId: string | null;
  vimMode?: VimMode;
};
export function getLastAssistantMessageId(messages: Message[]): string | null {
  return getLastAssistantMessage(messages)?.uuid ?? null;
}
function StatusLineInner({
  messagesRef,
  lastAssistantMessageId,
  vimMode
}: Props): React.ReactNode {
// 组件内部有六个 ref 加两个「历史状态」ref，看着很重，但分工明确：`abortControllerRef` 管取消、`debounceTimerRef` 管防抖、`logNextResultRef` 管「这次要不要打日志」、`previousStateRef` 管「哪些输入真的变了」。这是「回调要稳定、但要用最新值」的标准解法——把最新值塞进 ref，回调依赖数组就能保持为空。
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const additionalWorkingDirectories = useAppState(s => s.toolPermissionContext.additionalWorkingDirectories);
  const statusLineText = useAppState(s => s.statusLineText);
  const setAppState = useSetAppState();
  const settings = useSettings();
  const {
    addNotification
  } = useNotifications();
// 这段注释记录了一个真实修过的 bug（issue 37596）：模型名必须从 AppState 取，不能调 `getMainLoopModel()`。后者每次都重读 settings.json，于是**另一个会话里执行 /model** 写盘之后，本会话的状态栏会跟着变——明明这个会话没换模型。凡是「显示当前会话状态」的地方，都不能读全局可变配置。
  // AppState-sourced model — same source as API requests. getMainLoopModel()
  // re-reads settings.json on every call, so another session's /model write
  // would leak into this session's statusline (anthropics/claude-code#37596).
  const mainLoopModel = useMainLoopModel();

  // Keep latest values in refs for stable callback access
// 五个 ref 在每次渲染时**直接赋值**（不是放 effect 里）。这是有意的：渲染期同步赋值能保证在任何事件回调（防抖到期、子进程返回）里读到的都是本次渲染的值；放 effect 里会晚一帧，状态栏就会显示上一轮的模型或权限模式。
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const vimModeRef = useRef(vimMode);
  vimModeRef.current = vimMode;
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const addedDirsRef = useRef(additionalWorkingDirectories);
  addedDirsRef.current = additionalWorkingDirectories;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;

  // Track previous state to detect changes and cache expensive calculations
// previousStateRef 专门记「上一次真正用于计算的输入」。注意它初始化时就带着当前值（permissionMode / vimMode / mainLoopModel），这样挂载后的第一次 effect 不会因为「初始值不等于 undefined」而误触发一次多余刷新。
  const previousStateRef = useRef<{
    messageId: string | null;
    exceeds200kTokens: boolean;
    permissionMode: PermissionMode;
    vimMode: VimMode | undefined;
    mainLoopModel: ModelName;
  }>({
    messageId: null,
    exceeds200kTokens: false,
    permissionMode,
    vimMode,
    mainLoopModel
  });

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // True when the next invocation should log its result (first run or after settings reload)
  const logNextResultRef = useRef(true);

  // Stable update function — reads latest values from refs
// doUpdate 是唯一真正干活的地方，依赖数组只有 `[messagesRef, setAppState]`，两个都是稳定引用——所以这个回调**永不重建**。这是它被 setTimeout 记住、被各处调用的前提。
  const doUpdate = useCallback(async () => {
    // Cancel any in-flight requests
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const msgs = messagesRef.current;
    const logResult = logNextResultRef.current;
    logNextResultRef.current = false;
    try {
      let exceeds200kTokens = previousStateRef.current.exceeds200kTokens;

      // Only recalculate 200k check if messages changed
// `doesMostRecentAssistantMessageExceed200k` 只在**最后一条助手消息的 id 变了**时才重算。这个函数要遍历消息、累加 token，属于 O(n) 的活；而状态栏的刷新触发点比消息变更频繁得多（权限模式、vim 模式、模型都会触发）。按 id 判断等于给它加了一层记忆。
      const currentMessageId = getLastAssistantMessageId(msgs);
      if (currentMessageId !== previousStateRef.current.messageId) {
        exceeds200kTokens = doesMostRecentAssistantMessageExceed200k(msgs);
        previousStateRef.current.messageId = currentMessageId;
        previousStateRef.current.exceeds200kTokens = exceeds200kTokens;
      }
      const statusInput = buildStatusLineCommandInput(permissionModeRef.current, exceeds200kTokens, settingsRef.current, msgs, Array.from(addedDirsRef.current.keys()), mainLoopModelRef.current, vimModeRef.current);
// 真正跑子进程。`logResult` 只在首跑或设置热重载后为真——因为执行命令会把完整快照写进调试日志，若每次都打，一次会话里几百条几乎相同的 JSON 会把日志淹掉。
      const text = await executeStatusLineCommand(statusInput, controller.signal, undefined, logResult);
      if (!controller.signal.aborted) {
// 回写前先比一次值：`if (prev.statusLineText === text) return prev`。返回同一个对象引用，React 会直接跳过这次更新。这对状态栏尤其重要——它每 300ms 防抖后都可能返回**一模一样的文本**（比如显示的是分支名，没切分支），不比较就会白白重渲染整条底栏。
        setAppState(prev => {
          if (prev.statusLineText === text) return prev;
          return {
            ...prev,
            statusLineText: text
          };
        });
      }
    } catch {
      // Silently ignore errors in status line updates
    }
  }, [messagesRef, setAppState]);

  // Stable debounced schedule function — no deps, uses refs
// 防抖 300ms，且把 `debounceTimerRef` 与 `doUpdate` 一起传给 setTimeout 作为额外参数。这个写法有点绕（正常是闭包里直接用），好处是 `scheduleUpdate` 的依赖数组里可以只写 `doUpdate`，不必引用 timer ref——少一个依赖就少一次重建。
  const scheduleUpdate = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout((ref, doUpdate) => {
      ref.current = undefined;
      void doUpdate();
    }, 300, debounceTimerRef, doUpdate);
  }, [doUpdate]);

  // Only trigger update when assistant message, permission mode, vim mode, or model actually changes
// 触发条件写成一个显式的四元比较：消息 id、权限模式、vim 模式、模型。**没有**把 cwd、目录列表、设置对象放进来，因为那些变动不频繁、且大多伴随上面四项之一变化。注释里还特别说明「不要在这里更新 messageId」——留给 doUpdate 更新，才能保证 exceeds200k 用的是最新消息重算的。
  useEffect(() => {
    if (lastAssistantMessageId !== previousStateRef.current.messageId || permissionMode !== previousStateRef.current.permissionMode || vimMode !== previousStateRef.current.vimMode || mainLoopModel !== previousStateRef.current.mainLoopModel) {
      // Don't update messageId here — let doUpdate handle it so
      // exceeds200kTokens is recalculated with the latest messages
      previousStateRef.current.permissionMode = permissionMode;
      previousStateRef.current.vimMode = vimMode;
      previousStateRef.current.mainLoopModel = mainLoopModel;
      scheduleUpdate();
    }
  }, [lastAssistantMessageId, permissionMode, vimMode, mainLoopModel, scheduleUpdate]);

  // When the statusLine command changes (hot reload), log the next result
  const statusLineCommand = settings?.statusLine?.command;
  const isFirstSettingsRender = useRef(true);
// 设置热重载：当 statusLine.command 变了（用户改了配置），强制下一次打日志并立刻刷新。第一次渲染要跳过（`isFirstSettingsRender`），否则挂载瞬间会多跑一次子进程——而挂载时的刷新已经在下面那个 effect 里做了。
  useEffect(() => {
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false;
      return;
    }
    logNextResultRef.current = true;
    void doUpdate();
  }, [statusLineCommand, doUpdate]);

  // Separate effect for logging on mount
  useEffect(() => {
    const statusLine = settings?.statusLine;
    if (statusLine) {
      logEvent('tengu_status_line_mount', {
        command_length: statusLine.command.length,
        padding: statusLine.padding
      });
      // Log if status line is configured but disabled by disableAllHooks
      if (settings.disableAllHooks === true) {
        logForDebugging('Status line is configured but disableAllHooks is true', {
          level: 'warn'
        });
      }
      // executeStatusLineCommand (hooks.ts) returns undefined when trust is
      // blocked — statusLineText stays undefined forever, user sees nothing,
      // and tengu_status_line_mount above fires anyway so telemetry looks fine.
// 这段是「静默失败」的补丁。`executeStatusLineCommand` 在**工作区信任未被接受**时返回 undefined，于是 statusLineText 永远是 undefined、用户什么都看不到；而上面的 mount 遥测照样上报，从数据上看一切正常。所以这里额外查一次信任状态并弹一条低优先级通知，把「什么都没有」变成「有一行提示」。
      if (!checkHasTrustDialogAccepted()) {
        addNotification({
          key: 'statusline-trust-blocked',
          text: 'statusline skipped · restart to fix',
          color: 'warning',
          priority: 'low'
        });
        logForDebugging('Status line command skipped: workspace trust not accepted', {
          level: 'warn'
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount - settings stable for initial logging

  // Initial update on mount + cleanup on unmount
  useEffect(() => {
    void doUpdate();
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount, not when doUpdate changes

  // Get padding from settings or default to 0
  const paddingX = settings?.statusLine?.padding ?? 0;

  // StatusLine must have stable height in fullscreen — the footer is
  // flexShrink:0 so a 0→1 row change when the command finishes steals
  // a row from ScrollBox and shifts content. Reserve the row while loading
  // (same trick as PromptInputFooterLeftSide).
// 全屏模式下即使还没有文本也要渲染一个空格占位。原因写在注释里：底部是 `flexShrink: 0`，若命令跑完那一刻高度从 0 变 1，就会从滚动区抢走一行、内容整体上跳。预留一行是终端布局里对付「异步内容改变高度」的通用手法。
  return <Box paddingX={paddingX} gap={2}>
      {statusLineText ? <Text dimColor wrap="truncate">
          <Ansi>{statusLineText}</Ansi>
        </Text> : isFullscreenEnvEnabled() ? <Text> </Text> : null}
    </Box>;
}

// Parent (PromptInputFooter) re-renders on every setMessages, but StatusLine's
// own props now only change when lastAssistantMessageId flips — memo keeps it
// from being dragged along (previously ~18 no-prop-change renders per session).
// 最后用 memo 包一层。注释给了量化依据：父级 PromptInputFooter 每次 setMessages 都重渲染，而状态栏自己的 props 只在 lastAssistantMessageId 变化时才变——历史上一次会话里约有 18 次「props 没变却被拖着重渲染」。这一层 memo 就是把这 18 次挡掉的。
export const StatusLine = memo(StatusLineInner);
// 原文件此处有一行 35812 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。