// ═══════════════════════════════════════════════════════════════
//  Messages：一条消息列表的七道工序
// ═══════════════════════════════════════════════════════════════
//
//  这是整个 UI 层最重的一个组件（833 行），但它做的事可以用一句话概括：
//  **把服务端回来的原始消息数组，变成屏幕上的一行行**。
//
//  中间夹着七道工序，每一道都在解决一个具体的性能或正确性问题：
//
//  1. 规范化（normalizeMessages）—— 原始消息 → 可渲染消息
//  2. 切边界（compact boundary）—— 压缩点之前的历史要不要显示
//  3. 重排（reorderMessagesInUI）—— 流式 tool_use 的位置
//  4. 过滤（null-rendering attachment / brief 模式）
//  5. 分组（applyGrouping）—— 同一个 assistant turn 的多个 tool_use
//  6. 折叠（四个 collapse 串起来）—— read/search 合并成一行
//  7. 切片（cap / renderRange / 虚拟列表）
//
//  **这七道工序的顺序不能换**，理由在每一道的锚点里。最反直觉的是第 5、6
//  两道：分组在前、折叠在后，因为折叠要按「分组后的结构」判断能不能合。
//
//  另外，这份文件里有一半的代码量是**注释**，而且注释里带着实测数字
//  （150K+ writes/frame、59 GB RSS、14k mmap/sec、100-173ms 停顿）。
//  这不是炫技 —— 这些数字是「为什么不能写得更简单」的唯一证据。
//  没有数字的性能注释，读代码的人只能在「相信」和「重写」之间二选一。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import type { UUID } from 'crypto';
import type { RefObject } from 'react';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { every } from 'src/utils/set.js';
import { getIsRemoteMode } from '../bootstrap/state.js';
import type { Command } from '../commands.js';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { Box, Text } from '../ink.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import type { Screen } from '../screens/REPL.js';
import type { Tools } from '../Tool.js';
import { findToolByName } from '../Tool.js';
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js';
import type { Message as MessageType, NormalizedMessage, ProgressMessage as ProgressMessageType, RenderableMessage } from '../types/message.js';
import { type AdvisorBlock, isAdvisorBlock } from '../utils/advisor.js';
import { collapseBackgroundBashNotifications } from '../utils/collapseBackgroundBashNotifications.js';
import { collapseHookSummaries } from '../utils/collapseHookSummaries.js';
import { collapseReadSearchGroups } from '../utils/collapseReadSearch.js';
import { collapseTeammateShutdowns } from '../utils/collapseTeammateShutdowns.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { applyGrouping } from '../utils/groupToolUses.js';
import { buildMessageLookups, createAssistantMessage, deriveUUID, getMessagesAfterCompactBoundary, getToolUseID, getToolUseIDs, hasUnresolvedHooksFromLookup, isNotEmptyMessage, normalizeMessages, reorderMessagesInUI, type StreamingThinking, type StreamingToolUse, shouldShowUserMessage } from '../utils/messages.js';
import { plural } from '../utils/stringUtils.js';
import { renderableSearchText } from '../utils/transcriptSearch.js';
import { Divider } from './design-system/Divider.js';
import type { UnseenDivider } from './FullscreenLayout.js';
import { LogoV2 } from './LogoV2/LogoV2.js';
import { StreamingMarkdown } from './Markdown.js';
import { hasContentAfterIndex, MessageRow } from './MessageRow.js';
import { InVirtualListContext, type MessageActionsNav, MessageActionsSelectedContext, type MessageActionsState } from './messageActions.js';
import { AssistantThinkingMessage } from './messages/AssistantThinkingMessage.js';
import { isNullRenderingAttachment } from './messages/nullRenderingAttachments.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import type { ToolUseConfirm } from './permissions/PermissionRequest.js';
import { StatusNotices } from './StatusNotices.js';
import type { JumpHandle } from './VirtualMessageList.js';

// 【这条注释值得逐字读完，它解释了整个渲染管线的一个硬约束】
//
//  核心链路是：LogoHeader 脏 → renderChildren 的 seenDirtyChild 冒泡 →
//  后面所有兄弟节点的 prevScreen（blit 基准）被作废 → 每一行都重写。
//
//  这一步不是「变慢一点」，是**从 O(变化量) 退化成 O(全屏)**。终端里
//  「重写一行」= 一组光标定位 + SGR + 字符，2800 条消息 150K+ 次写入。
//
//  所以 Memo 的依赖选了 agentDefinitions 而不是 messages：消息数组每来
//  一段流就换一个新引用，拿它当依赖等于没 Memo。
// Memoed logo header: this box is the FIRST sibling before all MessageRows
// in main-screen mode. If it becomes dirty on every Messages re-render,
// renderChildren's seenDirtyChild cascade disables prevScreen (blit) for
// ALL subsequent siblings — every MessageRow re-writes from scratch instead
// of blitting. In long sessions (~2800 messages) this is 150K+ writes/frame
// and pegs CPU at 100%. Memo on agentDefinitions so a new messages array
// doesn't invalidate the logo subtree. LogoV2/StatusNotices internally
// subscribe to useAppState/useSettings for their own updates.
const LogoHeader = React.memo(function LogoHeader(t0) {
  const $ = _c(3);
  const {
    agentDefinitions
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <LogoV2 />;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== agentDefinitions) {
    t2 = <OffscreenFreeze><Box flexDirection="column" gap={1}>{t1}<React.Suspense fallback={null}><StatusNotices agentDefinitions={agentDefinitions} /></React.Suspense></Box></OffscreenFreeze>;
    $[1] = agentDefinitions;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
});

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
// 【DCE 的三种力度，这里一次用全了】
//
//  · feature('PROACTIVE') 单独为真 → 整个模块 require
//  · feature('KAIROS') || feature('KAIROS_BRIEF') → 只取一个常量
//  · feature('KAIROS') → 再取另一个常量
//
//  require 在条件分支里，是因为 `bun:bundle` 的 feature() 是**编译期常量**：
//  打包时这些分支会被折叠成 `null`，require 的模块连代码都不会进产物。
//  写成顶层 import 就做不到 —— import 是无条件的。
//
//  代价：类型得手写 `as typeof import(...)`，因为 import() 的类型在运行
//  时不参与。这是 DCE 的固定税，全仓库都这么写。
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../proactive/index.js') : null;
const BRIEF_TOOL_NAME: string | null = feature('KAIROS') || feature('KAIROS_BRIEF') ? (require('../tools/BriefTool/prompt.js') as typeof import('../tools/BriefTool/prompt.js')).BRIEF_TOOL_NAME : null;
const SEND_USER_FILE_TOOL_NAME: string | null = feature('KAIROS') ? (require('../tools/SendUserFileTool/prompt.js') as typeof import('../tools/SendUserFileTool/prompt.js')).SEND_USER_FILE_TOOL_NAME : null;

/* eslint-enable @typescript-eslint/no-require-imports */
import { VirtualMessageList } from './VirtualMessageList.js';

/**
 * In brief-only mode, filter messages to show ONLY Brief tool_use blocks,
 * their tool_results, and real user input. All assistant text is dropped —
 * if the model forgets to call Brief, the user sees nothing for that turn.
 * That's on the model to get right; the filter does not second-guess it.
 */
// 【brief 模式的哲学：过滤掉一切，只留 Brief 的输出】
//
//  注意 JSDoc 最后那句 "That's on the model to get right; the filter does
//  not second-guess it." —— 这是**明确的错误归属声明**：模型忘了调 Brief，
//  用户就看不到东西，这是模型的问题，不是过滤器的。
//
//  这种「不做兜底」的选择很少见，但它避免了更糟的结果：兜底会让「模型
//  忘了调 Brief」变成一个不可见的故障（用户以为模式生效了，其实看到的
//  是完整输出）。宁可空屏也不要错屏。
export function filterForBriefTool<T extends {
  type: string;
  subtype?: string;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    content: Array<{
      type: string;
      name?: string;
      tool_use_id?: string;
    }>;
  };
  attachment?: {
    type: string;
    isMeta?: boolean;
    origin?: unknown;
    commandMode?: string;
  };
}>(messages: T[], briefToolNames: string[]): T[] {
  const nameSet = new Set(briefToolNames);
  // tool_use always precedes its tool_result in the array, so we can collect
  // IDs and match against them in a single pass.
  const briefToolUseIDs = new Set<string>();
  return messages.filter(msg => {
    // System messages (attach confirmation, remote errors, compact boundaries)
    // must stay visible — dropping them leaves the viewer with no feedback.
    // Exception: api_metrics is per-turn debug noise (TTFT, config writes,
    // hook timing) that defeats the point of brief mode. Still visible in
    // transcript mode (ctrl+o) which bypasses this filter.
// 【system 一律保留，只有一个例外：api_metrics】
//
//  api_metrics 是 TTFT / 配置写入 / hook 耗时——**每轮都有**。brief 模式的
//  前提是「屏幕上一屏能看完」，留着它等于每轮多几行噪声，模式就失去意义。
//
//  而其他 system（attach 确认、远端错误、compact 边界）必须留：它们是
//  **状态变化的唯一反馈**，删掉用户就不知道发生了什么。
//
//  判据可以抽象成：这条消息消失后，用户会不会失去对系统状态的认知。
//  api_metrics 不会（它是给开发者看的），其余会。
    if (msg.type === 'system') return msg.subtype !== 'api_metrics';
    const block = msg.message?.content[0];
    if (msg.type === 'assistant') {
      // API error messages (auth failures, rate limits, etc.) must stay visible
      if (msg.isApiErrorMessage) return true;
      // Keep Brief tool_use blocks (renders with standard tool call chrome,
      // and must be in the list so buildMessageLookups can resolve tool results)
      if (block?.type === 'tool_use' && block.name && nameSet.has(block.name)) {
        if ('id' in block) {
          briefToolUseIDs.add((block as {
            id: string;
          }).id);
        }
        return true;
      }
      return false;
    }
    if (msg.type === 'user') {
      if (block?.type === 'tool_result') {
// 【tool_result 的命运由它对应的 tool_use 决定】
//
//  不能靠「result 长什么样」判断 —— 所有 tool_result 长得一样。只能回头
//  查 briefToolUseIDs，而这个集合是在**遍历到 tool_use 时顺手填的**。
//
//  前提是数组顺序：tool_use 一定在它的 tool_result 之前。这不是约定，
//  是 Anthropic API 的结构要求（assistant 消息里发 tool_use，下一条 user
//  消息里才有 tool_result）。所以单趟扫描成立。
        return block.tool_use_id !== undefined && briefToolUseIDs.has(block.tool_use_id);
      }
      // Real user input only — drop meta/tick messages.
      return !msg.isMeta;
    }
    if (msg.type === 'attachment') {
      // Human input drained mid-turn arrives as a queued_command attachment
      // (query.ts mid-chain drain → getQueuedCommandAttachments). Keep it —
      // it's what the user typed. commandMode === 'prompt' positively
      // identifies human-typed input; task-notification callers set
      // mode: 'task-notification' but not origin/isMeta, so the positive
      // commandMode check is required to exclude them.
      const att = msg.attachment;
// 【为什么这里要四个条件，而不是「不是 isMeta 就行」】
//
//  注释点出了关键：task-notification 的调用方**只设了 mode，没设
//  origin / isMeta**。也就是说「通知类附件」在数据上看起来和「用户打字」
//  几乎一样，唯一的区别是 commandMode。
//
//  所以判据必须用**正向识别**（commandMode === 'prompt'）而不是反向排除。
//  反向排除的问题在于：你不知道还有谁会漏掉那几个标记，将来加了新的
//  附件类型，它会静默地被当成用户输入显示出来。
//
//  **在「排除法会漏」的地方，改用「只有这一种才算」** —— 这条规律在本仓
//  出现过很多次（见 mcp 的 allowlist 段）。
      return att?.type === 'queued_command' && att.commandMode === 'prompt' && !att.isMeta && att.origin === undefined;
    }
    return false;
  });
}

/**
 * Full-transcript companion to filterForBriefTool. When the Brief tool is
 * in use, the model's text output is redundant with the SendUserMessage
 * content it wrote right after — drop the text so only the SendUserMessage
 * block shows. Tool calls and their results stay visible.
 *
 * Per-turn: only drops text in turns that actually called Brief. If the
 * model forgets, text still shows — otherwise the user would see nothing.
 */
// 【为什么不直接全局丢 assistant text】
//
//  因为 brief 不一定每轮都调。「按 turn 判断」比「按配置判断」稳：
//  模型这一轮调了 Brief，这一轮的文字是重复的（丢）；这一轮忘了调，
//  文字是唯一的输出（留）。
//
//  turn 的边界定在「非 tool_result 的 user 消息」—— 也就是用户每说一句话
//  算一个 turn。注意 `turn++` 之后 `continue`，所以 user 消息本身不参与
//  后续的类型标注。
export function dropTextInBriefTurns<T extends {
  type: string;
  isMeta?: boolean;
  message?: {
    content: Array<{
      type: string;
      name?: string;
    }>;
  };
}>(messages: T[], briefToolNames: string[]): T[] {
  const nameSet = new Set(briefToolNames);
  // First pass: find which turns (bounded by non-meta user messages) contain
  // a Brief tool_use. Tag each assistant text block with its turn index.
  const turnsWithBrief = new Set<number>();
  const textIndexToTurn: number[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const block = msg.message?.content[0];
    if (msg.type === 'user' && block?.type !== 'tool_result' && !msg.isMeta) {
      turn++;
      continue;
    }
    if (msg.type === 'assistant') {
      if (block?.type === 'text') {
        textIndexToTurn[i] = turn;
      } else if (block?.type === 'tool_use' && block.name && nameSet.has(block.name)) {
        turnsWithBrief.add(turn);
      }
    }
  }
// 【提前 return 原数组引用，不只是省一次 filter】
//
//  如果这里返回 `messages.filter(...)` 的空结果，虽然内容相同，但**引用
//  变了** → 下游所有 useMemo 全部失效 → 整条管线重跑 → 所有 MessageRow
//  的 message prop 换引用 → memo 比较器第一行就 return false。
//
//  一个「没有变化」的过滤，通过引用变化把整个渲染树打脏。这种 bug 极难
//  定位，因为每一层单独看都「只是多做了一次 filter」。
  if (turnsWithBrief.size === 0) return messages;
  // Second pass: drop text blocks whose turn called Brief.
  return messages.filter((_, i) => {
    const t = textIndexToTurn[i];
    return t === undefined || !turnsWithBrief.has(t);
  });
}
type Props = {
  messages: MessageType[];
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  toolJSX: {
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
  } | null;
  toolUseConfirmQueue: ToolUseConfirm[];
  inProgressToolUseIDs: Set<string>;
  isMessageSelectorVisible: boolean;
  conversationId: string;
  screen: Screen;
  streamingToolUses: StreamingToolUse[];
  showAllInTranscript?: boolean;
  agentDefinitions?: AgentDefinitionsResult;
  onOpenRateLimitOptions?: () => void;
  /** Hide the logo/header - used for subagent zoom view */
  hideLogo?: boolean;
  isLoading: boolean;
  /** In transcript mode, hide all thinking blocks except the last one */
  hidePastThinking?: boolean;
  /** Streaming thinking content (live updates, not frozen) */
  streamingThinking?: StreamingThinking | null;
  /** Streaming text preview (rendered as last item so transition to final message is positionally seamless) */
  streamingText?: string | null;
  /** When true, only show Brief tool output (hide everything else) */
  isBriefOnly?: boolean;
  /** Fullscreen-mode "─── N new ───" divider. Renders before the first
   *  renderableMessage derived from firstUnseenUuid (matched by the 24-char
   *  prefix that deriveUUID preserves). */
  unseenDivider?: UnseenDivider;
  /** Fullscreen-mode ScrollBox handle. Enables React-level virtualization when present. */
  scrollRef?: RefObject<ScrollBoxHandle | null>;
  /** Fullscreen-mode: enable sticky-prompt tracking (writes via ScrollChromeContext). */
  trackStickyPrompt?: boolean;
  /** Transcript search: jump-to-index + setSearchQuery/nextMatch/prevMatch. */
  jumpRef?: RefObject<JumpHandle | null>;
  /** Transcript search: fires when match count/position changes. */
  onSearchMatchesChange?: (count: number, current: number) => void;
  /** Paint an existing DOM subtree to fresh Screen, scan. Element comes
   *  from the main tree (all real providers). Message-relative positions. */
  scanElement?: (el: import('../ink/dom.js').DOMElement) => import('../ink/render-to-screen.js').MatchPosition[];
  /** Position-based CURRENT highlight. positions stable (msg-relative),
   *  rowOffset tracks scroll. null clears. */
  setPositions?: (state: {
    positions: import('../ink/render-to-screen.js').MatchPosition[];
    rowOffset: number;
    currentIdx: number;
  } | null) => void;
  /** Bypass MAX_MESSAGES_WITHOUT_VIRTUALIZATION. For one-shot headless renders
   *  (e.g. /export via renderToString) where the memory concern doesn't apply
   *  and the "already in scrollback" justification doesn't hold. */
  disableRenderCap?: boolean;
  /** In-transcript cursor; expanded overrides verbose for selected message. */
  cursor?: MessageActionsState | null;
  setCursor?: (cursor: MessageActionsState | null) => void;
  /** Passed through to VirtualMessageList (heightCache owns visibility). */
  cursorNavRef?: React.Ref<MessageActionsNav>;
  /** Render only collapsed.slice(start, end). For chunked headless export
   *  (streamRenderedMessages in exportRenderer.tsx): prep runs on the FULL
   *  messages array so grouping/lookups are correct, but only this slice
   *  chunk instead of the full session. The logo renders only for chunk 0
   *  (start === 0); later chunks are mid-stream continuations.
   *  Measured Mar 2026: 538-msg session, 20 slices → −55% plateau RSS. */
  renderRange?: readonly [start: number, end: number];
};
// 【两个上限，管的是两件不同的事】
//
//  · 30（MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE）：**交互上限**。
//    ctrl+o 的 transcript 屏幕只看最近 30 条，其余靠 ctrl+e 展开。
//    这是产品决策，不是性能决策。
//
//  · 200（MAX_MESSAGES_WITHOUT_VIRTUALIZATION）：**安全上限**。
//    只在没有虚拟列表时生效，防止 fiber 树把内存吃穿。
//
//  两个数差 6 倍，但它们在代码里出现在相邻的两行 —— 读的时候要分清，
//  否则会以为「transcript 模式最多 200 条」或者「200 是产品设定」。
const MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE = 30;

// 【这段注释是「一次错误的完整考古」】
//
//  它记录了三种切片方案，每一种都试过、都坏了：
//
//  1. `slice(-200)` —— 每次追加都从头部掉一条。掉一条 = 屏幕上的内容整体
//     上移一行 = log-update 认为「基准全错」= 每轮一次全量重置（CC-941）
//  2. 量化到 50 条一档（CC-1154）—— 缓解了，但压缩和折叠重组也会改变
//     collapsed.length，而**没有新消息进来**，于是仍然在挪
//  3. UUID 锚点（CC-1174）—— 只在「真的超过 CAP+STEP」时才前进
//
//  第 3 条为什么能修好：它把判据从「数组长度」换成了「那一条具体消息还在
//  不在窗口里」。长度会因为分组/压缩而变化，那条消息的位置不会。
//
//  **凡是「由长度推导位置」的逻辑，在长度会被别的因素改变时都会坏。**
//  这是同一类 bug 的第三次出现（前两次在 log-update 的 scrollback 计数）。
// Safety cap for the non-virtualized render path (fullscreen off or
// explicitly disabled). Ink mounts a full fiber tree per message (~250 KB
// RSS each); yoga layout height grows unbounded; the screen buffer is sized
// to fit every line. At ~2000 messages this is ~3000-line screens, ~500 MB
// of fibers, and per-frame write costs that push the process into a GC
// death spiral (observed: 59 GB RSS, 14k mmap/munmap/sec). Content dropped
// from this slice has already been printed to terminal scrollback — users
// can still scroll up natively. VirtualMessageList (the default ant path)
// bypasses this cap entirely. Headless one-shot renders (e.g. /export)
// pass disableRenderCap to opt out — they have no scrollback and the
// memory concern doesn't apply to renderToString.
//
// The slice boundary is tracked as a UUID anchor, not a count-derived
// index. Count-based slicing (slice(-200)) drops one message from the
// front on every append, shifting scrollback content and forcing a full
// terminal reset per turn (CC-941). Quantizing to 50-message steps
// (CC-1154) helped but still shifted on compaction and collapse regrouping
// since those change collapsed.length without adding messages. The UUID
// anchor only advances when rendered count genuinely exceeds CAP+STEP —
// immune to length churn from grouping/compaction (CC-1174).
//
// The anchor stores BOTH uuid and index. Some uuids are unstable between
// renders: collapseHookSummaries derives the merged uuid from the first
// summary in a group, but reorderMessagesInUI reshuffles hook adjacency
// as tool results stream in, changing which summary is first. When the
// uuid vanishes, falling back to the stored index (clamped) keeps the
// slice roughly where it was instead of resetting to 0 — which would
// jump from ~200 rendered messages to the full history, orphaning
// in-progress badge snapshots in scrollback.
const MAX_MESSAGES_WITHOUT_VIRTUALIZATION = 200;
const MESSAGE_CAP_STEP = 50;
// 【为什么锚点要存两样东西：uuid 和 index】
//
//  uuid 也不稳定 —— 这句话是这段注释里最反直觉的。原因：
//
//  collapseHookSummaries 合并一组 hook 摘要时，用**第一条**的 uuid 当合并
//  后的 uuid。而 reorderMessagesInUI 会随着 tool result 陆续到达重新排列
//  hook 的相邻关系，于是「哪一条排第一」会变，合并 uuid 跟着变。
//
//  于是 uuid 会「凭空消失」。此时若回退到 0，渲染窗口会从 ~200 条跳到全部
//  历史 —— 而屏幕上那些已经画出去的行还带着「进行中」的徽标，它们再也
//  不会被更新（孤儿）。
//
//  所以 uuid 丢了就退回 index（clamp 过）。这套组合的意思是：
//  **优先用稳定标识，标识消失时用最后已知位置兜底，且兜底不会倒退到 0。**
export type SliceAnchor = {
  uuid: string;
  idx: number;
} | null;

/** Exported for testing. Mutates anchorRef when the window needs to advance. */
// 【cap / step 是两个参数，但生产路径从来不传】
//
//  注释写 "Exported for testing" —— 而这份源码里没有测试文件（打包产物
//  反推时被剥掉了）。所以读到这里会看到两个「有名无实」的参数。
//
//  它们的作用是让测试能构造「窗口刚超过 CAP+STEP」这个临界状态，不用真的
//  造 250 条消息。这种「把常量提成参数只为可测」的写法值得学，但也要
//  认清：**参数化本身不产生测试**，没有测试文件时它只是多两个入参。
export function computeSliceStart(collapsed: ReadonlyArray<{
  uuid: string;
}>, anchorRef: {
  current: SliceAnchor;
}, cap = MAX_MESSAGES_WITHOUT_VIRTUALIZATION, step = MESSAGE_CAP_STEP): number {
  const anchor = anchorRef.current;
  const anchorIdx = anchor ? collapsed.findIndex(m => m.uuid === anchor.uuid) : -1;
  // Anchor found → use it. Anchor lost → fall back to stored index
  // (clamped) so collapse-regrouping uuid churn doesn't reset to 0.
// 【这一行是三个分支挤在一起，值得拆开读】
//
//  · anchorIdx >= 0            → 锚点消息还在，直接用它的位置
//  · anchor（但 idx 找不到）    → 用存的 index，并 clamp 到「至少留下 cap 条」
//  · 没有 anchor                → 0（第一次渲染）
//
//  第二个分支的 clamp 上限 `collapsed.length - cap` 有讲究：如果存的 index
//  比「倒数第 cap 条」还靠前，说明这期间消息被删了很多，按原 index 切会
//  只剩下不到 cap 条。夹到那个位置，正好留下 cap 条。
//
//  注意 clamp 只夹上限不夹下限 —— 下限由外层的 Math.max(0, ...) 保证。
  let start = anchorIdx >= 0 ? anchorIdx : anchor ? Math.min(anchor.idx, Math.max(0, collapsed.length - cap)) : 0;
// 【为什么要留 CAP+STEP 的滞后，而不是一超过 cap 就前进】
//
//  因为「每来一条消息就前进一格」= 每轮都从头部掉一条 = 回到 CC-941 的
//  全量重置。
//
//  留 50 条的缓冲，意味着窗口每 50 条才整体挪一次，代价被摊薄到 1/50。
//  这是**用内存换稳定性**的典型：多留 50 条消息的 fiber，换「大部分轮次
//  的屏幕基准不作废」。
  if (collapsed.length - start > cap + step) {
    start = collapsed.length - cap;
  }
  // Refresh anchor from whatever lives at the current start — heals a
  // stale uuid after fallback and captures a new one after advancement.
  const msgAtStart = collapsed[start];
// 【自愈：锚点从「当前 start 位置上那条消息」重新取】
//
//  这一段的两个分支不对称，但都必要：
//
//  · msgAtStart 存在且与 anchor 不一致 → 重写锚点。这同时修好两种情况：
//    走了 clamp 回退分支之后（uuid 是旧的），以及前进之后（位置变了）。
//  · msgAtStart 不存在（数组空了）而 anchor 还在 → 清空。否则下次渲染会
//    拿一个指向空气的锚点去 findIndex，永远 -1，永远走回退分支。
//
//  **在 render 期间改 ref 是可以的，但必须幂等** —— 注释里点明了
//  StrictMode 双渲染的顾虑。这里的幂等性来自：第二次跑时 anchor 已经等于
//  当前位置，两个分支都不触发。
  if (msgAtStart && (anchor?.uuid !== msgAtStart.uuid || anchor.idx !== start)) {
    anchorRef.current = {
      uuid: msgAtStart.uuid,
      idx: start
    };
  } else if (!msgAtStart && anchor) {
    anchorRef.current = null;
  }
  return start;
}
const MessagesImpl = ({
  messages,
  tools,
  commands,
  verbose,
  toolJSX,
  toolUseConfirmQueue,
  inProgressToolUseIDs,
  isMessageSelectorVisible,
  conversationId,
  screen,
  streamingToolUses,
  showAllInTranscript = false,
  agentDefinitions,
  onOpenRateLimitOptions,
  hideLogo = false,
  isLoading,
  hidePastThinking = false,
  streamingThinking,
  streamingText,
  isBriefOnly = false,
  unseenDivider,
  scrollRef,
  trackStickyPrompt,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions,
  disableRenderCap = false,
  cursor = null,
  setCursor,
  cursorNavRef,
  renderRange
}: Props): React.ReactNode => {
  const {
    columns
  } = useTerminalSize();
  const toggleShowAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'Ctrl+E');
// 【normalizeMessages 在这里只跑一次，但它改变了 uuid】
//
//  规范化会给每条消息派生新 uuid（deriveUUID），所以**下游任何拿原始 uuid
//  去比的地方都会失配**。这就是后面 getMessagesAfterCompactBoundary 要传
//  includeSnipped 的原因（见第 496 行的批注）。
//
//  isNotEmptyMessage 放在同一趟：空消息（content 为空数组）会让 yoga 量出
//  高度 0，屏幕上是一条看不见但占位的行。
  const normalizedMessages = useMemo(() => normalizeMessages(messages).filter(isNotEmptyMessage), [messages]);

  // Check if streaming thinking should be visible (streaming or within 30s timeout)
// 【这里有一个真 bug：Date.now() 在 useMemo 里，但没进依赖】
//
//  useMemo 的依赖是 [streamingThinking]。只要那个对象引用不变，这个 memo
//  就不重算 —— 于是 30 秒的窗口**不会自己过期**。
//
//  实际后果：流式 thinking 结束（isStreaming 变 false，streamingEndedAt
//  被设上）之后，如果没有任何东西让 streamingThinking 换引用，这块内容会
//  一直显示，直到下一个 turn 开始。
//
//  为什么平时看不出来：Messages 在流式期间几乎每帧都重渲染（streamingText
//  在变），而且下一轮很快就开始，30 秒的窗口几乎没机会被观察到。
//
//  正确写法要么把「当前时间」也做成状态（定时器），要么干脆不用 useMemo。
//  **只要 useMemo 里读了 Date.now()，它就是一个会被缓存的时钟。**
  const isStreamingThinkingVisible = useMemo(() => {
    if (!streamingThinking) return false;
    if (streamingThinking.isStreaming) return true;
    if (streamingThinking.streamingEndedAt) {
      return Date.now() - streamingThinking.streamingEndedAt < 30000;
    }
    return false;
  }, [streamingThinking]);

  // Find the last thinking block (message UUID + content index) for hiding past thinking in transcript mode
  // When streaming thinking is visible, use a special ID that won't match any completed thinking block
  // With adaptive thinking, only consider thinking blocks from the current turn and stop searching once we
  // hit the last user message.
// 【三个哨兵值，一个 null，语义全靠约定】
//
//  返回值的四种可能：
//
//  · null            → hidePastThinking 关闭，什么都不用藏
//  · 'streaming'     → 正在流式输出 thinking，把**所有**已完成的都藏起来
//  · 'no-thinking'   → 往回扫遇到了上一个用户 turn，藏起所有旧的
//  · "uuid:index"    → 只显示这一个 thinking 块
//
//  'streaming' 和 'no-thinking' 都是**不可能匹配任何真实块**的字符串，
//  于是下游 `thinkingBlockId === lastThinkingBlockId` 永远为假 → 全部
//  hideInTranscript。用一个「绝不匹配的 ID」表达「全藏」，比加一个布尔
//  标志少一个参数，但代价是语义靠字符串魔法值承载。
//
//  返回 null 和返回 'no-thinking' 的区别必须看清：null 让
//  `!lastThinkingBlockId` 成立 → isLastThinking 恒真 → **全部显示**。
  const lastThinkingBlockId = useMemo(() => {
    if (!hidePastThinking) return null;
    // If streaming thinking is visible, hide all completed thinking blocks by using a non-matching ID
    if (isStreamingThinkingVisible) return 'streaming';
    // Iterate backwards to find the last message with a thinking block
    for (let i = normalizedMessages.length - 1; i >= 0; i--) {
      const msg = normalizedMessages[i];
      if (msg?.type === 'assistant') {
        const content = msg.message.content;
        // Find the last thinking block in this message
        for (let j = content.length - 1; j >= 0; j--) {
          if (content[j]?.type === 'thinking') {
            return `${msg.uuid}:${j}`;
          }
        }
// 【扫到「没有 tool_result 的 user 消息」就停，是因为它标志 turn 边界】
//
//  为什么要判断 hasToolResult：tool_result 也是 user 消息（API 结构如此），
//  如果不排除，扫到第一条 tool_result 就停了 —— 而它通常就在当前 turn 的
//  中间，等于把「本轮的 thinking」也藏掉。
//
//  过滤条件必须能区分「用户说的话」和「工具返回的内容」，两者在类型上
//  都是 user。判据只能看 content 里有没有 tool_result 块。
      } else if (msg?.type === 'user') {
        const hasToolResult = msg.message.content.some(block => block.type === 'tool_result');
        if (!hasToolResult) {
          // Reached a previous user turn so don't show stale thinking from before
          return 'no-thinking';
        }
      }
    }
    return null;
  }, [normalizedMessages, hidePastThinking, isStreamingThinkingVisible]);

  // Find the latest user bash output message (from ! commands)
  // This allows us to show full output for the most recent bash command
// 【只认最后一条 bash 输出，其余折叠】
//
//  判据是内容前缀：`<bash-stdout` / `<bash-stderr`。这是 ! 命令的输出被
//  包装成 user 文本消息时留下的标记，属于**协议层面的约定**，不是类型。
//
//  为什么只展开最后一条：bash 输出可能几百行，全都展开等于把历史刷没。
//  只留最近的一次，符合「刚跑完的命令我想看全」的使用习惯。
  const latestBashOutputUUID = useMemo(() => {
    // Iterate backwards to find the last user message with bash output
    for (let i_0 = normalizedMessages.length - 1; i_0 >= 0; i_0--) {
      const msg_0 = normalizedMessages[i_0];
      if (msg_0?.type === 'user') {
        const content_0 = msg_0.message.content;
        // Check if any text content is bash output
        for (const block_0 of content_0) {
          if (block_0.type === 'text') {
            const text = block_0.text;
            if (text.startsWith('<bash-stdout') || text.startsWith('<bash-stderr')) {
              return msg_0.uuid;
            }
          }
        }
      }
    }
    return null;
  }, [normalizedMessages]);

  // streamingToolUses updates on every input_json_delta while normalizedMessages
  // stays stable — precompute the Set so the filter is O(k) not O(n×k) per chunk.
// 【为什么要预计算 Set，注释说反了一半】
//
//  注释写 "streamingToolUses updates on every input_json_delta while
//  normalizedMessages stays stable" —— 意思是：贵的那一侧稳定，便宜的那
//  一侧每 chunk 都变。所以把**稳定那一侧**算成 Set，缓存住。
//
//  如果写成 `streamingToolUses.filter(stu => !getToolUseIDs(normalized)...)`，
//  就是每次 delta 都重扫一遍全部消息（O(n×k)）。
  const normalizedToolUseIDs = useMemo(() => getToolUseIDs(normalizedMessages), [normalizedMessages]);
  const streamingToolUsesWithoutInProgress = useMemo(() => streamingToolUses.filter(stu => !inProgressToolUseIDs.has(stu.contentBlock.id) && !normalizedToolUseIDs.has(stu.contentBlock.id)), [streamingToolUses, inProgressToolUseIDs, normalizedToolUseIDs]);
  const syntheticStreamingToolUseMessages = useMemo(() => streamingToolUsesWithoutInProgress.flatMap(streamingToolUse => {
    const msg_1 = createAssistantMessage({
      content: [streamingToolUse.contentBlock]
    });
    // Override randomUUID with deterministic value derived from content
    // block ID to prevent React key changes on every memo recomputation.
    // Same class of bug fixed in normalizeMessages (commit 383326e613):
    // fresh randomUUID → unstable React keys → component remounts →
    // Ink rendering corruption (overlapping text from stale DOM nodes).
// 【deriveUUID 而不是 randomUUID，是为了 React key 稳定】
//
//  这一段是「同一个 bug 的第二次修复」。注释里给了前一次的提交号
//  （383326e613），以及症状：随机 uuid → key 每帧都变 → 组件 remount →
//  Ink 的旧 DOM 节点没被清掉 → **屏幕上文字重叠**。
//
//  注意症状的隐蔽性：remount 不会报错，React 只是把旧节点标成待删除，
//  而 Ink 的宿主实现里删除和插入的顺序一旦错，就会看到两层文字叠在一起。
//  所以这类 bug 排查时容易误判成「渲染器有问题」，实际是 key 不稳定。
//
//  deriveUUID(id, 0) 的第二个参数是块内下标 —— 同一个 tool_use id 只会有
//  一个块，所以固定 0。
    msg_1.uuid = deriveUUID(streamingToolUse.contentBlock.id as UUID, 0);
    return normalizeMessages([msg_1]);
  }), [streamingToolUsesWithoutInProgress]);
  const isTranscriptMode = screen === 'transcript';
  // Hoisted to mount-time — this component re-renders on every scroll.
// 【空依赖数组 + useMemo = 「只在挂载时读一次环境变量」】
//
//  这是一个很少见的组合。通常空依赖配 useState 的惰性初始化，这里用
//  useMemo 是为了表达「这是个值，不是状态」。
//
//  注释说明了必要性：这个组件**每次滚动都会重渲染**。如果每帧都读
//  process.env，读取本身不贵，但注释想强调的是「读出来的值必须稳定」——
//  否则滚动过程中环境变量变了（几乎不可能）会导致虚拟列表中途切换模式，
//  那一瞬间的 DOM 树结构变化会让所有 item 重新挂载。
  const disableVirtualScroll = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL), []);
  // Virtual scroll replaces the transcript cap: everything is scrollable and
  // memory is bounded by the mounted-item count, not the total. scrollRef is
  // only passed when isFullscreenEnvEnabled() is true (REPL.tsx gates it),
  // so scrollRef's presence is the signal.
// 【用「prop 在不在」当开关，是有意的设计】
//
//  scrollRef 只在 isFullscreenEnvEnabled() 为真时才由 REPL.tsx 传进来。
//  所以这里不需要再读一遍环境变量 —— **传了就是全屏模式**。
//
//  好处：这个组件在测试里可以单独决定走哪条路径，不用改环境变量。
//  代价：读代码时必须回到调用点才能知道 scrollRef 何时非空（这是隐式契约）。
//
//  注释里明说了 "so scrollRef's presence is the signal" —— 这类隐式契约
//  如果不写下来，是纯粹的阅读障碍。
  const virtualScrollRuntimeGate = scrollRef != null && !disableVirtualScroll;
// 【三个条件的层次，别读成并列】
//
//  shouldTruncate = transcript && 没展开 && 没虚拟列表
//
//  三者不是平级：
//  · transcript 是「在哪个屏幕」
//  · !showAllInTranscript 是「用户按没按 ctrl+e」
//  · !virtualScrollRuntimeGate 是「有没有更好的机制接管截断」
//
//  第三个的意思是：有虚拟列表时**不需要**这层 30 条的截断，因为虚拟列表
//  本身就把内存管住了，而且它能让用户滚到全部历史。此时再截断是纯损失。
  const shouldTruncate = isTranscriptMode && !showAllInTranscript && !virtualScrollRuntimeGate;

  // Anchor for the first rendered message in the non-virtualized cap slice.
  // Monotonic advance only — mutation during render is idempotent (safe
  // under StrictMode double-render). See MAX_MESSAGES_WITHOUT_VIRTUALIZATION
  // comment above for why this replaced count-based slicing.
  const sliceAnchorRef = useRef<SliceAnchor>(null);

  // Expensive message transforms — filter, reorder, group, collapse, lookups.
  // All O(n) over 27k messages. Split from the renderRange slice so scrolling
  // (which only changes renderRange) doesn't re-run these. Previously this
  // useMemo included renderRange → every scroll rebuilt 6 Maps over 27k
  // messages + 4 filter/map passes = ~50ms alloc per scroll → GC pressure →
  // 100-173ms stop-the-world pauses on the 1GB heap.
// 【这个大 useMemo 的拆分理由，注释给了具体数字】
//
//  拆之前：依赖里含 renderRange → 每次滚动重算 6 个 Map + 4 趟 filter/map，
//  27k 条消息约 50ms 分配 → GC 压力 → 1GB 堆上 100-173ms 的 stop-the-world。
//
//  拆之后：这个 memo 只管「内容」的变化（消息、模式、verbose），
//  renderRange 进下一个 memo（第 532 行那个）。
//
//  **拆 memo 的依据不是「职责清晰」，是「变化频率不同」。** 滚动时变的东西
//  和内容变化时变的东西，必须分开放，否则高频的那个会把低频那个的成果
//  每次都作废。这条规律在整份 UI 层反复出现。
  const {
    collapsed: collapsed_0,
    lookups: lookups_0,
    hasTruncatedMessages: hasTruncatedMessages_0,
    hiddenMessageCount: hiddenMessageCount_0
  } = useMemo(() => {
    // In fullscreen mode the alt buffer has no native scrollback, so the
    // compact-boundary filter just hides history the ScrollBox could
    // otherwise scroll to. Main-screen mode keeps the filter — pre-compact
    // rows live above the viewport in native scrollback there, and
    // re-rendering them triggers full resets.
    // includeSnipped: UI rendering keeps snipped messages for scrollback
    // (this PR's core goal — full history in UI, filter only for the model).
    // Also avoids a UUID mismatch: normalizeMessages derives new UUIDs, so
    // projectSnippedView's check against original removedUuids would fail.
// 【同一个东西，两种屏幕模式下处理相反】
//
//  · 主屏（default）：保留 compact 边界过滤。压缩前的行已经被写进终端
//    的原生 scrollback 了，重画它们只会触发全量重置。
//  · 全屏（fullscreen）：不过滤。alt buffer **没有原生 scrollback**，
//    过滤掉就等于那些历史彻底消失 —— 而 ScrollBox 本来就能滚到它们。
//
//  includeSnipped 的理由在注释最后一段，是个容易被忽略的连锁反应：
//  normalizeMessages 派生了新 uuid，而 projectSnippedView 是拿**原始**
//  removedUuids 去比的，比不到 → 被 snip 掉的消息会漏出来。
//
//  **凡是「先派生新标识再拿旧标识去查」的地方，都会静默失配。**
    const compactAwareMessages = verbose || isFullscreenEnvEnabled() ? normalizedMessages : getMessagesAfterCompactBoundary(normalizedMessages, {
      includeSnipped: true
    });
// 【progress 消息在这里被剔除，但它不是「不显示」】
//
//  ProgressMessage 是工具执行过程中的进度（hook 输出、流式内容）。它们的
//  内容会被 buildMessageLookups 收集，然后通过 progressMessagesForMessage
//  塞进**对应那条 tool_use 的渲染**里。
//
//  所以剔除的只是「独立成行」，不是丢弃。这类「从列表里移除但内容另有
//  去处」的操作，读的时候要跟一脚 —— 否则会以为进度信息被吞了。
    const messagesToShowNotTruncated = reorderMessagesInUI(compactAwareMessages.filter((msg_2): msg_2 is Exclude<NormalizedMessage, ProgressMessageType> => msg_2.type !== 'progress')
    // CC-724: drop attachment messages that AttachmentMessage renders as
    // null (hook_success, hook_additional_context, hook_cancelled, etc.)
    // BEFORE counting/slicing so they don't inflate the "N messages"
    // count in ctrl-o or consume slots in the 200-message render cap.
// 【isNullRenderingAttachment 必须在「计数」之前】
//
//  注释里的 CC-724 说明得很细：hook_success / hook_additional_context /
//  hook_cancelled 这些附件，AttachmentMessage 渲染时返回 null。
//
//  如果先计数再过滤，ctrl+o 顶部会显示「还有 37 条隐藏消息」，而实际展开
//  后什么都没多出来 —— 用户会以为有 bug。如果先切片再过滤，200 条的上限
//  会被这些空附件占掉。
//
//  判据的通用形式：**任何「渲染为 null」的元素，都必须在计数和切片之前
//  移除**，否则它既占位置又不显示。
    .filter(msg_3 => !isNullRenderingAttachment(msg_3)).filter(_ => shouldShowUserMessage(_, isTranscriptMode)), syntheticStreamingToolUseMessages);
    // Three-tier filtering. Transcript mode (ctrl+o screen) is truly unfiltered.
    // Brief-only: SendUserMessage + user input only. Default: drop redundant
    // assistant text in turns where SendUserMessage was called (the model's
    // text is working-notes that duplicate the SendUserMessage content).
    const briefToolNames = [BRIEF_TOOL_NAME, SEND_USER_FILE_TOOL_NAME].filter((n): n is string => n !== null);
    // dropTextInBriefTurns should only trigger on SendUserMessage turns —
    // SendUserFile delivers a file without replacement text, so dropping
    // assistant text for file-only turns would leave the user with no context.
    const dropTextToolNames = [BRIEF_TOOL_NAME].filter((n_0): n_0 is string => n_0 !== null);
    const briefFiltered = briefToolNames.length > 0 && !isTranscriptMode ? isBriefOnly ? filterForBriefTool(messagesToShowNotTruncated, briefToolNames) : dropTextToolNames.length > 0 ? dropTextInBriefTurns(messagesToShowNotTruncated, dropTextToolNames) : messagesToShowNotTruncated : messagesToShowNotTruncated;
    const messagesToShow = shouldTruncate ? briefFiltered.slice(-MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE) : briefFiltered;
    const hasTruncatedMessages = shouldTruncate && briefFiltered.length > MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE;
    const {
      messages: groupedMessages
    } = applyGrouping(messagesToShow, tools, verbose);
// 【四个 collapse 叠在一起，从内到外读】
//
//  collapseReadSearchGroups → collapseTeammateShutdowns
//    → collapseHookSummaries → collapseBackgroundBashNotifications
//
//  最容易读错的是最内层：它接收的是 `groupedMessages`（已经过
//  applyGrouping），而外三层接收的是上一层的输出。
//
//  为什么这个顺序：read/search 折叠是**按工具类型**合，不依赖 hook 摘要；
//  hook 摘要需要先看到全部 hook 结果才能合并；bash 通知要在最后，因为它
//  依赖前面合并后的结构判断「这组里还有没有别的东西」。
//
//  每一层都可能改变 collapsed.length 而**不新增消息** —— 这就是第 278 行
//  那段注释里「量化切片仍然会挪」的原因。
    const collapsed = collapseBackgroundBashNotifications(collapseHookSummaries(collapseTeammateShutdowns(collapseReadSearchGroups(groupedMessages, tools))), verbose);
// 【lookups 用的是 normalizedMessages，不是 messagesToShow】
//
//  这个区别很关键：lookups 要能回答「任意 tool_use_id 对应的 tool 是什么、
//  它 resolve 了没有」，所以它必须覆盖**全部**消息，包括被 compact 过滤掉
//  的和被 cap 切掉的。
//
//  否则会看到一个诡异现象：滚到窗口顶部附近时，某条 tool_result 找不到
//  对应的 tool_use（因为 tool_use 在切片外面），渲染退化成通用文本。
//
//  第二个参数 messagesToShow 是给「这个窗口里有哪些 tool_use」这类**局部**
//  查询用的。一个函数，两个作用域，别混。
    const lookups = buildMessageLookups(normalizedMessages, messagesToShow);
    const hiddenMessageCount = messagesToShowNotTruncated.length - MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE;
    return {
      collapsed,
      lookups,
      hasTruncatedMessages,
      hiddenMessageCount
    };
  }, [verbose, normalizedMessages, isTranscriptMode, syntheticStreamingToolUseMessages, shouldTruncate, tools, isBriefOnly]);

  // Cheap slice — only runs when scroll range or slice config changes.
// 【「cheap slice」这个名字是相对的】
//
//  它确实只做 slice，但依赖里含 collapsed_0 —— 而 collapsed_0 来自上一个
//  大 memo。所以滚动时命中的是缓存（collapsed_0 引用不变），只有内容变化
//  时才会重跑这个 slice。
//
//  两个 memo 的分工：上面管「算出该显示什么」，这里管「显示其中的哪一段」。
  const renderableMessages = useMemo(() => {
    // Safety cap for the non-virtualized render path. Applied here (not at
    // the JSX site) so renderMessageRow's index-based lookups and
    // dividerBeforeIndex compute on the same array. VirtualMessageList
    // never sees this slice — virtualScrollRuntimeGate is constant for the
    // component's lifetime (scrollRef is either always passed or never).
    // renderRange is first: the chunked export path slices the
    // post-grouping array so each chunk gets correct tool-call grouping.
    const capApplies = !virtualScrollRuntimeGate && !disableRenderCap;
// 【切片只在不走虚拟列表、且没被显式关掉时才做】
//
//  disableRenderCap 的用途在 Props 注释里（第 259 行）：一次性 headless
//  渲染（/export）没有 scrollback 可依赖，内存顾虑也不成立，所以要能关。
//
//  注意 capApplies 的两项条件是**与**关系，但来源完全不同：一个是运行时
//  结构（有没有虚拟列表），一个是调用方意图（要不要被截断）。把它们并成
//  一行 if 是省事，但读的时候要分清哪个是「不能截」哪个是「不必截」。
    const sliceStart = capApplies ? computeSliceStart(collapsed_0, sliceAnchorRef) : 0;
    return renderRange ? collapsed_0.slice(renderRange[0], renderRange[1]) : sliceStart > 0 ? collapsed_0.slice(sliceStart) : collapsed_0;
  }, [collapsed_0, renderRange, virtualScrollRuntimeGate, disableRenderCap]);
  const streamingToolUseIDs = useMemo(() => new Set(streamingToolUses.map(__0 => __0.contentBlock.id)), [streamingToolUses]);

  // Divider insertion point: first renderableMessage whose uuid shares the
  // 24-char prefix with firstUnseenUuid (deriveUUID keeps the first 24
  // chars of the source message uuid, so this matches any block from it).
// 【24 个字符，是 deriveUUID 保留的前缀长度】
//
//  为什么不用全 uuid：unseenDivider 记的是「第一条未读消息的 uuid」，而实际
//  渲染的 RenderableMessage 可能是那条消息**派生**出来的（同一个 assistant
//  消息被拆成多个块，每块一个 uuid）。
//
//  派生规则是「保留前 24 字符 + 后缀」，所以按前 24 字符比，能把「源消息」
//  和它的所有派生块一起命中。
//
//  这个数字是**跨两个模块的隐式契约**（deriveUUID 那边定义长度，这边按长度
//  切片）。改动任何一侧都会静默失效 —— 不会报错，只是分隔线不出现在该出现
//  的位置。
  const dividerBeforeIndex = useMemo(() => {
    if (!unseenDivider) return -1;
    const prefix = unseenDivider.firstUnseenUuid.slice(0, 24);
    return renderableMessages.findIndex(m => m.uuid.slice(0, 24) === prefix);
  }, [unseenDivider, renderableMessages]);
  const selectedIdx = useMemo(() => {
    if (!cursor) return -1;
    return renderableMessages.findIndex(m_0 => m_0.uuid === cursor.uuid);
  }, [cursor, renderableMessages]);

  // Fullscreen: click a message to toggle verbose rendering for it. Keyed by
  // tool_use_id where available so a tool_use and its tool_result (separate
  // rows) expand together; falls back to uuid for groups/thinking. Stale keys
  // are harmless — they never match anything in renderableMessages.
// 【展开状态存在 Messages 这一层，不是每行自己存】
//
//  因为「点 tool_use 展开，它的 tool_result 也一起展开」—— 两行是两个组件
//  实例，各自存状态就无法联动。key 用 tool_use_id 把它们绑在一起。
//
//  `expandedKeys` 用 ReadonlySet + 整体替换，是为了让 isItemExpanded 的
//  依赖只有一个引用，能命中 useCallback 的缓存。
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const onItemClick = useCallback((msg_4: RenderableMessage) => {
    const k = expandKey(msg_4);
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);else next.add(k);
      return next;
    });
  }, []);
  const isItemExpanded = useCallback((msg_5: RenderableMessage) => expandedKeys.size > 0 && expandedKeys.has(expandKey(msg_5)), [expandedKeys]);
  // Only hover/click messages where the verbose toggle reveals more:
  // collapsed read/search groups, or tool results that self-report truncation
  // via isResultTruncated. Callback must be stable across message updates: if
  // its identity (or return value) flips during streaming, onMouseEnter
  // attaches after the mouse is already inside → hover never fires. tools is
  // session-stable; lookups is read via ref so the callback doesn't churn on
  // every new message.
// 【ref 而不是依赖：为了 callback 的身份稳定】
//
//  注释里那句 "if its identity (or return value) flips during streaming,
//  onMouseEnter attaches after the mouse is already inside → hover never
//  fires" 描述的是一个**终端特有的竞态**：
//
//  鼠标进入事件是一瞬间的事。如果那一刻的 handler 是旧的（或者组件因为
//  callback 换身份而重挂载），这个事件就丢了 —— 而终端不会补发「你现在
//  还在里面吗」。
//
//  DOM 里有 mouseenter/相关的一套补偿机制（relatedTarget），终端里没有。
//  所以终端的 hover 状态完全依赖「进入事件被正确接收」，对身份稳定性比
//  浏览器苛刻得多。
  const lookupsRef = useRef(lookups_0);
  lookupsRef.current = lookups_0;
  const isItemClickable = useCallback((msg_6: RenderableMessage): boolean => {
    if (msg_6.type === 'collapsed_read_search') return true;
    if (msg_6.type === 'assistant') {
      const b = msg_6.message.content[0] as unknown as AdvisorBlock | undefined;
      return b != null && isAdvisorBlock(b) && b.type === 'advisor_tool_result' && b.content.type === 'advisor_result';
    }
    if (msg_6.type !== 'user') return false;
    const b_0 = msg_6.message.content[0];
    if (b_0?.type !== 'tool_result' || b_0.is_error || !msg_6.toolUseResult) return false;
    const name = lookupsRef.current.toolUseByToolUseID.get(b_0.tool_use_id)?.name;
    const tool = name ? findToolByName(tools, name) : undefined;
    return tool?.isResultTruncated?.(msg_6.toolUseResult as never) ?? false;
  }, [tools]);
// 【三个「不许动」的条件，分别对应三种会打架的动画源】
//
//  · toolJSX 存在但没说要继续动画 → 有工具面板在显示，且它自己不动
//  · toolUseConfirmQueue 非空 → 有确认框在等用户输入
//  · isMessageSelectorVisible → 消息选择器打开着
//
//  共同点是：这些情况下屏幕上有**别的**动画/交互在进行，再让 spinner 转
//  会让画面变成多个不同频率的闪烁源。
//
//  注意第一个条件是 `!toolJSX || !!toolJSX.shouldContinueAnimation` ——
//  用的是「或」，即「没面板」或「面板自己也要动」都允许。
  const canAnimate = (!toolJSX || !!toolJSX.shouldContinueAnimation) && !toolUseConfirmQueue.length && !isMessageSelectorVisible;
  const hasToolsInProgress = inProgressToolUseIDs.size > 0;

  // Report progress to terminal (for terminals that support OSC 9;4)
  const {
    progress
  } = useTerminalNotification();
  const prevProgressState = useRef<string | null>(null);
// 【进度上报的三个否定条件，其中两个是「会打架」，一个是「没意义」】
//
//  · terminalProgressBarEnabled 关闭 → 用户不要
//  · getIsRemoteMode() → 远端模式下进度条在**服务端**的终端里，不是这里
//  · isProactiveActive() → 主动模式下没有「等待用户」这个概念
//
//  第二个容易忽略：remote 模式下这个进程不是用户正在看的那个终端，发
//  OSC 9;4 只会让另一台机器上的进度条乱跳。
  const progressEnabled = getGlobalConfig().terminalProgressBarEnabled && !getIsRemoteMode() && !(proactiveModule?.isProactiveActive() ?? false);
  useEffect(() => {
    const state = progressEnabled ? hasToolsInProgress ? 'indeterminate' : 'completed' : null;
    if (prevProgressState.current === state) return;
    prevProgressState.current = state;
    progress(state);
  }, [progress, progressEnabled, hasToolsInProgress]);
  useEffect(() => {
    return () => progress(null);
  }, [progress]);
  const messageKey = useCallback((msg_7: RenderableMessage) => `${msg_7.uuid}-${conversationId}`, [conversationId]);
// 【renderMessageRow 不是组件，是「渲染函数」】
//
//  它被两处以不同方式调用：`flatMap(renderMessageRow)`（每项返回一个元素）
//  和 `renderItem={renderMessageRow}`（虚拟列表逐项调）。
//
//  所以它的返回值必须兼容两种消费方式 —— 而且注意它**可能返回数组**
//  （第 632 行那个 unseenDivider 分支）。flatMap 会把数组摊平，虚拟列表那边
//  则是把一个数组当一个 item 渲染。这是两种语义，靠调用方恰好都能接受。
//
//  这种「一个函数两种消费契约」是隐式的，改动返回值形状时要两个调用方都看。
  const renderMessageRow = (msg_8: RenderableMessage, index: number) => {
    const prevType = index > 0 ? renderableMessages[index - 1]?.type : undefined;
    const isUserContinuation = msg_8.type === 'user' && prevType === 'user';
    // hasContentAfter is only consumed for collapsed_read_search groups;
    // skip the scan for everything else. streamingText is rendered as a
    // sibling after this map, so it's never in renderableMessages — OR it
    // in explicitly so the group flips to past tense as soon as text starts
    // streaming instead of waiting for the block to finalize.
// 【这个扫描只对 collapsed_read_search 做】
//
//  因为只有折叠组需要判断「我是不是最后一个还在动的东西」—— 如果是，它
//  保持现在时（"Reading…"）；如果后面还有内容，它切过去时（"Read 3 files"）。
//
//  对其他类型算这个值是纯浪费（要扫到数组末尾）。所以条件是
//  `msg.type === 'collapsed_read_search' && (...)`，短路掉。
//
//  streamingText 被显式 OR 进来，理由在注释里：它是渲染在这个 map 之外的
//  兄弟节点，不在 renderableMessages 里，扫不到。不加这一项，文字开始流式
//  之后折叠组还要等一个渲染周期才切时态。
    const hasContentAfter = msg_8.type === 'collapsed_read_search' && (!!streamingText || hasContentAfterIndex(renderableMessages, index, tools, streamingToolUseIDs));
    const k_0 = messageKey(msg_8);
// 【verbose 的三个来源，用 OR 叠起来】
//
//  verbose（全局） || isItemExpanded(单条展开) || (光标在这一行且光标态是展开)
//
//  第三个条件里的 `cursor?.expanded === true && index === selectedIdx` 要注意
//  优先级：`||` 是左结合的，所以它是 `(verbose || isItemExpanded) || (cursor
//  条件)`，语义正确但读起来容易误判成 `cursor?.expanded === (true && ...)`。
//
//  这也是为什么 `cursor?.expanded === true` 要显式写 `=== true` —— 如果写
//  `cursor?.expanded`，类型是 boolean | undefined，参与 || 时语义相同，但
//  和后面的 `&&` 混在一起时优先级就更容易看错。
    const row = <MessageRow key={k_0} message={msg_8} isUserContinuation={isUserContinuation} hasContentAfter={hasContentAfter} tools={tools} commands={commands} verbose={verbose || isItemExpanded(msg_8) || cursor?.expanded === true && index === selectedIdx} inProgressToolUseIDs={inProgressToolUseIDs} streamingToolUseIDs={streamingToolUseIDs} screen={screen} canAnimate={canAnimate} onOpenRateLimitOptions={onOpenRateLimitOptions} lastThinkingBlockId={lastThinkingBlockId} latestBashOutputUUID={latestBashOutputUUID} columns={columns} isLoading={isLoading} lookups={lookups_0} />;

    // Per-row Provider — only 2 rows re-render on selection change.
    // Wrapped BEFORE divider branch so both return paths get it.
// 【Provider 必须在 MessageRow 外面，理由和 React 的 context 语义有关】
//
//  选中状态如果当 prop 传进 MessageRow，就得加进 memo 比较器 —— 而那是每行
//  都要比一次的字段，2800 条消息就是 2800 次比较。
//
//  放成 context 之后，机制是三步：
//
//  1. value 变 → Provider 重渲染 → 新的 row 元素传给 MessageRow
//  2. MessageRow 的 memo 比较器看 message 引用没变，**bail out**（不重渲染）
//  3. 但 React 的 context 更新会**穿透** bail out 的子树，直接通知消费者
//
//  第 3 步是关键，也最容易误解：memo 拦住的是 prop 驱动的重渲染，拦不住
//  context 传播。所以「跳过重渲染」和「拿到新值」可以同时成立。
//
//  代价：只有真正调了 useSelectedMessageBg 的组件更新，其余整行一个字都不
//  重算 —— 这就是注释里 "only 2 rows re-render" 的来源。
    const wrapped = <MessageActionsSelectedContext.Provider key={k_0} value={index === selectedIdx}>
        {row}
      </MessageActionsSelectedContext.Provider>;
// 【返回数组而不是 Fragment，是有理由的】
//
//  注释在第 691 行那段：用数组 + 各自的 key，可以让分隔线成为一个**独立
//  的兄弟节点**。这样分隔线出现/消失时，两侧的 MessageRow 的 key 不变，
//  React 不会重挂载它们。
//
//  如果用 Fragment 包起来，分隔线增删会让整个 Fragment 的 children 数量
//  变化 —— React 仍然能按 key 复用，但 Ink 的宿主实现里，兄弟节点数量的
//  变化会触发 insertBefore / removeChild 的组合操作，比单纯 append 更容易
//  踩到「yoga 下标换算」的坑（见 dom.ts 的批注）。
    if (unseenDivider && index === dividerBeforeIndex) {
      return [<Box key="unseen-divider" marginTop={1}>
          <Divider title={`${unseenDivider.count} new ${plural(unseenDivider.count, 'message')}`} width={columns} color="inactive" />
        </Box>, wrapped];
    }
    return wrapped;
  };

  // Search indexing: for tool_result messages, look up the Tool and use
  // its extractSearchText — tool-owned, precise, matches what
  // renderToolResultMessage shows. Falls back to renderableSearchText
  // (duck-types toolUseResult) for tools that haven't implemented it,
  // and for all non-tool-result message types. The drift-catcher test
  // (toolSearchText.test.tsx) renders + compares to keep these in sync.
  //
  // A second-React-root reconcile approach was tried and ruled out
  // (measured 3.1ms/msg, growing — flushSyncWork processes all roots;
  // component hooks mutate shared state → main root accumulates updates).
// 【WeakMap 键是消息对象，不是 uuid】
//
//  用对象当键，好处是消息被移出数组后缓存自动回收（没有手动清理逻辑）；
//  坏处是**每次消息对象换新引用（流式更新），缓存就失效**。
//
//  这里是划算的：搜索文本只在搜索期间被读，而搜索期间消息基本不再变化。
//
//  另外注意 `useRef(new WeakMap())` —— 每次 render 都会 new 一个 WeakMap，
//  只是 ref 只保留第一个。这是个常见的小浪费（一个对象分配 + 一次 GC），
//  不影响正确性，但能看出这里没走「惰性初始化」的写法。
  const searchTextCache = useRef(new WeakMap<RenderableMessage, string>());
  const extractSearchText = useCallback((msg_9: RenderableMessage): string => {
    const cached = searchTextCache.current.get(msg_9);
    if (cached !== undefined) return cached;
    let text_0 = renderableSearchText(msg_9);
    // If this is a tool_result message and the tool implements
    // extractSearchText, prefer that — it's precise (tool-owned)
    // vs renderableSearchText's field-name heuristic.
    if (msg_9.type === 'user' && msg_9.toolUseResult && Array.isArray(msg_9.message.content)) {
      const tr = msg_9.message.content.find(b_1 => b_1.type === 'tool_result');
      if (tr && 'tool_use_id' in tr) {
        const tu = lookups_0.toolUseByToolUseID.get(tr.tool_use_id);
        const tool_0 = tu && findToolByName(tools, tu.name);
        const extracted = tool_0?.extractSearchText?.(msg_9.toolUseResult as never);
        // undefined = tool didn't implement → keep heuristic. Empty
        // string = tool says "nothing to index" → respect that.
// 【undefined 和空字符串的区别，是这段代码里唯一一处「三态」】
//
//  · undefined  → 工具没实现 extractSearchText，用启发式的 renderableSearchText
//  · ''         → 工具说「这条结果没什么可索引的」，尊重它，索引为空
//  · 其他       → 用工具给的
//
//  如果把 '' 也当成「没实现」，日志类的大段输出会被启发式扫出几千个字，
//  搜索时到处命中。三态在这里不是洁癖，是必需的。
        if (extracted !== undefined) text_0 = extracted;
      }
    }
    // Cache LOWERED: setSearchQuery's hot loop indexOfs per keystroke.
    // Lowering here (once, at warm) vs there (every keystroke) trades
    // ~same steady-state memory for zero per-keystroke alloc. Cache
    // GC's with messages on transcript exit. Tool methods return raw;
    // renderableSearchText already lowercases (redundant but cheap).
// 【在缓存里存小写，而不是每次查的时候转】
//
//  注释给了权衡："~same steady-state memory for zero per-keystroke alloc"。
//
//  关键在于**读的次数远多于写**：缓存写一次，搜索时每敲一个键要对所有消息
//  做 indexOf。把 toLowerCase 挪到写侧，等于把 N 次分配变成 1 次。
//
//  这是「预计算放在哪一侧」的标准答案：**在频率低的那一侧做，在频率高的
//  那一侧用**。
    const lowered = text_0.toLowerCase();
    searchTextCache.current.set(msg_9, lowered);
    return lowered;
  }, [tools, lookups_0]);
  return <>
      {/* Logo */}
// 【chunk 0 才画 logo】
//
//  renderRange 是分块导出的（/export 大对话时分片渲染）。第 0 片是对话开头，
//  画 logo；后续分片是「流的中段」，画 logo 会让导出文件里出现多个 logo。
//
//  判据是 `renderRange[0] > 0`，而 renderRange 为 undefined 时（正常渲染）
//  条件里的第一项 `renderRange &&` 直接短路成 undefined，取反为 true → 画。
      {!hideLogo && !(renderRange && renderRange[0] > 0) && <LogoHeader agentDefinitions={agentDefinitions} />}

      {/* Truncation indicator */}
      {hasTruncatedMessages_0 && <Divider title={`${toggleShowAllShortcut} to show ${chalk.bold(hiddenMessageCount_0)} previous messages`} width={columns} />}

      {/* Show all indicator */}
      {isTranscriptMode && showAllInTranscript && hiddenMessageCount_0 > 0 &&
    // disableRenderCap (e.g. [ dump-to-scrollback) means we're uncapped
    // as a one-shot escape hatch, not a toggle — ctrl+e is dead and
    // nothing is actually "hidden" to restore.
    !disableRenderCap && <Divider title={`${toggleShowAllShortcut} to hide ${chalk.bold(hiddenMessageCount_0)} previous messages`} width={columns} />}

      {/* Messages - rendered as memoized MessageRow components.
          flatMap inserts the unseen-divider as a separate keyed sibling so
          (a) non-fullscreen renders pay no per-message Fragment wrap, and
          (b) divider toggle in fullscreen preserves all MessageRows by key.
          Pre-compute derived values instead of passing renderableMessages to
          each row - React Compiler pins props in the fiber's memoCache, so
          passing the array would accumulate every historical version
          (~1-2MB over a 7-turn session). */}
// 【两条渲染路径，差别不只是「性能」】
//
//  · 虚拟列表：只有视口附近的 item 挂载。ScrollBox 自己裁剪，没有终端
//    scrollback，所以不能靠「滚出去的内容还在原生缓冲区里」这个假设。
//  · flatMap：全部挂载，靠终端原生 scrollback 承载历史，靠 cap 限制上界。
//
//  注意 InVirtualListContext 只在这一条分支里提供，值恒为 true。它的消费
//  者是 OffscreenFreeze —— 虚拟列表里不应该冻结（见 OffscreenFreeze 的
//  注释：冻结会挡住点击展开，因为两套可见性计算会打架）。
      {virtualScrollRuntimeGate ? <InVirtualListContext.Provider value={true}>
          <VirtualMessageList messages={renderableMessages} scrollRef={scrollRef} columns={columns} itemKey={messageKey} renderItem={renderMessageRow} onItemClick={onItemClick} isItemClickable={isItemClickable} isItemExpanded={isItemExpanded} trackStickyPrompt={trackStickyPrompt} selectedIndex={selectedIdx >= 0 ? selectedIdx : undefined} cursorNavRef={cursorNavRef} setCursor={setCursor} jumpRef={jumpRef} onSearchMatchesChange={onSearchMatchesChange} scanElement={scanElement} setPositions={setPositions} extractSearchText={extractSearchText} />
        </InVirtualListContext.Provider> : renderableMessages.flatMap(renderMessageRow)}

// 【streamingText 渲染在 map 之外，是有意的】
//
//  Props 注释说 "rendered as last item so transition to final message is
//  positionally seamless" —— 它必须出现在所有消息之后，且样式和最终消息
//  一致。这样「流式文本」变成「正式消息」时，那一行在原地不动。
//
//  如果把它塞进 renderableMessages，它会拿到一个 uuid，转换时要换 key，
//  于是 React 会「卸载旧的 + 挂载新的」—— 屏幕上表现为那一块闪一下。
//
//  这是「用位置保证视觉连续」的例子：宁可让渲染路径多一个兄弟节点，也不
//  让同一个视觉元素换身份。
      {streamingText && !isBriefOnly && <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
          <Box flexDirection="row">
            <Box minWidth={2}>
              <Text color="text">{BLACK_CIRCLE}</Text>
            </Box>
            <Box flexDirection="column">
              <StreamingMarkdown>{streamingText}</StreamingMarkdown>
            </Box>
          </Box>
        </Box>}

      {isStreamingThinkingVisible && streamingThinking && !isBriefOnly && <Box marginTop={1}>
          <AssistantThinkingMessage param={{
        type: 'thinking',
        thinking: streamingThinking.thinking
      }} addMargin={false} isTranscriptMode={true} verbose={verbose} hideInTranscript={false} />
        </Box>}
    </>;
};

/** Key for click-to-expand: tool_use_id where available (so tool_use + its
 *  tool_result expand together), else uuid for groups/thinking. */
// 【tool_use_id 优先，uuid 兜底】
//
//  因为 tool_use 和它的 tool_result 是**两条不同的消息**（不同 uuid），
//  但它们应该一起展开/折叠。tool_use_id 是它们共享的字段。
//
//  grouped_tool_use / collapsed_read_search / thinking 没有 tool_use_id
//  （或者有多个），只能用 uuid。
//
//  注意 getToolUseID 只对 assistant / user 返回非空 —— 所以这个三元实际上
//  是「先判类型，再取 id」。
function expandKey(msg: RenderableMessage): string {
  return (msg.type === 'assistant' || msg.type === 'user' ? getToolUseID(msg) : null) ?? msg.uuid;
}

// Custom comparator to prevent unnecessary re-renders during streaming.
// Default React.memo does shallow comparison which fails when:
// 1. onOpenRateLimitOptions callback is recreated (doesn't affect render output)
// 2. streamingToolUses array is recreated on every delta, but only contentBlock matters for rendering
// 3. streamingThinking changes on every delta - we DO want to re-render for this
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
// 【自定义比较器比默认的浅比较**更宽松**】
//
//  默认浅比较：任何 prop 换引用就重渲染。
//  这里：换引用之后还要再检查「内容是否等价」，等价则跳过。
//
//  三个等价判断对应三种「必然换引用但内容可能没变」的情况：
//  · streamingToolUses —— 每个 delta 都新建数组
//  · inProgressToolUseIDs —— 每次工具状态变化都新建 Set
//  · unseenDivider —— 每次全屏布局重算都新建对象
//  · tools —— 会话级稳定，但数组本身可能被重建
//
//  而 streamingThinking **故意不做**等价判断（注释第 772 行）—— 它一变就
//  必须重渲染，因为它的内容就是屏幕内容。
export const Messages = React.memo(MessagesImpl, (prev, next) => {
  const keys = Object.keys(prev) as (keyof typeof prev)[];
  for (const key of keys) {
// 【豁免列表里的九个 prop，分三类】
//
//  1. 回调类：onOpenRateLimitOptions / setCursor / onSearchMatchesChange /
//     scanElement / setPositions —— 换引用不影响输出
//  2. ref 类：scrollRef / cursorNavRef / jumpRef —— 同上
//  3. 跟踪开关：trackStickyPrompt —— 变化时不需要重算消息
//
//  这个列表是**手写的**，所以它和 Props 定义之间存在漂移风险：新增一个
//  回调 prop 而忘了加进来，会导致每次父组件重渲染都打穿这层 memo。
//
//  注意 `cursor` 不在豁免列表里 —— 选中变化需要重渲染，这是对的。
    if (key === 'onOpenRateLimitOptions' || key === 'scrollRef' || key === 'trackStickyPrompt' || key === 'setCursor' || key === 'cursorNavRef' || key === 'jumpRef' || key === 'onSearchMatchesChange' || key === 'scanElement' || key === 'setPositions') continue;
    if (prev[key] !== next[key]) {
      if (key === 'streamingToolUses') {
        const p = prev.streamingToolUses;
        const n = next.streamingToolUses;
        if (p.length === n.length && p.every((item, i) => item.contentBlock === n[i]?.contentBlock)) {
          continue;
        }
      }
      if (key === 'inProgressToolUseIDs') {
        if (setsEqual(prev.inProgressToolUseIDs, next.inProgressToolUseIDs)) {
          continue;
        }
      }
      if (key === 'unseenDivider') {
        const p = prev.unseenDivider;
        const n = next.unseenDivider;
        if (p?.firstUnseenUuid === n?.firstUnseenUuid && p?.count === n?.count) {
          continue;
        }
      }
      if (key === 'tools') {
        const p = prev.tools;
        const n = next.tools;
        if (p.length === n.length && p.every((tool, i) => tool.name === n[i]?.name)) {
          continue;
        }
      }
      // streamingThinking changes frequently - always re-render when it changes
      // (no special handling needed, default behavior is correct)
      return false;
    }
  }
  return true;
});
// 【「静态」的意思是：这一行以后不会再变了，可以一次性写进 scrollback】
//
//  这是整个 UI 层最重要的一个判据。它决定的不只是「要不要重渲染」，而是
//  **这一行能不能被 Ink 的 log-update 当作不可变内容推到终端上方**。
//
//  一旦判定为静态，这一行会被写进终端原生 scrollback —— 之后再想改它，
//  只能靠全量重置（因为它已经在视口之外了）。所以这里宁可保守：
//  拿不准就返回 false（动态）。
//
//  五个 case 分别的保守程度都不同，见下面几处锚点。
export function shouldRenderStatically(message: RenderableMessage, streamingToolUseIDs: Set<string>, inProgressToolUseIDs: Set<string>, siblingToolUseIDs: ReadonlySet<string>, screen: Screen, lookups: ReturnType<typeof buildMessageLookups>): boolean {
  if (screen === 'transcript') {
    return true;
  }
  switch (message.type) {
    case 'attachment':
    case 'user':
    case 'assistant':
      {
        if (message.type === 'assistant') {
          const block = message.message.content[0];
// 【server_tool_use 单独判，因为它没有 tool_result 走同一套 lookup】
//
//  服务端工具（web_search 这类）由 API 侧执行，结果直接内联在后续的
//  assistant 消息里，不产生独立的 tool_result 消息。所以「等 resolve」
//  这件事只能看 resolvedToolUseIDs 里有没有这个 id。
//
//  如果漏了这个特判，它会落到下面 getToolUseID 的分支 —— 而
//  getToolUseID 对 server_tool_use 返回什么取决于实现，很可能返回 null
//  → 直接判为静态 → 结果还没回来就被推上 scrollback → 结果到了只能全量重置。
          if (block?.type === 'server_tool_use') {
            return lookups.resolvedToolUseIDs.has(block.id);
          }
        }
        const toolUseID = getToolUseID(message);
        if (!toolUseID) {
          return true;
        }
        if (streamingToolUseIDs.has(toolUseID)) {
          return false;
        }
        if (inProgressToolUseIDs.has(toolUseID)) {
          return false;
        }

        // Check if there are any unresolved PostToolUse hooks for this tool use
        // If so, keep the message transient so the HookProgressMessage can update
// 【PostToolUse hook 没跑完，这条消息就不能算静态】
//
//  因为 hook 的执行进度会作为 ProgressMessage 显示在这条 tool_use 下面。
//  一旦推上 scrollback，进度更新就得靠全量重置。
//
//  这条判据比前面几条更隐蔽：它依赖的是**另一个维度的数据**（lookups 里的
//  hook 状态），而不是消息本身。读的时候容易以为「tool 已经 resolve 了就
//  完事了」。
        if (hasUnresolvedHooksFromLookup(toolUseID, 'PostToolUse', lookups)) {
          return false;
        }
// 【最后一道：所有兄弟 tool_use 都 resolve 了才算静态】
//
//  为什么看兄弟：同一个 assistant 消息里的多个 tool_use 是并行执行的，只要
//  还有一个在跑，整组的高度就可能变（下面要插进度行）。把其中一个单独推上
//  scrollback，剩下的再撑高，屏幕就错位了。
//
//  `every(集合, 另一个集合)` 是 src/utils/set.js 里的工具，语义是「集合 A
//  的每个元素都在 B 里」。注意它是「A 全部包含于 B」，不是「A == B」。
        return every(siblingToolUseIDs, lookups.resolvedToolUseIDs);
      }
    case 'system':
      {
        // api errors always render dynamically, since we hide
        // them as soon as we see another non-error message.
// 【api_error 永远动态，理由和别的相反】
//
//  其他 system 消息判静态是因为「它不会再变」；api_error 判动态是因为
//  「它随时会消失」—— 只要看到下一条非错误消息，这条就被隐藏了。
//
//  所以它的「不再变」是假的：它会被**移除**。静态化之后移除只能全量重置。
//
//  这是本函数里唯一一个「内容不变但存在性会变」的 case，判据从「内容是否
//  稳定」换成了「这条消息还会不会存在」。
        return message.subtype !== 'api_error';
      }
    case 'grouped_tool_use':
      {
        const allResolved = message.messages.every(msg => {
          const content = msg.message.content[0];
          return content?.type === 'tool_use' && lookups.resolvedToolUseIDs.has(content.id);
        });
        return allResolved;
      }
// 【在 prompt 模式永远不静态，transcript 模式永远静态 —— 两个方向都极端】
//
//  顶部的 `if (screen === 'transcript') return true` 已经拦掉了后一半，所以
//  走到这里的只可能是 prompt 模式，直接 false。
//
//  理由在注释里："to prevent flicker between API turns"。折叠组的时态
//  （"Reading…" → "Read 3 files"）和它的可点击性都在变，一旦推上 scrollback，
//  每次时态切换都要全量重置 —— 而折叠组恰恰是最频繁切换的东西（每次工具
//  开始/结束）。
    case 'collapsed_read_search':
      {
        // In prompt mode, never mark as static to prevent flicker between API turns
        // (In transcript mode, we already returned true at the top of this function)
        return false;
      }
  }
}
// 原文件此处有一行 104604 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。