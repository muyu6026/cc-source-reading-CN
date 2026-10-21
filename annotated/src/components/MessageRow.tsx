// ═══════════════════════════════════════════════════════════════
//  MessageRow：列表里的一行，以及「这一行还会不会变」的判定
// ═══════════════════════════════════════════════════════════════
//
//  它在管线里的位置很具体：
//
//    Messages 算出 renderableMessages（该显示哪些）
//      → MessageRow 决定这一行**要不要重新渲染**（memo 比较器）
//      → Message 按消息类型分发到具体组件
//
//  所以这个文件真正的产出不是 JSX，是一个布尔判断：**这一行以后还会变吗**。
//  答案会影响两件事 —— 要不要重渲染，以及（更重要的）能不能把它推上终端
//  scrollback 之后再也不管。
//
//  382 行里有 120 行是三个导出的辅助函数（hasContentAfterIndex /
//  isMessageStreaming / allToolsResolved），它们都是「判定」而不是「渲染」。
//  比例正好说明这个文件的重点在哪。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import type { Command } from '../commands.js';
import { Box } from '../ink.js';
import type { Screen } from '../screens/REPL.js';
import type { Tools } from '../Tool.js';
import type { RenderableMessage } from '../types/message.js';
import { getDisplayMessageFromCollapsed, getToolSearchOrReadInfo, getToolUseIdsFromCollapsedGroup, hasAnyToolInProgress } from '../utils/collapseReadSearch.js';
import { type buildMessageLookups, EMPTY_STRING_SET, getProgressMessagesFromLookup, getSiblingToolUseIDsFromLookup, getToolUseID } from '../utils/messages.js';
import { hasThinkingContent, Message } from './Message.js';
import { MessageModel } from './MessageModel.js';
import { shouldRenderStatically } from './Messages.js';
import { MessageTimestamp } from './MessageTimestamp.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
export type Props = {
  message: RenderableMessage;
  /** Whether the previous message in renderableMessages is also a user message. */
  isUserContinuation: boolean;
  /**
   * Whether there is non-skippable content after this message in renderableMessages.
   * Only needs to be accurate for `collapsed_read_search` messages — used to decide
   * if the collapsed group spinner should stay active. Pass `false` otherwise.
   */
  hasContentAfter: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  streamingToolUseIDs: Set<string>;
  screen: Screen;
  canAnimate: boolean;
  onOpenRateLimitOptions?: () => void;
  lastThinkingBlockId: string | null;
  latestBashOutputUUID: string | null;
  columns: number;
  isLoading: boolean;
  lookups: ReturnType<typeof buildMessageLookups>;
};

// 【为什么要把扫描结果做成一个布尔 prop，而不是把数组传进去】
//
//  注释说的是 "React Compiler would pin in the fiber's memoCache,
//  accumulating every historical version of the array" —— 这句话是理解
//  React Compiler 产物的一把钥匙。
//
//  React Compiler 会把「用过的值」按位置存进 `$[i]`，用于下次比较。如果
//  某个 prop 是一个大数组，那么**这个数组的每一个历史版本**都被钉在对应
//  fiber 的缓存里，直到组件卸载。
//
//  7 轮对话约 1-2MB —— 单条不算多，但这是每行一份。2800 行就是 GB 级。
//
//  可推广的规律：**传给叶子组件的大对象，会被记忆化机制钉住**。所以
//  「按行展开成标量」不只是可读性问题，是内存问题。
/**
 * Scans forward from `index+1` to check if any "real" content follows. Used to
 * decide whether a collapsed read/search group should stay in its active
 * (grey dot, present-tense "Reading…") state while the query is still loading.
 *
 * Exported so Messages.tsx can compute this once per message and pass the
 * result as a boolean prop — avoids passing the full `renderableMessages` array
 * to each MessageRow (which React Compiler would pin in the fiber's memoCache,
 * accumulating every historical version of the array ≈ 1-2MB over a 7-turn session).
 */
// 【四种「跳过」对应四种「它在路上但还没到」】
//
//  1. thinking / redacted_thinking —— 思考过程不算内容
//  2. 可折叠的 tool_use（read / search）—— 它们会并进当前折叠组
//  3. 流式中的 tool_use —— 它的 id 还没进 inProgressToolUseIDs，但马上会
//  4. system / attachment / tool_result / 可折叠的 grouped_tool_use
//
//  第 3 条最微妙：注释说 "syntheticStreamingToolUseMessages 会在 ID 被加进
//  inProgressToolUseIDs 之前就把它放进列表"。也就是说存在一个时间窗口，
//  这个 tool_use 已经出现在屏幕上，但「它在执行中」这件事还没登记。
//
//  如果不跳过，那个窗口里折叠组会被判成「后面没内容了」→ 时态从
//  "Reading…" 闪成 "Read 3 files" → 一秒后又闪回来。
export function hasContentAfterIndex(messages: RenderableMessage[], index: number, tools: Tools, streamingToolUseIDs: Set<string>): boolean {
  for (let i = index + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.type === 'assistant') {
      const content = msg.message.content[0];
      if (content?.type === 'thinking' || content?.type === 'redacted_thinking') {
        continue;
      }
      if (content?.type === 'tool_use') {
        if (getToolSearchOrReadInfo(content.name, content.input, tools).isCollapsible) {
          continue;
        }
        // Non-collapsible tool uses appear in syntheticStreamingToolUseMessages
        // before their ID is added to inProgressToolUseIDs. Skip while streaming
        // to avoid briefly finalizing the read group.
        if (streamingToolUseIDs.has(content.id)) {
          continue;
        }
      }
      return true;
    }
    if (msg?.type === 'system' || msg?.type === 'attachment') {
      continue;
    }
    // Tool results arrive while the collapsed group is still being built
    if (msg?.type === 'user') {
      const content = msg.message.content[0];
      if (content?.type === 'tool_result') {
        continue;
      }
    }
    // Collapsible grouped_tool_use messages arrive transiently before being
    // merged into the current collapsed group on the next render cycle
    if (msg?.type === 'grouped_tool_use') {
      const firstInput = msg.messages[0]?.message.content[0]?.input;
      if (getToolSearchOrReadInfo(msg.toolName, firstInput, tools).isCollapsible) {
        continue;
      }
    }
    return true;
  }
  return false;
}
// 【这个函数是被 React Compiler 编译过的，不是手写形态】
//
//  `const $ = _c(64)` 建了 64 个缓存槽；后面每一段 `if ($[n] !== x)` 都是
//  「上次算的值和这次一样就复用」。
//
//  读这种代码的方法：**跳过所有 `$[n]` 的赋值和读取，只看 `if` 条件里出现
//  的真实变量，以及 else 分支里 `tX = $[M]` 对应的原始表达式**。
//
//  举个具体的：第 117-128 行那段，把 `$[...]` 全部删掉之后剩下的是
//
//      isActiveCollapsedGroup =
//        isCollapsed && (hasAnyToolInProgress(msg, inProgressToolUseIDs)
//                        || (isLoading && !hasContentAfter))
//
//  这才是作者写的东西。所有编译器产物都是在给这一行加缓存。
function MessageRowImpl(t0) {
  const $ = _c(64);
  const {
    message: msg,
    isUserContinuation,
    hasContentAfter,
    tools,
    commands,
    verbose,
    inProgressToolUseIDs,
    streamingToolUseIDs,
    screen,
    canAnimate,
    onOpenRateLimitOptions,
    lastThinkingBlockId,
    latestBashOutputUUID,
    columns,
    isLoading,
    lookups
  } = t0;
  const isTranscriptMode = screen === "transcript";
  const isGrouped = msg.type === "grouped_tool_use";
  const isCollapsed = msg.type === "collapsed_read_search";
  let t1;
// 【「活跃折叠组」的两个条件，第二个容易看漏】
//
//  · hasAnyToolInProgress —— 组里有工具在跑，正常
//  · isLoading && !hasContentAfter —— **没有工具在跑，但整体还在加载，
//    而且后面没有别的内容**
//
//  第二个条件覆盖的是「工具都跑完了，模型正在想下一步」这个空档。此时折叠
//  组如果切成过去时，用户会以为这一轮结束了；实际上屏幕下面马上还会有东西。
//
//  `!hasContentAfter` 是必要的限定：如果后面已经有内容（比如流式文本），
//  那就该切时态了，因为用户已经能看到「还在继续」。
  if ($[0] !== hasContentAfter || $[1] !== inProgressToolUseIDs || $[2] !== isCollapsed || $[3] !== isLoading || $[4] !== msg) {
    t1 = isCollapsed && (hasAnyToolInProgress(msg, inProgressToolUseIDs) || isLoading && !hasContentAfter);
    $[0] = hasContentAfter;
    $[1] = inProgressToolUseIDs;
    $[2] = isCollapsed;
    $[3] = isLoading;
    $[4] = msg;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const isActiveCollapsedGroup = t1;
  let t2;
// 【displayMsg 的三种来源，第三种是「它就是自己」】
//
//  · grouped_tool_use → msg.displayMessage（分组时预先合成的展示消息）
//  · collapsed_read_search → getDisplayMessageFromCollapsed(msg)（现场合成）
//  · 其他 → msg
//
//  注意前两种是**虚拟消息**：它们不在 messages 数组里，只在渲染时需要。
//  这就是为什么下游要用 displayMsg 而不是 msg 来判断「有没有元数据」——
//  虚拟消息的 timestamp / model 是从成员消息里挑出来的。
  if ($[6] !== isCollapsed || $[7] !== isGrouped || $[8] !== msg) {
    t2 = isGrouped ? msg.displayMessage : isCollapsed ? getDisplayMessageFromCollapsed(msg) : msg;
    $[6] = isCollapsed;
    $[7] = isGrouped;
    $[8] = msg;
    $[9] = t2;
  } else {
    t2 = $[9];
  }
  const displayMsg = t2;
  let t3;
// 【聚合类型没有进度消息，所以给个空数组】
//
//  getProgressMessagesFromLookup 是按单条消息的 tool_use_id 去查的，而
//  grouped / collapsed 是一个组，没有单一 id。
//
//  给 `[]` 而不是 undefined，是因为下游按数组用（遍历）。一个常量空数组
//  （不是每次 new []）能让 React Compiler 的缓存命中。
  if ($[10] !== isCollapsed || $[11] !== isGrouped || $[12] !== lookups || $[13] !== msg) {
    t3 = isGrouped || isCollapsed ? [] : getProgressMessagesFromLookup(msg, lookups);
    $[10] = isCollapsed;
    $[11] = isGrouped;
    $[12] = lookups;
    $[13] = msg;
    $[14] = t3;
  } else {
    t3 = $[14];
  }
  const progressMessagesForMessage = t3;
  let t4;
// 【EMPTY_STRING_SET 是常量，不是每次 new Set()】
//
//  同一个理由：聚合类型不需要兄弟集合，但下游要一个可遍历的 Set。给常量
//  空集，成本是零，而且引用稳定 —— 如果每次 new，`shouldRenderStatically`
//  的结果虽然一样，但 memo 缓存会因为入参换引用而失效。
//
//  这类「空值常量」看起来是小事，实际上是 memo 化代码里的必需品。
  if ($[15] !== inProgressToolUseIDs || $[16] !== isCollapsed || $[17] !== isGrouped || $[18] !== lookups || $[19] !== msg || $[20] !== screen || $[21] !== streamingToolUseIDs) {
    const siblingToolUseIDs = isGrouped || isCollapsed ? EMPTY_STRING_SET : getSiblingToolUseIDsFromLookup(msg, lookups);
    t4 = shouldRenderStatically(msg, streamingToolUseIDs, inProgressToolUseIDs, siblingToolUseIDs, screen, lookups);
    $[15] = inProgressToolUseIDs;
    $[16] = isCollapsed;
    $[17] = isGrouped;
    $[18] = lookups;
    $[19] = msg;
    $[20] = screen;
    $[21] = streamingToolUseIDs;
    $[22] = t4;
  } else {
    t4 = $[22];
  }
  const isStatic = t4;
// 【shouldAnimate 的三种情况，本质是「这一行有没有在动的东西」】
//
//  · grouped：组里任何一个 tool_use 还在 inProgress
//  · collapsed：组里任何一个工具在跑
//  · 单条：**没有 tool_use，或者它的 id 在 inProgress 里**
//
//  第三种的反向逻辑值得注意：`!toolUseID || inProgressToolUseIDs.has(toolUseID)`
//  —— 「没有 tool_use」也算在动。因为纯文本消息在流式追加时，它就是「在动」
//  的那一个。
//
//  而 canAnimate 是全局开关（有确认框、有面板、有选择器时为 false）。
  let shouldAnimate = false;
  if (canAnimate) {
    if (isGrouped) {
      let t5;
      if ($[23] !== inProgressToolUseIDs || $[24] !== msg.messages) {
        let t6;
        if ($[26] !== inProgressToolUseIDs) {
          t6 = m => {
            const content = m.message.content[0];
            return content?.type === "tool_use" && inProgressToolUseIDs.has(content.id);
          };
          $[26] = inProgressToolUseIDs;
          $[27] = t6;
        } else {
          t6 = $[27];
        }
        t5 = msg.messages.some(t6);
        $[23] = inProgressToolUseIDs;
        $[24] = msg.messages;
        $[25] = t5;
      } else {
        t5 = $[25];
      }
      shouldAnimate = t5;
    } else {
      if (isCollapsed) {
        let t5;
        if ($[28] !== inProgressToolUseIDs || $[29] !== msg) {
          t5 = hasAnyToolInProgress(msg, inProgressToolUseIDs);
          $[28] = inProgressToolUseIDs;
          $[29] = msg;
          $[30] = t5;
        } else {
          t5 = $[30];
        }
        shouldAnimate = t5;
      } else {
        let t5;
        if ($[31] !== inProgressToolUseIDs || $[32] !== msg) {
          const toolUseID = getToolUseID(msg);
          t5 = !toolUseID || inProgressToolUseIDs.has(toolUseID);
          $[31] = inProgressToolUseIDs;
          $[32] = msg;
          $[33] = t5;
        } else {
          t5 = $[33];
        }
        shouldAnimate = t5;
      }
    }
  }
  let t5;
// 【hasMetadata 只在 transcript 模式出现，且四个条件全要满足】
//
//  transcript + assistant + 内容里有 text 块 + 有 timestamp 或 model
//
//  第三个条件（要有 text）排除的是「纯 tool_use 的 assistant 消息」—— 那种
//  消息在 transcript 里不需要单独标时间和模型，因为它下面紧跟的就是结果。
//
//  第四个条件是「至少有一个」：老消息可能没有 timestamp，但有 model；都有
//  才算。
  if ($[34] !== displayMsg || $[35] !== isTranscriptMode) {
    t5 = isTranscriptMode && displayMsg.type === "assistant" && displayMsg.message.content.some(_temp) && (displayMsg.timestamp || displayMsg.message.model);
    $[34] = displayMsg;
    $[35] = isTranscriptMode;
    $[36] = t5;
  } else {
    t5 = $[36];
  }
  const hasMetadata = t5;
// 【addMargin 和 containerWidth 是**反向**的，这个设计容易读错】
//
//  hasMetadata = true  → addMargin = false，containerWidth = undefined
//  hasMetadata = false → addMargin = true， containerWidth = columns
//
//  带元数据的那条路径自己有一个外层 Box（width={columns} + 顶部 margin），
//  所以内层不许再加边距、宽度走 100%（由外层决定）。
//
//  不带元数据的路径省掉了外层 Box，所以内层要自己带上边距、自己拿绝对宽度。
//
//  Props 注释里 "When provided, eliminates a wrapper Box in the caller" 说的
//  就是这个：**用绝对宽度换掉一层 Box**。一层 Box 在 2800 行里的成本是
//  2800 次 yoga 节点创建 + 布局。
  const t6 = !hasMetadata;
  const t7 = hasMetadata ? undefined : columns;
  let t8;
  if ($[37] !== commands || $[38] !== inProgressToolUseIDs || $[39] !== isActiveCollapsedGroup || $[40] !== isStatic || $[41] !== isTranscriptMode || $[42] !== isUserContinuation || $[43] !== lastThinkingBlockId || $[44] !== latestBashOutputUUID || $[45] !== lookups || $[46] !== msg || $[47] !== onOpenRateLimitOptions || $[48] !== progressMessagesForMessage || $[49] !== shouldAnimate || $[50] !== t6 || $[51] !== t7 || $[52] !== tools || $[53] !== verbose) {
    t8 = <Message message={msg} lookups={lookups} addMargin={t6} containerWidth={t7} tools={tools} commands={commands} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={progressMessagesForMessage} shouldAnimate={shouldAnimate} shouldShowDot={true} isTranscriptMode={isTranscriptMode} isStatic={isStatic} onOpenRateLimitOptions={onOpenRateLimitOptions} isActiveCollapsedGroup={isActiveCollapsedGroup} isUserContinuation={isUserContinuation} lastThinkingBlockId={lastThinkingBlockId} latestBashOutputUUID={latestBashOutputUUID} />;
    $[37] = commands;
    $[38] = inProgressToolUseIDs;
    $[39] = isActiveCollapsedGroup;
    $[40] = isStatic;
    $[41] = isTranscriptMode;
    $[42] = isUserContinuation;
    $[43] = lastThinkingBlockId;
    $[44] = latestBashOutputUUID;
    $[45] = lookups;
    $[46] = msg;
    $[47] = onOpenRateLimitOptions;
    $[48] = progressMessagesForMessage;
    $[49] = shouldAnimate;
    $[50] = t6;
    $[51] = t7;
    $[52] = tools;
    $[53] = verbose;
    $[54] = t8;
  } else {
    t8 = $[54];
  }
  const messageEl = t8;
// 【两个 return 路径，差别不只是有没有元数据行】
//
//  无元数据：`OffscreenFreeze > messageEl` —— 只有一层，宽度 100%。
//  有元数据：`OffscreenFreeze > Box(width) > [元数据行, messageEl]`。
//
//  注意 OffscreenFreeze 在两条路径上都有，而且都在**最外层**。它必须包住
//  整个可视内容，否则冻结时只冻一半，剩下的还在触发重渲染。
//
//  另外这两条路径的返回元素结构不同 —— 如果某条消息在运行过程中从「有
//  元数据」变成「没元数据」（比如 timestamp 补上了），React 会卸载整棵子树
//  重建。实际上这个转换只在 transcript 模式下发生，且立刻完成一次。
  if (!hasMetadata) {
    let t9;
    if ($[55] !== messageEl) {
      t9 = <OffscreenFreeze>{messageEl}</OffscreenFreeze>;
      $[55] = messageEl;
      $[56] = t9;
    } else {
      t9 = $[56];
    }
    return t9;
  }
  let t9;
  if ($[57] !== displayMsg || $[58] !== isTranscriptMode) {
// 【元数据行右对齐，gap={1}】
//
//  justifyContent="flex-end" 让它靠右。`<MessageTimestamp />` 和
//  `<MessageModel />` 各自决定显示什么（时间可能是相对时间，模型可能被
//  缩写），这里只负责排版。
//
//  marginTop={1} 让这一行和上面的消息之间有空白，视觉上把「元数据」和
//  「内容」分开。
    t9 = <Box flexDirection="row" justifyContent="flex-end" gap={1} marginTop={1}><MessageTimestamp message={displayMsg} isTranscriptMode={isTranscriptMode} /><MessageModel message={displayMsg} isTranscriptMode={isTranscriptMode} /></Box>;
    $[57] = displayMsg;
    $[58] = isTranscriptMode;
    $[59] = t9;
  } else {
    t9 = $[59];
  }
  let t10;
  if ($[60] !== columns || $[61] !== messageEl || $[62] !== t9) {
    t10 = <OffscreenFreeze><Box width={columns} flexDirection="column">{t9}{messageEl}</Box></OffscreenFreeze>;
    $[60] = columns;
    $[61] = messageEl;
    $[62] = t9;
    $[63] = t10;
  } else {
    t10 = $[63];
  }
  return t10;
}

/**
 * Checks if a message is "streaming" - i.e., its content may still be changing.
 * Exported for testing.
 */
function _temp(c) {
  return c.type === "text";
}
// 【三个判定函数都标了 "Exported for testing"】
//
//  和 Messages.tsx 里的 computeSliceStart 一样：这份源码是打包产物反推的，
//  **测试文件被剥掉了**。所以这些 export 在仓库里没有消费者。
//
//  读的时候不要误判成「死代码」—— 它们的活性体现在「被导出的目的是可测」，
//  而不是「被别的模块调用」。这和真正的死代码（shouldClearScreen 那种
//  判据已经内联到别处）是两回事。
//
//  分辨方法：看它有没有注释说明用途。写了 "for testing" 的，是测试入口；
//  什么都不说又没人调用的，才可能是死代码。
export function isMessageStreaming(msg: RenderableMessage, streamingToolUseIDs: Set<string>): boolean {
  if (msg.type === 'grouped_tool_use') {
    return msg.messages.some(m => {
      const content = m.message.content[0];
      return content?.type === 'tool_use' && streamingToolUseIDs.has(content.id);
    });
  }
  if (msg.type === 'collapsed_read_search') {
    const toolIds = getToolUseIdsFromCollapsedGroup(msg);
    return toolIds.some(id => streamingToolUseIDs.has(id));
  }
  const toolUseID = getToolUseID(msg);
  return !!toolUseID && streamingToolUseIDs.has(toolUseID);
}

/**
 * Checks if all tools in a message are resolved.
 * Exported for testing.
 */
// 【allToolsResolved 比 isMessageStreaming 多一个 server_tool_use 分支】
//
//  原因和 Messages.tsx 第 790 行那个特判一样：服务端工具没有独立的
//  tool_result 消息，它的「resolved」只能靠 id 在不在集合里判断。
//
//  而 getToolUseID 对 server_tool_use 大概率返回 null，于是
//  `!toolUseID` 为真 → 直接判 resolved。**这是错的**：结果还没回来就判完成。
//
//  所以这两个函数的差异不是风格问题，是必须的补丁。
export function allToolsResolved(msg: RenderableMessage, resolvedToolUseIDs: Set<string>): boolean {
  if (msg.type === 'grouped_tool_use') {
    return msg.messages.every(m => {
      const content = m.message.content[0];
      return content?.type === 'tool_use' && resolvedToolUseIDs.has(content.id);
    });
  }
  if (msg.type === 'collapsed_read_search') {
    const toolIds = getToolUseIdsFromCollapsedGroup(msg);
    return toolIds.every(id => resolvedToolUseIDs.has(id));
  }
  if (msg.type === 'assistant') {
    const block = msg.message.content[0];
    if (block?.type === 'server_tool_use') {
      return resolvedToolUseIDs.has(block.id);
    }
  }
  const toolUseID = getToolUseID(msg);
  return !toolUseID || resolvedToolUseIDs.has(toolUseID);
}

/**
 * Conservative memo comparator that only bails out when we're CERTAIN
 * the message won't change. Fails safe by re-rendering when uncertain.
 *
 * Exported for testing.
 */
// 【注释第一句就点明了策略：只在**确定**不变时才跳过】
//
//  "Fails safe by re-rendering when uncertain." —— 这个方向的偏向是对的，
//  因为判错的两种代价不对称：
//
//  · 该跳过没跳过 → 多渲染一次，慢一点
//  · 不该跳过却跳过 → 屏幕上留着旧内容，且**没有任何机制会再修正它**
//    （因为这一行可能已经推上 scrollback）
//
//  所以这里所有的判据都是「一旦有疑问就 return false」。
export function areMessageRowPropsEqual(prev: Props, next: Props): boolean {
  // Different message reference = content may have changed, must re-render
  if (prev.message !== next.message) return false;

  // Screen mode change = re-render
  if (prev.screen !== next.screen) return false;

  // Verbose toggle changes thinking block visibility
  if (prev.verbose !== next.verbose) return false;

  // collapsed_read_search is never static in prompt mode (matches shouldRenderStatically)
// 【collapsed_read_search 在 prompt 模式永远放行】
//
//  这和 shouldRenderStatically 里那个 `return false` 是同一个判据的两处表达：
//  那边管「能不能静态化」，这边管「能不能跳过重渲染」。两处必须一致。
//
//  如果只改一处：判成静态（推上 scrollback）但 memo 又允许跳过重渲染 ——
//  那么时态永远停在 "Reading…"，因为没有东西会重渲染它。
//
//  **同一个判据在两个地方表达时，改动必须成对。** 这是这份代码里最容易
//  出错的结构（第 373 行的 isStreaming 判定也是同理，只是它复用了函数）。
  if (prev.message.type === 'collapsed_read_search' && next.screen !== 'transcript') {
    return false;
  }

  // Width change affects Box layout
  if (prev.columns !== next.columns) return false;

  // latestBashOutputUUID affects rendering (full vs truncated output)
// 【比的是「我是不是最新的那条」，不是「最新的是谁」】
//
//  这个区别很重要：
//
//    prevIsLatestBash = (prev.latestBashOutputUUID === prev.message.uuid)
//
//  左边是布尔，右边是字符串。如果直接比字符串，那么「最新 bash 从 A 换成 B」
//  时，**所有行**的 latestBashOutputUUID 都变了 → 所有行都要重渲染。
//
//  化简成布尔之后，只有 A 和 B 两行的判定结果发生变化，其余行不受影响。
//
//  这是「把 prop 化简成这个组件真正关心的形式」的范例。Message.tsx 的
//  比较器里有完全相同的重复实现（第 616 行），因为两个组件各自需要它。
  const prevIsLatestBash = prev.latestBashOutputUUID === prev.message.uuid;
  const nextIsLatestBash = next.latestBashOutputUUID === next.message.uuid;
  if (prevIsLatestBash !== nextIsLatestBash) return false;

  // lastThinkingBlockId affects thinking block visibility — but only for
  // messages that HAVE thinking content. Checking unconditionally busts the
  // memo for every scrollback message whenever thinking starts/stops (CC-941).
// 【lastThinkingBlockId 的变化只对「有 thinking 内容」的消息有意义】
//
//  注释里的 CC-941 说：不加这个门，每次 thinking 开始/结束时**所有**
//  scrollback 里的消息都要重渲染 —— 因为那个 id 是一个全局值，一处变化
//  全体都受影响。
//
//  加上 hasThinkingContent 之后，只有真正含 thinking 块的消息会放行。
//  在一条 2800 条消息的会话里，含 thinking 的可能只有几十条。
//
//  这个模式和上一条的 latestBashOutputUUID 是同一个手法：**用一个廉价
//  的本地判据，过滤掉全局状态变化带来的无关更新。**
  if (prev.lastThinkingBlockId !== next.lastThinkingBlockId && hasThinkingContent(next.message)) {
    return false;
  }

  // Check if this message is still "in flight"
// 【最后两道闸：还在流式 → 必须重渲染；工具没全 resolve → 必须重渲染】
//
//  注意这里重新算了一遍 isStreaming / isResolved，而不是从 props 里拿 ——
//  因为 Props 里没有这两个字段（它们在 MessageRow 内部算过，用于别处），
//  而且这两个判定依赖 streamingToolUseIDs / lookups，都在 props 里。
//
//  重复计算一次的代价（两个 Set 查询）远小于多一次完整渲染。
//
//  这两道闸的位置也有讲究：它们放在所有「便宜的比较」之后。前面那些
//  字符串/布尔的比较几乎不花钱，先做；这两个要遍历数组和集合，放最后。
  const isStreaming = isMessageStreaming(prev.message, prev.streamingToolUseIDs);
  const isResolved = allToolsResolved(prev.message, prev.lookups.resolvedToolUseIDs);

  // Only bail out for truly static messages
  if (isStreaming || !isResolved) return false;

  // Static message - safe to skip re-render
  return true;
}
export const MessageRow = React.memo(MessageRowImpl, areMessageRowPropsEqual);
// 原文件此处有一行 34112 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。