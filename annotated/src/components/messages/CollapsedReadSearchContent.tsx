// ═══════════════════════════════════════════════════════════════
//  CollapsedReadSearchContent：折叠成一行的那十几个工具调用
// ═══════════════════════════════════════════════════════════════
//
//  模型连续读了八个文件、搜了三处代码，屏幕上不该出现十一行 ——
//  它被折成一行：
//
//      ⏺ Read 8 files, searched 3 patterns, ran 2 bash commands…   ctrl+o
//        ⎿  src/utils/format.ts
//
//  这个文件就是把那一行拼出来的地方，也是本批最长的一个（483 行）。
//
//  三个值得单独理解的设计：
//    1. 「计数只增不减」（第 168 行）—— 防抖造成的抖动
//    2. 「提示至少显示 700ms」（第 26 行）—— 让一闪而过的动作可读
//    3. 「首词大写、后续小写」（第 299 行）—— 拼句子的动词变形
//
//  另外它有一个 verbose 分支：展开后每个工具调用一行（VerboseToolUse），
//  那是完全另一套渲染，直接从第 221 行 return 走了。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import { basename } from 'path';
import React, { useRef } from 'react';
import { useMinDisplayTime } from '../../hooks/useMinDisplayTime.js';
import { Ansi, Box, Text, useTheme } from '../../ink.js';
import { findToolByName, type Tools } from '../../Tool.js';
import { getReplPrimitiveTools } from '../../tools/REPLTool/primitiveTools.js';
import type { CollapsedReadSearchGroup, NormalizedAssistantMessage } from '../../types/message.js';
import { uniq } from '../../utils/array.js';
import { getToolUseIdsFromCollapsedGroup } from '../../utils/collapseReadSearch.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatDuration, formatSecondsShort } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import type { buildMessageLookups } from '../../utils/messages.js';
import type { ThemeName } from '../../utils/theme.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { useSelectedMessageBg } from '../messageActions.js';
import { PrBadge } from '../PrBadge.js';
import { ToolUseLoader } from '../ToolUseLoader.js';

/* eslint-disable @typescript-eslint/no-require-imports */
// 【feature 门控的模块用 require 引入，并且写成三元而不是 if】
//
//      const teamMemCollapsed = feature('TEAMMEM')
//        ? require('./teamMemCollapsed.js') as typeof import(…)
//        : null
//
//  和 UserTextMessage 里那三个懒加载是同一个手法，只是位置不同：
//  这里放在**模块顶层**，因为它在组件体里被用作
//  `teamMemCollapsed!.checkHasTeamMemOps(message)`。
//
//  `feature()` 是编译期常量，所以这个三元在打包时直接折成一边，
//  另一边（含 require）消失。写成三元是为了让 TypeScript 能推断类型
//  （`X | null`），写成 if + let 会得到 implicit any。
//
//  `!` 是告诉 TS「走到这一行时它一定不为 null」——
//  因为调用点外面还有一层 feature 判断。
const teamMemCollapsed = feature('TEAMMEM') ? require('./teamMemCollapsed.js') as typeof import('./teamMemCollapsed.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Hold each ⤿ hint for a minimum duration so fast-completing tool calls
// (bash commands, file reads, search patterns) are actually readable instead
// of flickering past in a single frame.
// 【MIN_HINT_DISPLAY_MS = 700，注释把理由写得很具体】
//
//  折叠行下面那行「⎿ 正在读 xxx」是一个**流式提示**：
//  工具一换，提示就换。而读一个小文件只要十几毫秒，
//  于是提示会在屏幕上闪一下就没 —— 用户根本读不到。
//
//  700ms 是「人眼能确认一个词」的下限。做法是把提示交给
//  useMinDisplayTime（第 218 行），它保证每个值至少显示 700ms。
//
//  代价是提示会**滞后**：真实的工具早就换到下一个了，屏幕还在显示上一个。
//  这在「进度提示」这个场景里是可接受的 —— 用户要的是「它在动」，
//  而不是「精确知道此刻在第几步」。
//
//  同一批里 VoiceIndicator 那处**故意不**用这个（会和空格自动重复抢定时器），
//  说明这个手段不能无脑套。
const MIN_HINT_DISPLAY_MS = 700;
type Props = {
  message: CollapsedReadSearchGroup;
  inProgressToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  verbose: boolean;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  /** True if this is the currently active collapsed group (last one, still loading) */
  isActiveGroup?: boolean;
};

/** Render a single tool use in verbose mode */
function VerboseToolUse(t0) {
  const $ = _c(24);
  const {
    content,
    tools,
    lookups,
    inProgressToolUseIDs,
    shouldAnimate,
    theme
  } = t0;
  const bg = useSelectedMessageBg();
  let t1;
  let t2;
  if ($[0] !== bg || $[1] !== content.id || $[2] !== content.input || $[3] !== content.name || $[4] !== inProgressToolUseIDs || $[5] !== lookups || $[6] !== shouldAnimate || $[7] !== theme || $[8] !== tools) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
// 【`findToolByName(tools, …) ?? findToolByName(getReplPrimitiveTools(), …)`】
//
//  两次查找，第二次是 fallback：折叠组里的工具可能来自 REPL 的「原始工具集」，
//  那批工具不在主 tools 数组里。
//
//  为什么会有两套工具表？因为 REPL 工具是一个「容器」——
//  它内部可以调别的工具，那些内部调用用的是 primitiveTools。
//  渲染时用户看到的是内层工具的名字，但它们只在 primitive 表里。
//
//  这是「工具的可见性」问题：**能被调用的工具集合 ≠ 能出现在界面上的名字集合。**
//  两套表各有各的用途，渲染层必须都能查。
      const tool = findToolByName(tools, content.name) ?? findToolByName(getReplPrimitiveTools(), content.name);
      if (!tool) {
        t2 = null;
        break bb0;
      }
      let t3;
      if ($[11] !== content.id || $[12] !== lookups.resolvedToolUseIDs) {
        t3 = lookups.resolvedToolUseIDs.has(content.id);
        $[11] = content.id;
        $[12] = lookups.resolvedToolUseIDs;
        $[13] = t3;
      } else {
        t3 = $[13];
      }
      const isResolved = t3;
      let t4;
      if ($[14] !== content.id || $[15] !== lookups.erroredToolUseIDs) {
        t4 = lookups.erroredToolUseIDs.has(content.id);
        $[14] = content.id;
        $[15] = lookups.erroredToolUseIDs;
        $[16] = t4;
      } else {
        t4 = $[16];
      }
      const isError = t4;
      let t5;
      if ($[17] !== content.id || $[18] !== inProgressToolUseIDs) {
        t5 = inProgressToolUseIDs.has(content.id);
        $[17] = content.id;
        $[18] = inProgressToolUseIDs;
        $[19] = t5;
      } else {
        t5 = $[19];
      }
      const isInProgress = t5;
      const resultMsg = lookups.toolResultByToolUseID.get(content.id);
      const rawToolResult = resultMsg?.type === "user" ? resultMsg.toolUseResult : undefined;
// 【输出也走 outputSchema 校验，并且失败就当没有 —— 和 UserToolSuccessMessage 一致】
//
//      const parsedOutput = tool.outputSchema?.safeParse(rawToolResult)
//      const toolResult = parsedOutput?.success ? parsedOutput.data : undefined
//
//  注意后面第 116 行还有 `toolResult !== undefined` 的条件，
//  所以校验失败时**只是不显示结果**，工具名和参数照常显示。
//
//  这和 UserToolSuccessMessage 的选择不同：那边校验失败直接 return null
//  （整条消息不显示），因为那里除了结果没别的内容可显示。
//
//  **同一个校验结果，在两处的降级幅度不同** —— 取决于「除了它还有什么」。
      const parsedOutput = tool.outputSchema?.safeParse(rawToolResult);
      const toolResult = parsedOutput?.success ? parsedOutput.data : undefined;
      const parsedInput = tool.inputSchema.safeParse(content.input);
      const input = parsedInput.success ? parsedInput.data : undefined;
      const userFacingName = tool.userFacingName(input);
      const toolUseMessage = input ? tool.renderToolUseMessage(input, {
        theme,
        verbose: true
      }) : null;
      const t6 = shouldAnimate && isInProgress;
      const t7 = !isResolved;
      let t8;
      if ($[20] !== isError || $[21] !== t6 || $[22] !== t7) {
        t8 = <ToolUseLoader shouldAnimate={t6} isUnresolved={t7} isError={isError} />;
        $[20] = isError;
        $[21] = t6;
        $[22] = t7;
        $[23] = t8;
      } else {
        t8 = $[23];
      }
      t1 = <Box key={content.id} flexDirection="column" marginTop={1} backgroundColor={bg}><Box flexDirection="row">{t8}<Text><Text bold={true}>{userFacingName}</Text>{toolUseMessage && <Text>({toolUseMessage})</Text>}</Text>{input && tool.renderToolUseTag?.(input)}</Box>{isResolved && !isError && toolResult !== undefined && <Box>{tool.renderToolResultMessage?.(toolResult, [], {
            verbose: true,
            tools,
            theme
          })}</Box>}</Box>;
    }
    $[0] = bg;
    $[1] = content.id;
    $[2] = content.input;
    $[3] = content.name;
    $[4] = inProgressToolUseIDs;
    $[5] = lookups;
    $[6] = shouldAnimate;
    $[7] = theme;
    $[8] = tools;
    $[9] = t1;
    $[10] = t2;
  } else {
    t1 = $[9];
    t2 = $[10];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  return t1;
}
export function CollapsedReadSearchContent({
  message,
  inProgressToolUseIDs,
  shouldAnimate,
  verbose,
  tools,
  lookups,
  isActiveGroup
}: Props): React.ReactNode {
  const bg = useSelectedMessageBg();
  const {
    searchCount: rawSearchCount,
    readCount: rawReadCount,
    listCount: rawListCount,
    replCount,
    memorySearchCount,
    memoryReadCount,
    memoryWriteCount,
    messages: groupMessages
  } = message;
  const [theme] = useTheme();
  const toolUseIds = getToolUseIdsFromCollapsedGroup(message);
  const anyError = toolUseIds.some(id => lookups.erroredToolUseIDs.has(id));
  const hasMemoryOps = memorySearchCount > 0 || memoryReadCount > 0 || memoryWriteCount > 0;
  const hasTeamMemoryOps = feature('TEAMMEM') ? teamMemCollapsed!.checkHasTeamMemOps(message) : false;

// ═══ 【五个 max-ref：计数只增不减，为了抗抖动】 ═══
//
//  注释写得很清楚：`The debounce timer causes extra re-renders at arbitrary times;
//  during a brief "invisible window" in the streaming executor the group count can dip,
//  which causes jitter.`
//
//  翻译：流式执行器里有一个极短的窗口，折叠组的计数会**短暂下跌**
//  （group 被重建了一次）。如果直接显示原始计数，屏幕上会看到
//  「Read 8 files」闪一下变成「Read 7 files」再变回 8。
//
//  解法是五个 ref 各自记历史最大值：
//
//      maxReadCountRef.current = Math.max(maxReadCountRef.current, rawReadCount)
//
//  在**渲染期**直接改 ref，而不是在 effect 里 —— 因为 effect 会晚一帧，
//  晚一帧就意味着屏幕上已经闪过一次 7。
//
//  这是「渲染期写 ref」的一个正当用途（和 PromptInput 的 lastInternalInputRef 同类）：
//  **它不是在同步状态，而是在维护一个单调不变量。**
//
//  代价：如果某个组真的从 8 掉到 7（不是抖动而是真的重算），
//  显示会永远停在 8。作者接受这个风险，因为折叠组是「已经发生的事的计数」，
//  掉下去没有业务含义。
  // Track the max seen counts so they only ever increase. The debounce timer
  // causes extra re-renders at arbitrary times; during a brief "invisible window"
  // in the streaming executor the group count can dip, which causes jitter.
  const maxReadCountRef = useRef(0);
  const maxSearchCountRef = useRef(0);
  const maxListCountRef = useRef(0);
  const maxMcpCountRef = useRef(0);
  const maxBashCountRef = useRef(0);
  maxReadCountRef.current = Math.max(maxReadCountRef.current, rawReadCount);
  maxSearchCountRef.current = Math.max(maxSearchCountRef.current, rawSearchCount);
  maxListCountRef.current = Math.max(maxListCountRef.current, rawListCount);
  maxMcpCountRef.current = Math.max(maxMcpCountRef.current, message.mcpCallCount ?? 0);
  maxBashCountRef.current = Math.max(maxBashCountRef.current, message.bashCount ?? 0);
  const readCount = maxReadCountRef.current;
  const searchCount = maxSearchCountRef.current;
  const listCount = maxListCountRef.current;
  const mcpCallCount = maxMcpCountRef.current;
  // Subtract commands surfaced as "Committed …" / "Created PR …" so the
  // same command isn't counted twice. gitOpBashCount is read live (no max-ref
  // needed — it's 0 until results arrive, then only grows).
  const gitOpBashCount = message.gitOpBashCount ?? 0;
// 【bashCount 要减掉 gitOpBashCount —— 同一个命令不能数两遍】
//
//  注释：`Subtract commands surfaced as "Committed …" / "Created PR …"
//  so the same command isn't counted twice.`
//
//  场景：`git commit -m "..."` 是一条 bash 命令，但它同时会产出一条
//  「committed abc1234」的 git 事件。折叠行里已经有「committed abc1234」了，
//  如果 bash 计数里再算一次，就会显示「ran 3 bash commands」但实际上只跑了 2 条。
//
//  所以 `bashCount = max(0, max - gitOpBashCount)`，用 max(0, …) 兜住
//  「gitOpBashCount 比 bashCount 大」的情况（理论上不该发生，但计数的时序不保证）。
//
//  这一类「同一个事实两个来源」的去重，比计数本身更容易出错。
//  读到计数逻辑时，先问一句：**这些数字之间有没有重叠？**
  const bashCount = isFullscreenEnvEnabled() ? Math.max(0, maxBashCountRef.current - gitOpBashCount) : 0;
  const hasNonMemoryOps = searchCount > 0 || readCount > 0 || listCount > 0 || replCount > 0 || mcpCallCount > 0 || bashCount > 0 || gitOpBashCount > 0;
  const readPaths = message.readFilePaths;
  const searchArgs = message.searchArgs;
  let incomingHint = message.latestDisplayHint;
  if (incomingHint === undefined) {
    const lastSearchRaw = searchArgs?.at(-1);
    const lastSearch = lastSearchRaw !== undefined ? `"${lastSearchRaw}"` : undefined;
    const lastRead = readPaths?.at(-1);
    incomingHint = lastRead !== undefined ? getDisplayPath(lastRead) : lastSearch;
  }

  // Active REPL calls emit repl_tool_call progress with the current inner
  // tool's name+input. Virtual messages don't arrive until REPL completes,
  // so this is the only source of a live hint during execution.
// 【REPL 的实时提示：从 progress 消息里挖当前内层工具】
//
//  为什么需要这一段？注释说得很准：
//  `Virtual messages don't arrive until REPL completes, so this is the only
//  source of a live hint during execution.`
//
//  也就是：REPL 这个工具在跑的时候，内层调用的消息（virtual messages）
//  要等它整个结束才生成。所以在那之前，屏幕上唯一能显示「现在在干什么」的
//  线索就是 progress 消息里的 repl_tool_call。
//
//  `phase === 'start'` 只看开始事件 —— 因为 end 事件里没有 toolInput，
//  看到了也没法显示参数。
//
//  取值顺序 `file_path ?? pattern ?? command ?? toolName` 是**从具体到抽象**：
//  能说「读哪个文件」就不说「跑了个命令」。
  if (isActiveGroup) {
    for (const id_0 of toolUseIds) {
      if (!inProgressToolUseIDs.has(id_0)) continue;
      const latest = lookups.progressMessagesByToolUseID.get(id_0)?.at(-1)?.data;
      if (latest?.type === 'repl_tool_call' && latest.phase === 'start') {
        const input = latest.toolInput as {
          command?: string;
          pattern?: string;
          file_path?: string;
        };
        incomingHint = input.file_path ?? (input.pattern ? `"${input.pattern}"` : undefined) ?? input.command ?? latest.toolName;
      }
    }
  }
// 【useMinDisplayTime 的输入是「当前提示」，输出是「当前该显示的提示」】
//
//  它内部是一个定时器 + 状态：新值来了先记下，等上一个值满 700ms 再切换。
//  所以 displayedHint 可能**落后于** incomingHint。
//
//  注意它在 verbose 分支之前（第 221 行 return），所以 verbose 模式下
//  这次调用是白花的 —— 但它必须在所有 return 之前，否则 hook 顺序会变。
//
//  这一类「在早退之前调用、早退之后不用」的 hook，在产物里经常看到，
//  是 hooks 规则和代码组织的必然代价。
  const displayedHint = useMinDisplayTime(incomingHint, MIN_HINT_DISPLAY_MS);

  // In verbose mode, render each tool use with its 1-line result summary
// 【verbose 分支：把折叠组重新展开成逐个工具】
//
//  它做了三件事：
//    1. 从 groupMessages 里挑出 assistant 消息和 grouped_tool_use 消息
//    2. 每条的第一个 content 交给 VerboseToolUse
//    3. 额外补 hook 摘要和「recalled 的记忆」
//
//  第 227 行的 `toolUses.push(...msg.messages)` 用的是展开运算符 ——
//  因为 grouped_tool_use 里面还套着一层消息数组，要拍平。
//
//  这一步的存在说明：**折叠不是不可逆的**。
//  数据层保留了全部原始消息，折叠只是渲染层的选择。
//  这是「信息不丢，只改变呈现」的正确做法 ——
//  任何「折叠时把数据扔掉」的实现，都会让 Ctrl+O 展开变成不可能。
  if (verbose) {
    const toolUses: NormalizedAssistantMessage[] = [];
    for (const msg of groupMessages) {
      if (msg.type === 'assistant') {
        toolUses.push(msg);
      } else if (msg.type === 'grouped_tool_use') {
        toolUses.push(...msg.messages);
      }
    }
    return <Box flexDirection="column">
        {toolUses.map(msg_0 => {
        const content = msg_0.message.content[0];
        if (content?.type !== 'tool_use') return null;
        return <VerboseToolUse key={content.id} content={content} tools={tools} lookups={lookups} inProgressToolUseIDs={inProgressToolUseIDs} shouldAnimate={shouldAnimate} theme={theme} />;
      })}
        {message.hookInfos && message.hookInfos.length > 0 && <>
            <Text dimColor>
              {'  ⎿  '}Ran {message.hookCount} PreToolUse{' '}
              {message.hookCount === 1 ? 'hook' : 'hooks'} (
              {formatSecondsShort(message.hookTotalMs ?? 0)})
            </Text>
            {message.hookInfos.map((info, idx) => <Text key={`hook-${idx}`} dimColor>
                {'     ⎿ '}
                {info.command} ({formatSecondsShort(info.durationMs ?? 0)})
              </Text>)}
          </>}
        {message.relevantMemories?.map(m => <Box key={m.path} flexDirection="column" marginTop={1}>
            <Text dimColor>
              {'  ⎿  '}Recalled {basename(m.path)}
            </Text>
            <Box paddingLeft={5}>
              <Text>
                <Ansi>{m.content}</Ansi>
              </Text>
            </Box>
          </Box>)}
      </Box>;
  }

  // Non-verbose mode: Show counts with blinking grey dot while active, green dot when finalized
  // Use present tense when active, past tense when finalized

  // Defensive: If all counts are 0, don't render the collapsed group
  // This shouldn't happen in normal operation, but handles edge cases
// 【一个防御性判断：所有计数都是 0 就整块不画】
//
//  注释：`This shouldn't happen in normal operation, but handles edge cases`。
//
//  这类判断在本批出现多次（teamMemCollapsed 第 30 行、UserTeammateMessage 第 76 行）。
//  共同点：**宁可什么都不画，也不要画一个空壳**。
//
//  空壳的代价在终端里比在网页里大得多 ——
//  网页里一个空 div 是不可见的，终端里一个空 Box 会吃掉一行（或一段 margin）。
  if (!hasMemoryOps && !hasTeamMemoryOps && !hasNonMemoryOps) {
    return null;
  }

  // Find the slowest in-progress shell command in this group. BashTool yields
  // progress every second but the collapsed renderer never showed it — long
  // commands (npm install, tests) looked frozen. Shown after 2s so fast
  // commands stay clean; the ticking counter reassures that slow ones aren't stuck.
  let shellProgressSuffix = '';
// 【shell 进度：2 秒后才显示，因为快的命令不需要报时】
//
//  注释解释了动机：`BashTool yields progress every second but the collapsed
//  renderer never showed it — long commands (npm install, tests) looked frozen.`
//
//  这是一个真实的用户体验缺陷：跑 `npm install` 一分半钟，
//  折叠行一直显示「ran 1 bash command」，看起来像卡死了。
//
//  解法是把 elapsed 拼到提示后面：`(1m 23s · 412 lines)`。
//  但只在 elapsed >= 2 时加 —— **2 秒以内结束的命令，报时反而是噪音**。
//
//  取「最慢的那个」，是因为用户关心的是「我还要等多久」，
//  而并行的多个命令里最慢的那个决定总时长。
  if (isFullscreenEnvEnabled() && isActiveGroup) {
    let elapsed: number | undefined;
    let lines = 0;
    for (const id_1 of toolUseIds) {
      if (!inProgressToolUseIDs.has(id_1)) continue;
      const data = lookups.progressMessagesByToolUseID.get(id_1)?.at(-1)?.data;
      if (data?.type !== 'bash_progress' && data?.type !== 'powershell_progress') {
        continue;
      }
      if (elapsed === undefined || data.elapsedTimeSeconds > elapsed) {
        elapsed = data.elapsedTimeSeconds;
        lines = data.totalLines;
      }
    }
    if (elapsed !== undefined && elapsed >= 2) {
      const time = formatDuration(elapsed * 1000);
      shellProgressSuffix = lines > 0 ? ` (${time} · ${lines} ${lines === 1 ? 'line' : 'lines'})` : ` (${time})`;
    }
  }

  // Build non-memory parts first (search, read, repl, mcp, bash) — these render
  // before memory so the line reads "Ran 3 bash commands, recalled 1 memory".
  const nonMemParts: React.ReactNode[] = [];

  // Git operations lead the line — they're the load-bearing outcome.
// 【pushPart：一个把「首词大写」和「逗号」封装起来的小函数】
//
//      function pushPart(key, verb, body) {
//        if (!isFirst) nonMemParts.push(<Text key={comma-key}>, </Text>)
//        nonMemParts.push(<Text key={key}>{isFirst ? verb[0].toUpperCase() + verb.slice(1) : verb} {body}</Text>)
//      }
//
//  两个细节：
//
//  一、逗号是**独立的 Text 节点**，不是拼在字符串里的。
//     因为整行要能被 Ink 折行，而折行发生在 Text 之间；
//     如果逗号和内容在同一个 Text 里，Ink 可能把「, 」留在行尾而不是行首。
//     （这是终端排版的常见问题：行尾孤立的标点看起来像错误。）
//
//  二、`verb[0]!.toUpperCase() + verb.slice(1)` —— 用 `!` 告诉 TS 首字符存在。
//     空字符串会得到 `undefined + ''`，但调用点保证 verb 非空。
//
//  注意这个函数**只给 git 那四个分支用**（commits / pushes / branches / prs），
//  后面 search / read / list 等分支各自手写了同样的逻辑（第 345-413 行）。
//  为什么不用它？因为那些分支的措辞结构不同（「searched for 3 patterns」），
//  不是「动词 + 加粗数字」这个模板。
  function pushPart(key: string, verb: string, body: React.ReactNode): void {
    const isFirst = nonMemParts.length === 0;
    if (!isFirst) nonMemParts.push(<Text key={`comma-${key}`}>, </Text>);
    nonMemParts.push(<Text key={key}>
        {isFirst ? verb[0]!.toUpperCase() + verb.slice(1) : verb} {body}
      </Text>);
  }
// 【四个 git 相关的分支都套在 isFullscreenEnvEnabled() 里】
//
//  `commits / pushes / branches / prs` 这四类信息只在全屏模式下显示。
//
//  原因很实际：非全屏模式用的是 <Static>（打印一次进滚动缓冲区），
//  而 git 状态是**在流式过程中逐步到达的**。打印一次意味着
//  「committed」那几个字会永远定格在第一次的值上，后面的不会补进来。
//
//  所以宁可不在非全屏里显示，也不要显示一个不完整且不再更新的版本。
//
//  这和 Messages.tsx 里 `shouldRenderStatically` 那条不变量是同一件事：
//  **静态渲染的前提是内容不再变。**
  if (isFullscreenEnvEnabled() && message.commits?.length) {
    const byKind = {
      committed: 'committed',
      amended: 'amended commit',
      'cherry-picked': 'cherry-picked'
    };
    for (const kind of ['committed', 'amended', 'cherry-picked'] as const) {
      const shas = message.commits.filter(c => c.kind === kind).map(c_0 => c_0.sha);
      if (shas.length) {
        pushPart(kind, byKind[kind], <Text bold>{shas.join(', ')}</Text>);
      }
    }
  }
  if (isFullscreenEnvEnabled() && message.pushes?.length) {
    const branches = uniq(message.pushes.map(p => p.branch));
    pushPart('push', 'pushed to', <Text bold>{branches.join(', ')}</Text>);
  }
  if (isFullscreenEnvEnabled() && message.branches?.length) {
    const byAction = {
      merged: 'merged',
      rebased: 'rebased onto'
    };
    for (const b of message.branches) {
      pushPart(`br-${b.action}-${b.ref}`, byAction[b.action], <Text bold>{b.ref}</Text>);
    }
  }
  if (isFullscreenEnvEnabled() && message.prs?.length) {
    const verbs = {
      created: 'created',
      edited: 'edited',
      merged: 'merged',
      commented: 'commented on',
      closed: 'closed',
      ready: 'marked ready'
    };
    for (const pr of message.prs) {
      pushPart(`pr-${pr.action}-${pr.number}`, verbs[pr.action], pr.url ? <PrBadge number={pr.number} url={pr.url} bold /> : <Text bold>PR #{pr.number}</Text>);
    }
  }
  if (searchCount > 0) {
    const isFirst_0 = nonMemParts.length === 0;
    const searchVerb = isActiveGroup ? isFirst_0 ? 'Searching for' : 'searching for' : isFirst_0 ? 'Searched for' : 'searched for';
    if (!isFirst_0) {
      nonMemParts.push(<Text key="comma-s">, </Text>);
    }
    nonMemParts.push(<Text key="search">
        {searchVerb} <Text bold>{searchCount}</Text>{' '}
        {searchCount === 1 ? 'pattern' : 'patterns'}
      </Text>);
  }
  if (readCount > 0) {
    const isFirst_1 = nonMemParts.length === 0;
    const readVerb = isActiveGroup ? isFirst_1 ? 'Reading' : 'reading' : isFirst_1 ? 'Read' : 'read';
    if (!isFirst_1) {
      nonMemParts.push(<Text key="comma-r">, </Text>);
    }
    nonMemParts.push(<Text key="read">
        {readVerb} <Text bold>{readCount}</Text>{' '}
        {readCount === 1 ? 'file' : 'files'}
      </Text>);
  }
  if (listCount > 0) {
    const isFirst_2 = nonMemParts.length === 0;
    const listVerb = isActiveGroup ? isFirst_2 ? 'Listing' : 'listing' : isFirst_2 ? 'Listed' : 'listed';
    if (!isFirst_2) {
      nonMemParts.push(<Text key="comma-l">, </Text>);
    }
    nonMemParts.push(<Text key="list">
        {listVerb} <Text bold>{listCount}</Text>{' '}
        {listCount === 1 ? 'directory' : 'directories'}
      </Text>);
  }
  if (replCount > 0) {
    const replVerb = isActiveGroup ? "REPL'ing" : "REPL'd";
    if (nonMemParts.length > 0) {
      nonMemParts.push(<Text key="comma-repl">, </Text>);
    }
    nonMemParts.push(<Text key="repl">
        {replVerb} <Text bold>{replCount}</Text>{' '}
        {replCount === 1 ? 'time' : 'times'}
      </Text>);
  }
  if (mcpCallCount > 0) {
// 【MCP 的 server 名要剥掉 `claude.ai ` 前缀】
//
//      message.mcpServerNames?.map(n => n.replace(/^claude.ai /, '')).join(', ') || 'MCP'
//
//  这是「显示名清洗」的又一例（前面 UserChannelMessage 剥 `plugin:x:y` 的前缀）。
//  共同规律：**存储用的标识符带作用域，展示用的名字要把它剥掉。**
//
//  最后的 `|| 'MCP'` 兜住「没有 server 名」的情况 —— 总得有个词占位，
//  否则会拼出「queried  3 times」这种双空格。
//
//  注意它是 `'MCP'` 而不是空串：**降级要给出一个仍然有意义的词**，
//  哪怕不精确。
    const serverLabel = message.mcpServerNames?.map(n => n.replace(/^claude\.ai /, '')).join(', ') || 'MCP';
    const isFirst_3 = nonMemParts.length === 0;
    const verb_0 = isActiveGroup ? isFirst_3 ? 'Querying' : 'querying' : isFirst_3 ? 'Queried' : 'queried';
    if (!isFirst_3) {
      nonMemParts.push(<Text key="comma-mcp">, </Text>);
    }
    nonMemParts.push(<Text key="mcp">
        {verb_0} {serverLabel}
        {mcpCallCount > 1 && <>
            {' '}
            <Text bold>{mcpCallCount}</Text> times
          </>}
      </Text>);
  }
  if (isFullscreenEnvEnabled() && bashCount > 0) {
    const isFirst_4 = nonMemParts.length === 0;
    const verb_1 = isActiveGroup ? isFirst_4 ? 'Running' : 'running' : isFirst_4 ? 'Ran' : 'ran';
    if (!isFirst_4) {
      nonMemParts.push(<Text key="comma-bash">, </Text>);
    }
    nonMemParts.push(<Text key="bash">
        {verb_1} <Text bold>{bashCount}</Text> bash{' '}
        {bashCount === 1 ? 'command' : 'commands'}
      </Text>);
  }

  // Build memory parts (auto-memory) — rendered after nonMemParts
  const hasPrecedingNonMem = nonMemParts.length > 0;
  const memParts: React.ReactNode[] = [];
  if (memoryReadCount > 0) {
    const isFirst_5 = !hasPrecedingNonMem && memParts.length === 0;
    const verb_2 = isActiveGroup ? isFirst_5 ? 'Recalling' : 'recalling' : isFirst_5 ? 'Recalled' : 'recalled';
    if (!isFirst_5) {
      memParts.push(<Text key="comma-mr">, </Text>);
    }
    memParts.push(<Text key="mem-read">
        {verb_2} <Text bold>{memoryReadCount}</Text>{' '}
        {memoryReadCount === 1 ? 'memory' : 'memories'}
      </Text>);
  }
  if (memorySearchCount > 0) {
    const isFirst_6 = !hasPrecedingNonMem && memParts.length === 0;
    const verb_3 = isActiveGroup ? isFirst_6 ? 'Searching' : 'searching' : isFirst_6 ? 'Searched' : 'searched';
    if (!isFirst_6) {
      memParts.push(<Text key="comma-ms">, </Text>);
    }
    memParts.push(<Text key="mem-search">{`${verb_3} memories`}</Text>);
  }
  if (memoryWriteCount > 0) {
    const isFirst_7 = !hasPrecedingNonMem && memParts.length === 0;
    const verb_4 = isActiveGroup ? isFirst_7 ? 'Writing' : 'writing' : isFirst_7 ? 'Wrote' : 'wrote';
    if (!isFirst_7) {
      memParts.push(<Text key="comma-mw">, </Text>);
    }
    memParts.push(<Text key="mem-write">
        {verb_4} <Text bold>{memoryWriteCount}</Text>{' '}
        {memoryWriteCount === 1 ? 'memory' : 'memories'}
      </Text>);
  }
// 【最后的结构：图标 + 一整段文本 + 可选的提示行】
//
//      <Box flexDirection="column" marginTop={1} backgroundColor={bg}>
//        <Box flexDirection="row">
//          {激活态 ? <ToolUseLoader/> : <Box minWidth={2}/>}     ← 2 格占位
//          <Text dimColor={!isActiveGroup}>…</Text>
//        </Box>
//        {激活态 && 提示行}
//        {hook 耗时}
//      </Box>
//
//  两个细节：
//
//  一、非激活时用 `<Box minWidth={2}/>` 占位，而不是不画。
//     这样所有折叠行的文字左边线对齐 —— 有转圈的那行和没转圈的那行
//     文字起始位置相同。**占位元素是终端里实现对齐的唯一手段。**
//
//  二、`dimColor={!isActiveGroup}` —— 已完成的历史折叠行变灰，
//     正在跑的那组保持正常亮度。**亮度在这个 UI 里表示「活跃度」。**
//
//  第 466 行的提示行用 `width={5} flexShrink={0}` 做 gutter，
//  注释解释了原因：让折行发生在右列，续行自动缩进到 ⎿ 下面。
  return <Box flexDirection="column" marginTop={1} backgroundColor={bg}>
      <Box flexDirection="row">
        {isActiveGroup ? <ToolUseLoader shouldAnimate isUnresolved isError={anyError} /> : <Box minWidth={2} />}
        <Text dimColor={!isActiveGroup}>
          {nonMemParts}
          {memParts}
          {feature('TEAMMEM') ? teamMemCollapsed!.TeamMemCountParts({
          message,
          isActiveGroup,
          hasPrecedingParts: hasPrecedingNonMem || memParts.length > 0
        }) : null}
          {isActiveGroup && <Text key="ellipsis">…</Text>} <CtrlOToExpand />
        </Text>
      </Box>
      {isActiveGroup && displayedHint !== undefined &&
    // Row layout: 5-wide gutter for ⎿, then a flex column for the text.
    // Ink's wrap stays inside the right column so continuation lines
    // indent under ⎿. MAX_HINT_CHARS in commandAsHint caps total at ~5 lines.
    <Box flexDirection="row">
          <Box width={5} flexShrink={0}>
            <Text dimColor>{'  ⎿  '}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {displayedHint.split('\n').map((line, i, arr) => <Text key={`hint-${i}`} dimColor>
                {line}
                {i === arr.length - 1 && shellProgressSuffix}
              </Text>)}
          </Box>
        </Box>}
      {message.hookTotalMs !== undefined && message.hookTotalMs > 0 && <Text dimColor>
          {'  ⎿  '}Ran {message.hookCount} PreToolUse{' '}
          {message.hookCount === 1 ? 'hook' : 'hooks'} (
          {formatSecondsShort(message.hookTotalMs)})
        </Text>}
    </Box>;
}
// 原文件此处有一行 58060 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。