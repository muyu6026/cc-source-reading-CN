/**
 * Component that registers global keybinding handlers.
 *
 * Must be rendered inside KeybindingSetup to have access to the keybinding context.
 * This component renders nothing - it just registers the keybinding handlers.
 */
// 这个组件只做一件事：把全局快捷键 handler 注册进 keybinding 上下文。
// 必须渲染在 KeybindingSetup 之内（否则拿不到 context），自身返回 null。
import { feature } from 'bun:bundle';
import { useCallback } from 'react';
import instances from '../ink/instances.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import type { Screen } from '../screens/REPL.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../services/analytics/index.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { count } from '../utils/array.js';
import { getTerminalPanel } from '../utils/terminalPanel.js';
type Props = {
  screen: Screen;
  setScreen: React.Dispatch<React.SetStateAction<Screen>>;
  showAllInTranscript: boolean;
  setShowAllInTranscript: React.Dispatch<React.SetStateAction<boolean>>;
  messageCount: number;
  onEnterTranscript?: () => void;
  onExitTranscript?: () => void;
  virtualScrollActive?: boolean;
  searchBarOpen?: boolean;
};
// Props 全是 REPL 的透传：screen/setScreen 管视图切换，
// showAllInTranscript/messageCount 供埋点，
// 两个 onEnter/onExit 是 transcript 模式的进出钩子。

/**
 * Registers global keybinding handlers for:
 * - ctrl+t: Toggle todo list
 * - ctrl+o: Toggle transcript mode
 * - ctrl+e: Toggle showing all messages in transcript
 * - ctrl+c/escape: Exit transcript mode
 */
// 注册的全局键：ctrl+t 任务列表、ctrl+o 记录模式、
// ctrl+e 展开全部消息、ctrl+c/esc 退出记录模式
// （另有 ctrl+shift+b brief 视图，KAIROS 门下）。
export function GlobalKeybindingHandlers({
  screen,
  setScreen,
  showAllInTranscript,
  setShowAllInTranscript,
  messageCount,
  onEnterTranscript,
  onExitTranscript,
  virtualScrollActive,
  searchBarOpen = false
}: Props): null {
// 返回 null：纯注册组件，不渲染任何 Ink 节点。
  const expandedView = useAppState(s => s.expandedView);
  const setAppState = useSetAppState();
// expandedView 进依赖是为了在回调里读最新值，
// 判断 is_expanded 埋点字段。

  // Toggle todo list (ctrl+t) - cycles through views
  const handleToggleTodos = useCallback(() => {
    logEvent('tengu_toggle_todos', {
      is_expanded: expandedView === 'tasks'
    });
    setAppState(prev => {
      const {
        getAllInProcessTeammateTasks
      } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../tasks/InProcessTeammateTask/InProcessTeammateTask.js') as typeof import('../tasks/InProcessTeammateTask/InProcessTeammateTask.js');
// 运行时 require（eslint 特批）：InProcessTeammateTask 所在的
// 模块图会绕回本组件，静态 import 会形成循环依赖。
      const hasTeammates = count(getAllInProcessTeammateTasks(prev.tasks), t => t.status === 'running') > 0;
      if (hasTeammates) {
        // Both exist: none → tasks → teammates → none
        switch (prev.expandedView) {
          case 'none':
            return {
              ...prev,
              expandedView: 'tasks' as const
            };
          case 'tasks':
            return {
              ...prev,
              expandedView: 'teammates' as const
            };
          case 'teammates':
            return {
              ...prev,
              expandedView: 'none' as const
            };
        }
      }
      // Only tasks: none ↔ tasks
      return {
        ...prev,
        expandedView: prev.expandedView === 'tasks' ? 'none' as const : 'tasks' as const
      };
    });
  }, [expandedView, setAppState]);
// ctrl+t 三态循环（有队友时）：none → tasks → teammates → none；
// 无队友时退化成 none 与 tasks 两态。埋点 is_expanded 记的是切换前状态。

  // Toggle transcript mode (ctrl+o). Two-way prompt ↔ transcript.
  // Brief view has its own dedicated toggle on ctrl+shift+b.
// ctrl+o 与 ctrl+shift+b 的分工：前者管 prompt/transcript
// 两个主视图，后者只管 brief 过滤显示。
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s_0 => s_0.isBriefOnly) : false;
// biome 特批说明：feature() 是编译期常量，这里的条件调用在产物里
// 实际恒定成立或不成立，不违反 hooks 规则。
  const handleToggleTranscript = useCallback(() => {
    if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
      // Escape hatch: GB kill-switch while defaultView=chat was persisted
      // can leave isBriefOnly stuck on, showing a blank filterForBriefTool
      // view. Users will reach for ctrl+o — clear the stuck state first.
      // Only needed in the prompt screen — transcript mode already ignores
      // isBriefOnly (Messages.tsx filter is gated on !isTranscriptMode).
// kill-switch 逃生舱：GB 开关可以在 defaultView=chat 已持久化之后
// 再把 isBriefOnly 关掉，用户会看到空白的 filterForBriefTool 视图——
// 此时用户会本能按 ctrl+o，先把卡死的状态清掉再正常切换。
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        isBriefEnabled
      } = require('../tools/BriefTool/BriefTool.js') as typeof import('../tools/BriefTool/BriefTool.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (!isBriefEnabled() && isBriefOnly && screen !== 'transcript') {
// 三个条件：brief 功能已死 + 状态卡在 on + 当前不在 transcript
// （transcript 模式本来就不过滤 isBriefOnly，无需清）。
        setAppState(prev_0 => {
          if (!prev_0.isBriefOnly) return prev_0;
          return {
            ...prev_0,
            isBriefOnly: false
          };
        });
        return;
      }
    }
    const isEnteringTranscript = screen !== 'transcript';
    logEvent('tengu_toggle_transcript', {
      is_entering: isEnteringTranscript,
      show_all: showAllInTranscript,
      message_count: messageCount
    });
    setScreen(s_1 => s_1 === 'transcript' ? 'prompt' : 'transcript');
    setShowAllInTranscript(false);
    if (isEnteringTranscript && onEnterTranscript) {
      onEnterTranscript();
    }
    if (!isEnteringTranscript && onExitTranscript) {
      onExitTranscript();
    }
  }, [screen, setScreen, isBriefOnly, showAllInTranscript, setShowAllInTranscript, messageCount, setAppState, onEnterTranscript, onExitTranscript]);
// 依赖里放 isBriefOnly：逃生舱分支要读它判断是否卡死。
// setShowAllInTranscript(false) 是刻意重置：每次进 transcript
// 都从「只看工具调用」的默认视图开始。

  // Toggle showing all messages in transcript mode (ctrl+e)
  const handleToggleShowAll = useCallback(() => {
    logEvent('tengu_transcript_toggle_show_all', {
      is_expanding: !showAllInTranscript,
      message_count: messageCount
    });
    setShowAllInTranscript(prev_1 => !prev_1);
  }, [showAllInTranscript, setShowAllInTranscript, messageCount]);
// ctrl+e 只切显示不过滤数据：showAllInTranscript 控制 transcript
// 里是否铺开全部消息（含工具结果）。

  // Exit transcript mode (ctrl+c or escape)
  const handleExitTranscript = useCallback(() => {
    logEvent('tengu_transcript_exit', {
      show_all: showAllInTranscript,
      message_count: messageCount
    });
    setScreen('prompt');
    setShowAllInTranscript(false);
    if (onExitTranscript) {
      onExitTranscript();
    }
  }, [setScreen, showAllInTranscript, setShowAllInTranscript, messageCount, onExitTranscript]);
// ctrl+c/esc 退出 transcript：无条件 setScreen('prompt')，
// 与进入路径对称。

  // Toggle brief-only view (ctrl+shift+b). Pure display filter toggle —
  // does not touch opt-in state. Asymmetric gate (mirrors /brief): OFF
  // transition always allowed so the same key that got you in gets you
  // out even if the GB kill-switch fires mid-session.
  const handleToggleBrief = useCallback(() => {
    if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        isBriefEnabled: isBriefEnabled_0
      } = require('../tools/BriefTool/BriefTool.js') as typeof import('../tools/BriefTool/BriefTool.js');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (!isBriefEnabled_0() && !isBriefOnly) return;
// 非对称闸门：OFF 永远允许（进来的键必须能出去），
// ON 需要功能还活着——GB 中途关开关后不让人进得去。
      const next = !isBriefOnly;
      logEvent('tengu_brief_mode_toggled', {
        enabled: next,
        gated: false,
        source: 'keybinding' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setAppState(prev_2 => {
        if (prev_2.isBriefOnly === next) return prev_2;
        return {
          ...prev_2,
          isBriefOnly: next
        };
      });
    }
  }, [isBriefOnly, setAppState]);
// 纯显示过滤切换：不动 opt-in 状态，
// 埋点 gated:false 标明来源是按键。

  // Register keybinding handlers
  useKeybinding('app:toggleTodos', handleToggleTodos, {
    context: 'Global'
  });
  useKeybinding('app:toggleTranscript', handleToggleTranscript, {
    context: 'Global'
  });
  if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
    // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
    useKeybinding('app:toggleBrief', handleToggleBrief, {
      context: 'Global'
    });
  }
// toggleBrief 的注册整段被 feature 门控包住：编译期消除后
// 连 useKeybinding 调用都不存在。

  // Register teammate keybinding
  useKeybinding('app:toggleTeammatePreview', () => {
    setAppState(prev_3 => ({
      ...prev_3,
      showTeammateMessagePreview: !prev_3.showTeammateMessagePreview
    }));
  }, {
    context: 'Global'
  });
// 队友消息预览开关：只翻一个布尔，
// 供 teammate 消息裁剪显示用。

  // Toggle built-in terminal panel (meta+j).
  // toggle() blocks in spawnSync until the user detaches from tmux.
// meta+j 开关内置终端面板：toggle() 内部 spawnSync 会一直阻塞
// 到用户从 tmux detach——所以它是同步调用而不是异步触发。
  const handleToggleTerminal = useCallback(() => {
    if (feature('TERMINAL_PANEL')) {
      if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_panel', false)) {
        return;
      }
      getTerminalPanel().toggle();
    }
  }, []);
// 空依赖：handler 只读 GB 缓存值和单例面板，不需要重注册。
  useKeybinding('app:toggleTerminal', handleToggleTerminal, {
    context: 'Global'
  });

  // Clear screen and force full redraw (ctrl+l). Recovery path when the
  // terminal was cleared externally (macOS Cmd+K) and Ink's diff engine
  // thinks unchanged cells don't need repainting.
// ctrl+l 强制全量重画：外部清屏（macOS Cmd+K）后 Ink 的差分引擎
// 认为未变化的格子不用重画，屏幕就停在旧内容上——
// forceRedraw 是这种情况的恢复路径。
  const handleRedraw = useCallback(() => {
    instances.get(process.stdout)?.forceRedraw();
  }, []);
  useKeybinding('app:redraw', handleRedraw, {
    context: 'Global'
  });

  // Transcript-specific bindings (only active when in transcript mode)
  const isInTranscript = screen === 'transcript';
  useKeybinding('transcript:toggleShowAll', handleToggleShowAll, {
    context: 'Transcript',
    isActive: isInTranscript && !virtualScrollActive
// transcript:toggleShowAll 的 isActive 带 !virtualScrollActive：
// 虚拟滚动开启时 ctrl+e 另有归属（展开/收起全部由滚动视图自理）。
  });
  useKeybinding('transcript:exit', handleExitTranscript, {
    context: 'Transcript',
    // Bar-open is a mode (owns keystrokes). Navigating (highlights
    // visible, n/N active, bar closed) is NOT — Esc exits transcript
    // directly, same as less q. useSearchInput doesn't stopPropagation,
    // so without this gate its onCancel AND this handler would both
    // fire on one Esc (child registers first, fires first, bubbles).
// Esc 的双重人格仲裁：搜索栏「打开」是模式态（独占按键），
// Esc 归它；只是「导航中」（有高亮、栏关闭）不是模式，
// Esc 直接退 transcript——与 less 的 q 一致。
// 没有这层门控，useSearchInput 的 onCancel 和本 handler 会在同一次
// Esc 上双双触发（子组件先注册先触发，然后冒泡）。
    isActive: isInTranscript && !searchBarOpen
  });
// 注册顺序即触发顺序：子组件（如搜索栏）先注册先触发，
// 上面的 isActive 门控就是按这个前提设计的。
  return null;
}
// 原文件此处有一行 21816 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。