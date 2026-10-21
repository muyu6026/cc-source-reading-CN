// ═══════════════════════════════════════════════════════════════
//  Message：一个纯分发器，和它身后十四个渲染组件
// ═══════════════════════════════════════════════════════════════
//
//  这个文件本身几乎没有渲染逻辑 —— 它做的是**两次 switch**：
//
//  外层按消息类型：attachment / assistant / user / system /
//                  grouped_tool_use / collapsed_read_search
//  内层按块类型：  text / tool_use / thinking / redacted_thinking /
//                  server_tool_use / advisor_tool_result
//
//  真正画东西的是 `components/messages/` 下那十四个组件。所以读这个文件的
//  正确姿势是**只读分发条件**，把「怎么画」留给它们。
//
//  分发条件里藏着不少产品决策（thinking 什么时候显示、bash 输出什么时候
//  展开、compact 边界画不画），这些才是这个文件的价值。
//
//  另外，626 行里有 400 多行是 React Compiler 的缓存槽 —— 真实逻辑不到
//  200 行。读的时候必须能快速跳过 `$[n]` 的样板（方法见 MessageRow.tsx
//  第 93 行的批注）。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type { ImageBlockParam, TextBlockParam, ThinkingBlockParam, ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import type { Command } from '../commands.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box } from '../ink.js';
import type { Tools } from '../Tool.js';
import { type ConnectorTextBlock, isConnectorTextBlock } from '../types/connectorText.js';
import type { AssistantMessage, AttachmentMessage as AttachmentMessageType, CollapsedReadSearchGroup as CollapsedReadSearchGroupType, GroupedToolUseMessage as GroupedToolUseMessageType, NormalizedUserMessage, ProgressMessage, SystemMessage } from '../types/message.js';
import { type AdvisorBlock, isAdvisorBlock } from '../utils/advisor.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { logError } from '../utils/log.js';
import type { buildMessageLookups } from '../utils/messages.js';
import { CompactSummary } from './CompactSummary.js';
import { AdvisorMessage } from './messages/AdvisorMessage.js';
import { AssistantRedactedThinkingMessage } from './messages/AssistantRedactedThinkingMessage.js';
import { AssistantTextMessage } from './messages/AssistantTextMessage.js';
import { AssistantThinkingMessage } from './messages/AssistantThinkingMessage.js';
import { AssistantToolUseMessage } from './messages/AssistantToolUseMessage.js';
import { AttachmentMessage } from './messages/AttachmentMessage.js';
import { CollapsedReadSearchContent } from './messages/CollapsedReadSearchContent.js';
import { CompactBoundaryMessage } from './messages/CompactBoundaryMessage.js';
import { GroupedToolUseContent } from './messages/GroupedToolUseContent.js';
import { SystemTextMessage } from './messages/SystemTextMessage.js';
import { UserImageMessage } from './messages/UserImageMessage.js';
import { UserTextMessage } from './messages/UserTextMessage.js';
import { UserToolResultMessage } from './messages/UserToolResultMessage/UserToolResultMessage.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import { ExpandShellOutputProvider } from './shell/ExpandShellOutputContext.js';
export type Props = {
  message: NormalizedUserMessage | AssistantMessage | AttachmentMessageType | SystemMessage | GroupedToolUseMessageType | CollapsedReadSearchGroupType;
  lookups: ReturnType<typeof buildMessageLookups>;
  // TODO: Find a way to remove this, and leave spacing to the consumer
  /** Absolute width for the container Box. When provided, eliminates a wrapper Box in the caller. */
  containerWidth?: number;
  addMargin: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  progressMessagesForMessage: ProgressMessage[];
  shouldAnimate: boolean;
  shouldShowDot: boolean;
  style?: 'condensed';
  width?: number | string;
  isTranscriptMode: boolean;
  isStatic: boolean;
  onOpenRateLimitOptions?: () => void;
  isActiveCollapsedGroup?: boolean;
  isUserContinuation?: boolean;
  /** ID of the last thinking block (uuid:index) to show, used for hiding past thinking in transcript mode */
  lastThinkingBlockId?: string | null;
  /** UUID of the latest user bash output message (for auto-expanding) */
  latestBashOutputUUID?: string | null;
};
function MessageImpl(t0) {
  const $ = _c(94);
  const {
    message,
    lookups,
    containerWidth,
    addMargin,
    tools,
    commands,
    verbose,
    inProgressToolUseIDs,
    progressMessagesForMessage,
    shouldAnimate,
    shouldShowDot,
    style,
    width,
    isTranscriptMode,
    onOpenRateLimitOptions,
    isActiveCollapsedGroup,
    isUserContinuation: t1,
    lastThinkingBlockId,
    latestBashOutputUUID
  } = t0;
  const isUserContinuation = t1 === undefined ? false : t1;
// 【switch 的六个 case，覆盖了 RenderableMessage 的全部类型】
//
//  RenderableMessage 的联合类型里还有 'progress'，但它在 Messages.tsx 里
//  就被过滤掉了（第 499 行），所以这里不处理 —— 一旦漏过滤，会走到 switch
//  末尾之外，函数返回 undefined，React 报「渲染返回了 undefined」。
//
//  这种「上游过滤 + 下游 switch」的配合是隐式契约：switch 没有 default 分支
//  兜底，说明作者确信类型是穷尽的。TypeScript 能验证这一点（switch 覆盖
//  联合类型的所有成员时不会报错），但**运行时没有兜底**。
  switch (message.type) {
    case "attachment":
      {
        let t2;
        if ($[0] !== addMargin || $[1] !== isTranscriptMode || $[2] !== message.attachment || $[3] !== verbose) {
          t2 = <AttachmentMessage addMargin={addMargin} attachment={message.attachment} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
          $[0] = addMargin;
          $[1] = isTranscriptMode;
          $[2] = message.attachment;
          $[3] = verbose;
          $[4] = t2;
        } else {
          t2 = $[4];
        }
        return t2;
      }
    case "assistant":
      {
        const t2 = containerWidth ?? "100%";
        let t3;
        if ($[5] !== addMargin || $[6] !== commands || $[7] !== inProgressToolUseIDs || $[8] !== isTranscriptMode || $[9] !== lastThinkingBlockId || $[10] !== lookups || $[11] !== message.advisorModel || $[12] !== message.message.content || $[13] !== message.uuid || $[14] !== onOpenRateLimitOptions || $[15] !== progressMessagesForMessage || $[16] !== shouldAnimate || $[17] !== shouldShowDot || $[18] !== tools || $[19] !== verbose || $[20] !== width) {
          let t4;
          if ($[22] !== addMargin || $[23] !== commands || $[24] !== inProgressToolUseIDs || $[25] !== isTranscriptMode || $[26] !== lastThinkingBlockId || $[27] !== lookups || $[28] !== message.advisorModel || $[29] !== message.uuid || $[30] !== onOpenRateLimitOptions || $[31] !== progressMessagesForMessage || $[32] !== shouldAnimate || $[33] !== shouldShowDot || $[34] !== tools || $[35] !== verbose || $[36] !== width) {
// 【inProgressToolCallCount 传的是**全场**正在跑的工具数，不是这条消息的】
//
//  `inProgressToolUseIDs.size` —— 一个跨消息的全局计数。
//
//  用途在 AssistantToolUseMessage 里：多个工具并行时，UI 会显示「还有 N 个
//  在跑」这类信息。所以它需要的是全局数，不是局部数。
//
//  但这意味着**任何一个工具开始/结束，所有 tool_use 块的这个 prop 都变** ——
//  于是所有 tool_use 都要重渲染。这是一个明显但被接受的代价（并行工具通常
//  只有几个，且本来就在动）。
//
//  如果哪天并行工具数量上去了，这里是第一个要改的地方（改成只传「同消息内
//  的计数」）。
            t4 = (_, index_0) => <AssistantMessageBlock key={index_0} param={_} addMargin={addMargin} tools={tools} commands={commands} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={progressMessagesForMessage} shouldAnimate={shouldAnimate} shouldShowDot={shouldShowDot} width={width} inProgressToolCallCount={inProgressToolUseIDs.size} isTranscriptMode={isTranscriptMode} lookups={lookups} onOpenRateLimitOptions={onOpenRateLimitOptions} thinkingBlockId={`${message.uuid}:${index_0}`} lastThinkingBlockId={lastThinkingBlockId} advisorModel={message.advisorModel} />;
            $[22] = addMargin;
            $[23] = commands;
            $[24] = inProgressToolUseIDs;
            $[25] = isTranscriptMode;
            $[26] = lastThinkingBlockId;
            $[27] = lookups;
            $[28] = message.advisorModel;
            $[29] = message.uuid;
            $[30] = onOpenRateLimitOptions;
            $[31] = progressMessagesForMessage;
            $[32] = shouldAnimate;
            $[33] = shouldShowDot;
            $[34] = tools;
            $[35] = verbose;
            $[36] = width;
            $[37] = t4;
          } else {
            t4 = $[37];
          }
          t3 = message.message.content.map(t4);
          $[5] = addMargin;
          $[6] = commands;
          $[7] = inProgressToolUseIDs;
          $[8] = isTranscriptMode;
          $[9] = lastThinkingBlockId;
          $[10] = lookups;
          $[11] = message.advisorModel;
          $[12] = message.message.content;
          $[13] = message.uuid;
          $[14] = onOpenRateLimitOptions;
          $[15] = progressMessagesForMessage;
          $[16] = shouldAnimate;
          $[17] = shouldShowDot;
          $[18] = tools;
          $[19] = verbose;
          $[20] = width;
          $[21] = t3;
        } else {
          t3 = $[21];
        }
        let t4;
        if ($[38] !== t2 || $[39] !== t3) {
          t4 = <Box flexDirection="column" width={t2}>{t3}</Box>;
          $[38] = t2;
          $[39] = t3;
          $[40] = t4;
        } else {
          t4 = $[40];
        }
        return t4;
      }
    case "user":
      {
// 【isCompactSummary 要在所有其他判断之前】
//
//  因为压缩摘要是一条**伪装成 user 消息**的特殊消息：它有 user 类型、
//  有 content 数组，但内容是「之前对话的总结」，不是用户说的话。
//
//  如果让它走普通的 user 分支，会被当成用户输入渲染（带用户提示符）——
//  语义完全错。所以必须先拦。
//
//  注意它把 screen 转成了 'transcript' | 'prompt' 字符串传下去，而不是传
//  布尔。CompactSummary 需要区分这两种屏幕来调整样式。
        if (message.isCompactSummary) {
          const t2 = isTranscriptMode ? "transcript" : "prompt";
          let t3;
          if ($[41] !== message || $[42] !== t2) {
            t3 = <CompactSummary message={message} screen={t2} />;
            $[41] = message;
            $[42] = t2;
            $[43] = t3;
          } else {
            t3 = $[43];
          }
          return t3;
        }
// 【imageIndices 是一个和 content 等长的数组，元素是「第几张图」或「当前序号」】
//
//  为什么要这么绕：图片块需要编号（"image 1"、"image 2"），但编号不能简单
//  用「这是第几个 image 块」—— 因为 imagePasteIds 可能给了真实 id（用户
//  粘贴时的序号），也可能没有。
//
//  于是构造一个**平行数组**：遇到 image 块就 push 它的 id（没有则用递增
//  计数），遇到非 image 块就 push 当前计数（占位，不会被读）。
//
//  注意 `imagePosition++` 在 push id **之前**自增，所以缺 id 时用的是
//  「从 1 开始的第几张图」。而 push 到非 image 位置的值是自增**之后**的
//  计数 —— 如果第一个块不是图片，那个位置会是 1 而不是 0。这个偏差无害，
//  因为非图片位置的值永远不会被读。
        let imageIndices;
        if ($[44] !== message.imagePasteIds || $[45] !== message.message.content) {
          imageIndices = [];
          let imagePosition = 0;
          for (const param of message.message.content) {
            if (param.type === "image") {
              const id = message.imagePasteIds?.[imagePosition];
              imagePosition++;
              imageIndices.push(id ?? imagePosition);
            } else {
              imageIndices.push(imagePosition);
            }
          }
          $[44] = message.imagePasteIds;
          $[45] = message.message.content;
          $[46] = imageIndices;
        } else {
          imageIndices = $[46];
        }
// 【只有「最新的那条 bash 输出」才包 ExpandShellOutputProvider】
//
//  这个 Provider 提供的能力是「展开/折叠 shell 输出」（默认截断，可展开）。
//  只给最新一条包，理由是：老的 bash 输出已经折叠成一行摘要，用户要看
//  细节得先点开消息 —— 而最新的这条是「刚跑完，我可能想看全」。
//
//  注意判断用的是 `latestBashOutputUUID === message.uuid`，直接比 uuid
//  （不像 memo 比较器里那样化简成布尔）。因为这里比的是「我是不是那条」，
//  比一次就够了。
        const isLatestBashOutput = latestBashOutputUUID === message.uuid;
        const t2 = containerWidth ?? "100%";
        let t3;
        if ($[47] !== addMargin || $[48] !== imageIndices || $[49] !== isTranscriptMode || $[50] !== isUserContinuation || $[51] !== lookups || $[52] !== message || $[53] !== progressMessagesForMessage || $[54] !== style || $[55] !== tools || $[56] !== verbose) {
          t3 = message.message.content.map((param_0, index) => <UserMessage key={index} message={message} addMargin={addMargin} tools={tools} progressMessagesForMessage={progressMessagesForMessage} param={param_0} style={style} verbose={verbose} imageIndex={imageIndices[index]} isUserContinuation={isUserContinuation} lookups={lookups} isTranscriptMode={isTranscriptMode} />);
          $[47] = addMargin;
          $[48] = imageIndices;
          $[49] = isTranscriptMode;
          $[50] = isUserContinuation;
          $[51] = lookups;
          $[52] = message;
          $[53] = progressMessagesForMessage;
          $[54] = style;
          $[55] = tools;
          $[56] = verbose;
          $[57] = t3;
        } else {
          t3 = $[57];
        }
        let t4;
        if ($[58] !== t2 || $[59] !== t3) {
          t4 = <Box flexDirection="column" width={t2}>{t3}</Box>;
          $[58] = t2;
          $[59] = t3;
          $[60] = t4;
        } else {
          t4 = $[60];
        }
        const content = t4;
        let t5;
        if ($[61] !== content || $[62] !== isLatestBashOutput) {
          t5 = isLatestBashOutput ? <ExpandShellOutputProvider>{content}</ExpandShellOutputProvider> : content;
          $[61] = content;
          $[62] = isLatestBashOutput;
          $[63] = t5;
        } else {
          t5 = $[63];
        }
        return t5;
      }
    case "system":
      {
// 【compact_boundary 在 fullscreen 下直接不画】
//
//  这条分界线在主屏上的作用是「分割线 + 提示这里发生过压缩」，因为压缩前
//  的消息还在原生 scrollback 里，需要一条视觉分界。
//
//  全屏模式下没有原生 scrollback，而且 Messages.tsx 根本不过滤压缩前的消息
//  （第 496 行的批注），历史是全的 —— 再画一条「压缩边界」会让用户以为上面
//  的内容被删掉了。
//
//  **同一个数据，在不同的显示模型下语义相反。** 这是本文件里最典型的一例。
        if (message.subtype === "compact_boundary") {
          if (isFullscreenEnvEnabled()) {
            return null;
          }
          let t2;
          if ($[64] === Symbol.for("react.memo_cache_sentinel")) {
            t2 = <CompactBoundaryMessage />;
            $[64] = t2;
          } else {
            t2 = $[64];
          }
          return t2;
        }
// 【microcompact_boundary 永远不画】
//
//  和 compact 不同的地方：microcompact（微压缩，删掉旧的工具结果）是**用户
//  无感**的操作 —— 它不改变对话的语义，只是省 token。所以不需要任何视觉提示。
//
//  而 compact（全量压缩）会把历史换成摘要，用户必须知道。
//
//  「要不要给用户看」取决于这件事**改变了什么**，不取决于它重不重要。
        if (message.subtype === "microcompact_boundary") {
          return null;
        }
// 【feature() 门控里套 require，而且是在渲染函数内部】
//
//  这是 DCE 的第二种用法：模块级的 `feature()` 判断（Messages.tsx 第 80 行）
//  在**打包时**折叠；这里的判断也在打包时折叠，但 require 的位置在函数体内，
//  所以即使 feature 为真，模块也是**首次渲染时才加载**。
//
//  代价：这段代码不能出现在模块顶层，因为顶层 require 会在启动时就执行。
//  收益：不用 snip 功能的构建里，这两个模块（以及它们依赖的整棵子树）完全
//  不进产物。
//
//  注意 `$[65]` 那个缓存槽存的是 `require(...)` 的**模块对象** —— React
//  Compiler 把它当普通值缓存了。第一次渲染时加载，之后复用。
        if (feature("HISTORY_SNIP")) {
          const {
            isSnipBoundaryMessage
          } = require("../services/compact/snipProjection.js") as typeof import('../services/compact/snipProjection.js');
          const {
            isSnipMarkerMessage
          } = require("../services/compact/snipCompact.js") as typeof import('../services/compact/snipCompact.js');
          if (isSnipBoundaryMessage(message)) {
            let t2;
            if ($[65] === Symbol.for("react.memo_cache_sentinel")) {
              t2 = require("./messages/SnipBoundaryMessage.js");
              $[65] = t2;
            } else {
              t2 = $[65];
            }
            const {
              SnipBoundaryMessage
            } = t2 as typeof import('./messages/SnipBoundaryMessage.js');
            let t3;
            if ($[66] !== message) {
              t3 = <SnipBoundaryMessage message={message} />;
              $[66] = message;
              $[67] = t3;
            } else {
              t3 = $[67];
            }
            return t3;
          }
          if (isSnipMarkerMessage(message)) {
            return null;
          }
        }
// 【local_command 被伪装成 text 块，复用 UserTextMessage】
//
//  本地命令（比如 /help 的输出）在数据结构上是 system 消息，但显示上应该
//  和用户输入一样（带提示符、可复制）。所以这里现场造一个 `{type:'text'}`
//  对象传进去。
//
//  造出来的对象进 `$[68]` 缓存，依赖是 `message.content` —— 同样内容不会
//  重复造。这是 React Compiler 对「对象字面量」的标准处理：它知道新造的
//  对象每次引用不同，所以按内容依赖缓存。
        if (message.subtype === "local_command") {
          let t2;
          if ($[68] !== message.content) {
            t2 = {
              type: "text",
              text: message.content
            };
            $[68] = message.content;
            $[69] = t2;
          } else {
            t2 = $[69];
          }
          let t3;
          if ($[70] !== addMargin || $[71] !== isTranscriptMode || $[72] !== t2 || $[73] !== verbose) {
            t3 = <UserTextMessage addMargin={addMargin} param={t2} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
            $[70] = addMargin;
            $[71] = isTranscriptMode;
            $[72] = t2;
            $[73] = verbose;
            $[74] = t3;
          } else {
            t3 = $[74];
          }
          return t3;
        }
        let t2;
        if ($[75] !== addMargin || $[76] !== isTranscriptMode || $[77] !== message || $[78] !== verbose) {
          t2 = <SystemTextMessage message={message} addMargin={addMargin} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
          $[75] = addMargin;
          $[76] = isTranscriptMode;
          $[77] = message;
          $[78] = verbose;
          $[79] = t2;
        } else {
          t2 = $[79];
        }
        return t2;
      }
    case "grouped_tool_use":
      {
        let t2;
        if ($[80] !== inProgressToolUseIDs || $[81] !== lookups || $[82] !== message || $[83] !== shouldAnimate || $[84] !== tools) {
          t2 = <GroupedToolUseContent message={message} tools={tools} lookups={lookups} inProgressToolUseIDs={inProgressToolUseIDs} shouldAnimate={shouldAnimate} />;
          $[80] = inProgressToolUseIDs;
          $[81] = lookups;
          $[82] = message;
          $[83] = shouldAnimate;
          $[84] = tools;
          $[85] = t2;
        } else {
          t2 = $[85];
        }
        return t2;
      }
    case "collapsed_read_search":
      {
// 【collapsed_read_search 的 verbose 是「或」出来的】
//
//  `verbose || isTranscriptMode` —— 在 transcript 模式下强制展开。
//
//  理由是 transcript（ctrl+o）的定位就是「完整历史」，折叠组在那里展开才符合
//  预期。而 prompt 模式下折叠组是一行摘要。
//
//  注意这个计算在 `$[91]` 里缓存，依赖里有 t2（也就是这个或的结果）——
//  所以 verbose 变化和 screen 变化都会正确触发。
        const t2 = verbose || isTranscriptMode;
        let t3;
        if ($[86] !== inProgressToolUseIDs || $[87] !== isActiveCollapsedGroup || $[88] !== lookups || $[89] !== message || $[90] !== shouldAnimate || $[91] !== t2 || $[92] !== tools) {
          t3 = <OffscreenFreeze><CollapsedReadSearchContent message={message} inProgressToolUseIDs={inProgressToolUseIDs} shouldAnimate={shouldAnimate} verbose={t2} tools={tools} lookups={lookups} isActiveGroup={isActiveCollapsedGroup} /></OffscreenFreeze>;
          $[86] = inProgressToolUseIDs;
          $[87] = isActiveCollapsedGroup;
          $[88] = lookups;
          $[89] = message;
          $[90] = shouldAnimate;
          $[91] = t2;
          $[92] = tools;
          $[93] = t3;
        } else {
          t3 = $[93];
        }
        return t3;
      }
  }
}
function UserMessage(t0) {
  const $ = _c(20);
  const {
    message,
    addMargin,
    tools,
    progressMessagesForMessage,
    param,
    style,
    verbose,
    imageIndex,
    isUserContinuation,
    lookups,
    isTranscriptMode
  } = t0;
  const {
    columns
  } = useTerminalSize();
  switch (param.type) {
    case "text":
      {
        let t1;
        if ($[0] !== addMargin || $[1] !== isTranscriptMode || $[2] !== message.planContent || $[3] !== message.timestamp || $[4] !== param || $[5] !== verbose) {
          t1 = <UserTextMessage addMargin={addMargin} param={param} verbose={verbose} planContent={message.planContent} isTranscriptMode={isTranscriptMode} timestamp={message.timestamp} />;
          $[0] = addMargin;
          $[1] = isTranscriptMode;
          $[2] = message.planContent;
          $[3] = message.timestamp;
          $[4] = param;
          $[5] = verbose;
          $[6] = t1;
        } else {
          t1 = $[6];
        }
        return t1;
      }
    case "image":
      {
        const t1 = addMargin && !isUserContinuation;
        let t2;
        if ($[7] !== imageIndex || $[8] !== t1) {
          t2 = <UserImageMessage imageId={imageIndex} addMargin={t1} />;
          $[7] = imageIndex;
          $[8] = t1;
          $[9] = t2;
        } else {
          t2 = $[9];
        }
        return t2;
      }
    case "tool_result":
      {
// 【columns - 5：一个没有解释的魔法数字】
//
//  整个文件的注释质量都很高，唯独这里直接减 5 没说明。从上下文推断：工具
//  结果左侧有缩进和边框（大概 5 列），所以可用宽度要扣掉。
//
//  这类数字的问题是**它依赖另一个模块的排版**（UserToolResultMessage 的
//  缩进），而那个模块改动时这里不会跟着变 —— 症状是长行的折行位置偏了
//  几列，不会报错。
//
//  读到这里应该记一笔：如果哪天工具结果的缩进改了，第一个要检查的是这里。
        const t1 = columns - 5;
        let t2;
        if ($[10] !== isTranscriptMode || $[11] !== lookups || $[12] !== message || $[13] !== param || $[14] !== progressMessagesForMessage || $[15] !== style || $[16] !== t1 || $[17] !== tools || $[18] !== verbose) {
          t2 = <UserToolResultMessage param={param} message={message} lookups={lookups} progressMessagesForMessage={progressMessagesForMessage} style={style} tools={tools} verbose={verbose} width={t1} isTranscriptMode={isTranscriptMode} />;
          $[10] = isTranscriptMode;
          $[11] = lookups;
          $[12] = message;
          $[13] = param;
          $[14] = progressMessagesForMessage;
          $[15] = style;
          $[16] = t1;
          $[17] = tools;
          $[18] = verbose;
          $[19] = t2;
        } else {
          t2 = $[19];
        }
        return t2;
      }
    default:
      {
        return;
      }
  }
}
function AssistantMessageBlock(t0) {
  const $ = _c(45);
  const {
    param,
    addMargin,
    tools,
    commands,
    verbose,
    inProgressToolUseIDs,
    progressMessagesForMessage,
    shouldAnimate,
    shouldShowDot,
    width,
    inProgressToolCallCount,
    isTranscriptMode,
    lookups,
    onOpenRateLimitOptions,
    thinkingBlockId,
    lastThinkingBlockId,
    advisorModel
  } = t0;
// 【CONNECTOR_TEXT：一种「长得像新类型、实际是老类型」的块】
//
//  连接器（connector）返回的文本块有自己的类型名，但渲染上完全等价于普通
//  text 块。所以这里做的是**降级转换**：把 connector_text 拆出来，包成
//  `{type:'text'}`，然后走 AssistantTextMessage。
//
//  放在 switch 之前而不是加一个 case，是因为后面所有逻辑（addMargin /
//  shouldShowDot / width）都完全一样 —— 加 case 就要复制一遍。
//
//  代价：这个转换在每次渲染时都做（有缓存槽，按 param.connector_text 缓存）。
//  转换成本是一个对象分配，可以接受。
  if (feature("CONNECTOR_TEXT")) {
    if (isConnectorTextBlock(param)) {
      let t1;
      if ($[0] !== param.connector_text) {
        t1 = {
          type: "text",
          text: param.connector_text
        };
        $[0] = param.connector_text;
        $[1] = t1;
      } else {
        t1 = $[1];
      }
      let t2;
      if ($[2] !== addMargin || $[3] !== onOpenRateLimitOptions || $[4] !== shouldShowDot || $[5] !== t1 || $[6] !== verbose || $[7] !== width) {
        t2 = <AssistantTextMessage param={t1} addMargin={addMargin} shouldShowDot={shouldShowDot} verbose={verbose} width={width} onOpenRateLimitOptions={onOpenRateLimitOptions} />;
        $[2] = addMargin;
        $[3] = onOpenRateLimitOptions;
        $[4] = shouldShowDot;
        $[5] = t1;
        $[6] = verbose;
        $[7] = width;
        $[8] = t2;
      } else {
        t2 = $[8];
      }
      return t2;
    }
  }
  switch (param.type) {
    case "tool_use":
      {
        let t1;
        if ($[9] !== addMargin || $[10] !== commands || $[11] !== inProgressToolCallCount || $[12] !== inProgressToolUseIDs || $[13] !== isTranscriptMode || $[14] !== lookups || $[15] !== param || $[16] !== progressMessagesForMessage || $[17] !== shouldAnimate || $[18] !== shouldShowDot || $[19] !== tools || $[20] !== verbose) {
          t1 = <AssistantToolUseMessage param={param} addMargin={addMargin} tools={tools} commands={commands} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={progressMessagesForMessage} shouldAnimate={shouldAnimate} shouldShowDot={shouldShowDot} inProgressToolCallCount={inProgressToolCallCount} lookups={lookups} isTranscriptMode={isTranscriptMode} />;
          $[9] = addMargin;
          $[10] = commands;
          $[11] = inProgressToolCallCount;
          $[12] = inProgressToolUseIDs;
          $[13] = isTranscriptMode;
          $[14] = lookups;
          $[15] = param;
          $[16] = progressMessagesForMessage;
          $[17] = shouldAnimate;
          $[18] = shouldShowDot;
          $[19] = tools;
          $[20] = verbose;
          $[21] = t1;
        } else {
          t1 = $[21];
        }
        return t1;
      }
    case "text":
      {
        let t1;
        if ($[22] !== addMargin || $[23] !== onOpenRateLimitOptions || $[24] !== param || $[25] !== shouldShowDot || $[26] !== verbose || $[27] !== width) {
          t1 = <AssistantTextMessage param={param} addMargin={addMargin} shouldShowDot={shouldShowDot} verbose={verbose} width={width} onOpenRateLimitOptions={onOpenRateLimitOptions} />;
          $[22] = addMargin;
          $[23] = onOpenRateLimitOptions;
          $[24] = param;
          $[25] = shouldShowDot;
          $[26] = verbose;
          $[27] = width;
          $[28] = t1;
        } else {
          t1 = $[28];
        }
        return t1;
      }
    case "redacted_thinking":
      {
// 【redacted_thinking 和 thinking 的显示条件完全相同，但处理不同】
//
//  条件都是 `isTranscriptMode || verbose` —— 普通模式下完全隐藏（思考过程
//  不该占据用户的屏幕）。
//
//  不同的地方：redacted_thinking 没有内容可展开（它是加密过的），所以只画
//  一个占位块；thinking 有内容，要按 isLastThinking 决定是否折叠。
//
//  这个对比说明「显示条件」和「渲染方式」是两件事，即使条件相同也要分开写。
        if (!isTranscriptMode && !verbose) {
          return null;
        }
        let t1;
        if ($[29] !== addMargin) {
          t1 = <AssistantRedactedThinkingMessage addMargin={addMargin} />;
          $[29] = addMargin;
          $[30] = t1;
        } else {
          t1 = $[30];
        }
        return t1;
      }
    case "thinking":
      {
        if (!isTranscriptMode && !verbose) {
          return null;
        }
// 【isLastThinking 的两个分支，null 和「匹配」等价】
//
//  `!lastThinkingBlockId || thinkingBlockId === lastThinkingBlockId`
//
//  lastThinkingBlockId 为 null 时，所有 thinking 块都被判成「最后一个」→
//  全部显示。这和 Messages.tsx 第 395 行那个函数的返回值呼应：
//
//  · null          → 全部显示（这里 `!null` 为真）
//  · 'streaming'   → 全部隐藏（哨兵值，永不匹配）
//  · 'no-thinking' → 全部隐藏（同上）
//  · "uuid:index"  → 只显示那一个
//
//  三个哨兵值的语义全靠这一行的布尔运算实现，没有任何显式分支 —— 这是
//  「用魔法值代替参数」的典型代价：省了一个字段，但语义分散在三个文件里。
        const isLastThinking = !lastThinkingBlockId || thinkingBlockId === lastThinkingBlockId;
        const t1 = isTranscriptMode && !isLastThinking;
        let t2;
        if ($[31] !== addMargin || $[32] !== isTranscriptMode || $[33] !== param || $[34] !== t1 || $[35] !== verbose) {
          t2 = <AssistantThinkingMessage addMargin={addMargin} param={param} isTranscriptMode={isTranscriptMode} verbose={verbose} hideInTranscript={t1} />;
          $[31] = addMargin;
          $[32] = isTranscriptMode;
          $[33] = param;
          $[34] = t1;
          $[35] = verbose;
          $[36] = t2;
        } else {
          t2 = $[36];
        }
        return t2;
      }
    case "server_tool_use":
    case "advisor_tool_result":
      {
        if (isAdvisorBlock(param)) {
          const t1 = verbose || isTranscriptMode;
          let t2;
          if ($[37] !== addMargin || $[38] !== advisorModel || $[39] !== lookups.erroredToolUseIDs || $[40] !== lookups.resolvedToolUseIDs || $[41] !== param || $[42] !== shouldAnimate || $[43] !== t1) {
            t2 = <AdvisorMessage block={param} addMargin={addMargin} resolvedToolUseIDs={lookups.resolvedToolUseIDs} erroredToolUseIDs={lookups.erroredToolUseIDs} shouldAnimate={shouldAnimate} verbose={t1} advisorModel={advisorModel} />;
            $[37] = addMargin;
            $[38] = advisorModel;
            $[39] = lookups.erroredToolUseIDs;
            $[40] = lookups.resolvedToolUseIDs;
            $[41] = param;
            $[42] = shouldAnimate;
            $[43] = t1;
            $[44] = t2;
          } else {
            t2 = $[44];
          }
          return t2;
        }
// 【渲染不了的块要 logError，不能静默返回 null】
//
//  两个 default 分支（server_tool_use 里非 advisor 的、以及 switch 末尾）
//  都调了 logError。这很重要：**静默丢弃会让「模型发了个新类型的块」变成
//  一个不可观测的故障** —— 用户看不到东西，开发者也不知道。
//
//  logError 会进日志文件（不是终端），所以不影响 UI，但事后能查。
//
//  这是本文件里唯一一处「错误处理」，而它处理的是**类型演进的兼容性**：
//  API 加了新块类型，旧客户端会走到这里。
        logError(new Error(`Unable to render server tool block: ${param.type}`));
        return null;
      }
    default:
      {
        logError(new Error(`Unable to render message type: ${param.type}`));
        return null;
      }
  }
}
export function hasThinkingContent(m: {
  type: string;
  message?: {
    content: Array<{
      type: string;
    }>;
  };
}): boolean {
  if (m.type !== 'assistant' || !m.message) return false;
  return m.message.content.some(b => b.type === 'thinking' || b.type === 'redacted_thinking');
}

/** Exported for testing */
// 【这个比较器比 MessageRow 的那个更简单，因为它的粒度不同】
//
//  MessageRow 管「一行」，要判断流式/解析状态；Message 管「一条消息的渲染」，
//  只需要判断那些**会影响输出**的字段。
//
//  七条判据：
//  1. uuid 变了 → 换消息了
//  2. lastThinkingBlockId 变了且这条有 thinking → thinking 可见性可能变
//  3. verbose 变了 → 折叠状态变
//  4. 「是不是最新 bash」的结果变了
//  5. screen 变了
//  6. containerWidth 变了（终端宽度变了）
//  7. **两边都是 static → 直接返回 true（跳过）**
//
//  第 7 条是核心：如果上一帧判了静态、这一帧也判静态，那这条消息的内容
//  就不会变，跳过。注意它要求**两边都** static —— 单向变化（dynamic→static
//  或 static→dynamic）都要重渲染。
export function areMessagePropsEqual(prev: Props, next: Props): boolean {
  if (prev.message.uuid !== next.message.uuid) return false;
  // Only re-render on lastThinkingBlockId change if this message actually
  // has thinking content — otherwise every message in scrollback re-renders
  // whenever streaming thinking starts/stops (CC-941).
  if (prev.lastThinkingBlockId !== next.lastThinkingBlockId && hasThinkingContent(next.message)) {
    return false;
  }
  // Verbose toggle changes thinking block visibility/expansion
  if (prev.verbose !== next.verbose) return false;
  // Only re-render if this message's "is latest bash output" status changed,
  // not when the global latestBashOutputUUID changes to a different message
  const prevIsLatest = prev.latestBashOutputUUID === prev.message.uuid;
  const nextIsLatest = next.latestBashOutputUUID === next.message.uuid;
  if (prevIsLatest !== nextIsLatest) return false;
  if (prev.isTranscriptMode !== next.isTranscriptMode) return false;
  // containerWidth is an absolute number in the no-metadata path (wrapper
  // Box is skipped). Static messages must re-render on terminal resize.
  if (prev.containerWidth !== next.containerWidth) return false;
  if (prev.isStatic && next.isStatic) return true;
  return false;
}
export const Message = React.memo(MessageImpl, areMessagePropsEqual);
// 原文件此处有一行 54512 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。