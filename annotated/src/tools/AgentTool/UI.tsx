import { c as _c } from "react/compiler-runtime";
import type { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { ConfigurableShortcutHint } from 'src/components/ConfigurableShortcutHint.js';
import { CtrlOToExpand, SubAgentProvider } from 'src/components/CtrlOToExpand.js';
import { Byline } from 'src/components/design-system/Byline.js';
import { KeyboardShortcutHint } from 'src/components/design-system/KeyboardShortcutHint.js';
import type { z } from 'zod/v4';
import { AgentProgressLine } from '../../components/AgentProgressLine.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js';
import { Markdown } from '../../components/Markdown.js';
import { Message as MessageComponent } from '../../components/Message.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { ToolUseLoader } from '../../components/ToolUseLoader.js';
import { Box, Text } from '../../ink.js';
import { getDumpPromptsPath } from '../../services/api/dumpPrompts.js';
import { findToolByName, type Tools } from '../../Tool.js';
import type { Message, ProgressMessage } from '../../types/message.js';
import type { AgentToolProgress } from '../../types/tools.js';
import { count } from '../../utils/array.js';
import { getSearchOrReadFromContent, getSearchReadSummaryText } from '../../utils/collapseReadSearch.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatDuration, formatNumber } from '../../utils/format.js';
import { buildSubagentLookups, createAssistantMessage, EMPTY_LOOKUPS } from '../../utils/messages.js';
import type { ModelAlias } from '../../utils/model/aliases.js';
import { getMainLoopModel, parseUserSpecifiedModel, renderModelName } from '../../utils/model/model.js';
import type { Theme, ThemeName } from '../../utils/theme.js';
import type { outputSchema, Progress, RemoteLaunchedOutput } from './AgentTool.js';
import { inputSchema } from './AgentTool.js';
import { getAgentColor } from './agentColorManager.js';
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js';
const MAX_PROGRESS_MESSAGES_TO_SHOW = 3;
// MAX_PROGRESS_MESSAGES_TO_SHOW：进度视图最多显示 3 条处理后的消息，更早的折叠成 +N more tool uses 一行。

/**
 * Guard: checks if progress data has a `message` field (agent_progress or
 * skill_progress).  Other progress types (e.g. bash_progress forwarded from
 * sub-agents) lack this field and must be skipped by UI helpers.
 */
// hasProgressMessage：只有 agent_progress / skill_progress 带 message 字段；bash_progress 这类从 subagent 转发来的进度没有，UI helper 必须跳过——不跳就会把 bash 输出当 agent 消息渲染。
function hasProgressMessage(data: Progress): data is AgentToolProgress {
  if (!('message' in data)) {
    return false;
  }
  const msg = (data as AgentToolProgress).message;
  return msg != null && typeof msg === 'object' && 'type' in msg;
}
// 守卫双查：message in data + 是对象 + 有 type 字段——防其他进度类型形状漂移时静默出错。

/**
 * Check if a progress message is a search/read/REPL operation (tool use or result).
 * Returns { isSearch, isRead, isREPL } if it's a collapsible operation, null otherwise.
 *
 * For tool_result messages, uses the provided `toolUseByID` map to find the
 * corresponding tool_use block instead of relying on `normalizedMessages`.
 */
// getSearchOrReadInfo：判断一条进度消息是不是可折叠的搜索/读/REPL 操作，返回三旗标。
function getSearchOrReadInfo(progressMessage: ProgressMessage<Progress>, tools: Tools, toolUseByID: Map<string, ToolUseBlockParam>): {
  isSearch: boolean;
  isRead: boolean;
  isREPL: boolean;
} | null {
  if (!hasProgressMessage(progressMessage.data)) {
    return null;
  }
  const message = progressMessage.data.message;

  // Check tool_use (assistant message)
  if (message.type === 'assistant') {
    return getSearchOrReadFromContent(message.message.content[0], tools);
  }

  // Check tool_result (user message) - find corresponding tool use from the map
  if (message.type === 'user') {
    const content = message.message.content[0];
    if (content?.type === 'tool_result') {
      const toolUse = toolUseByID.get(content.tool_use_id);
      if (toolUse) {
        return getSearchOrReadFromContent(toolUse, tools);
      }
    }
  }
  return null;
}
// tool_result 分支靠 toolUseByID 反查对应 tool_use——progress 消息里没有 normalizedMessages 可用，查表是调用方 incremental 建好的。
type SummaryMessage = {
  type: 'summary';
  searchCount: number;
  readCount: number;
  replCount: number;
  uuid: string;
  isActive: boolean; // true if still in progress (last message was tool_use, not tool_result)
};
type ProcessedMessage = {
  type: 'original';
  message: ProgressMessage<AgentToolProgress>;
} | SummaryMessage;
// ProcessedMessage 二分：original 原样渲染 | summary 把连续搜索/读折叠成一行统计。

/**
 * Process progress messages to group consecutive search/read operations into summaries.
 * For ants only - returns original messages for non-ants.
 * @param isAgentRunning - If true, the last group is always marked as active (in progress)
 */
// processProgressMessages：把连续的 search/read/REPL 操作合并成摘要行——agent 探查阶段动辄几十次 Grep/Read，不折叠进度视图会被冲爆。仅 ant（外部构建直接透传，省得为非内部用户维护两套渲染）。
function processProgressMessages(messages: ProgressMessage<Progress>[], tools: Tools, isAgentRunning: boolean): ProcessedMessage[] {
  // Only process for ants
  if ("external" !== 'ant') {
    return messages.filter((m): m is ProgressMessage<AgentToolProgress> => hasProgressMessage(m.data) && m.data.message.type !== 'user').map(m => ({
      type: 'original',
      message: m
    }));
  }
// 非 ant 快速路径：过滤掉 user 消息——subagent 进度消息没有 toolUseResult，UserToolSuccessMessage 会返回 null，那个 height=1 的 Box 渲染出来就是一条空行。
  const result: ProcessedMessage[] = [];
  let currentGroup: {
    searchCount: number;
    readCount: number;
    replCount: number;
    startUuid: string;
  } | null = null;
  function flushGroup(isActive: boolean): void {
    if (currentGroup && (currentGroup.searchCount > 0 || currentGroup.readCount > 0 || currentGroup.replCount > 0)) {
      result.push({
        type: 'summary',
        searchCount: currentGroup.searchCount,
        readCount: currentGroup.readCount,
        replCount: currentGroup.replCount,
        uuid: `summary-${currentGroup.startUuid}`,
        isActive
      });
    }
    currentGroup = null;
  }
// flushGroup：组里三类计数全零不入 result（空组是噪声）；uuid 用 summary-<startUuid> 合成，React key 稳定可复现。
  const agentMessages = messages.filter((m): m is ProgressMessage<AgentToolProgress> => hasProgressMessage(m.data));

  // Build tool_use lookup incrementally as we iterate
  const toolUseByID = new Map<string, ToolUseBlockParam>();
  for (const msg of agentMessages) {
    // Track tool_use blocks as we see them
    if (msg.data.message.type === 'assistant') {
      for (const c of msg.data.message.message.content) {
        if (c.type === 'tool_use') {
          toolUseByID.set(c.id, c as ToolUseBlockParam);
        }
      }
    }
    const info = getSearchOrReadInfo(msg, tools, toolUseByID);
    if (info && (info.isSearch || info.isRead || info.isREPL)) {
      // This is a search/read/REPL operation - add to current group
      if (!currentGroup) {
        currentGroup = {
          searchCount: 0,
          readCount: 0,
          replCount: 0,
          startUuid: msg.uuid
        };
      }
      // Only count tool_result messages (not tool_use) to avoid double counting
      if (msg.data.message.type === 'user') {
        if (info.isSearch) {
          currentGroup.searchCount++;
        } else if (info.isREPL) {
          currentGroup.replCount++;
        } else if (info.isRead) {
          currentGroup.readCount++;
        }
      }
    } else {
      // Non-search/read/REPL message - flush current group (completed) and add this message
      flushGroup(false);
      // Skip user tool_result messages — subagent progress messages lack
      // toolUseResult, so UserToolSuccessMessage returns null and the
      // height=1 Box in renderToolUseProgressMessage shows as a blank line.
      if (msg.data.message.type !== 'user') {
        result.push({
          type: 'original',
          message: msg
        });
      }
    }
  }

  // Flush any remaining group - it's active if the agent is still running
  flushGroup(isAgentRunning);
  return result;
}
// 收尾 flush 传 isAgentRunning：进度视图（agent 还在跑）最后一组标 active——摘要行显示成进行时态而不是完成态。
const ESTIMATED_LINES_PER_TOOL = 9;
const TERMINAL_BUFFER_LINES = 7;
type Output = z.input<ReturnType<typeof outputSchema>>;
// Output 类型取自 AgentTool.js 的 outputSchema——渲染层与工具层共用同一个 schema，不会各写一份漂移。
// 以下组件是 React Compiler 产物：函数体是 _c(N) memo cache（$ 数组槽位 + Symbol.for("react.memo_cache_sentinel") 判定常量），t0/t1/t2 是解构重命名。读这类文件跳过 cache 机制直接看 JSX 结构；文件末尾的 base64 sourcemap 是有意省略项（check-fidelity 标 OK*）。
export function AgentPromptDisplay(t0) {
  const $ = _c(3);
  const {
    prompt,
    dim: t1
  } = t0;
  t1 === undefined ? false : t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text color="success" bold={true}>Prompt:</Text>;
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  let t3;
  if ($[1] !== prompt) {
    t3 = <Box flexDirection="column">{t2}<Box paddingLeft={2}><Markdown>{prompt}</Markdown></Box></Box>;
    $[1] = prompt;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  return t3;
}
// AgentPromptDisplay：Prompt: 标签 + Markdown 渲染，内容缩进 2 空格——transcript 模式展开时用。
export function AgentResponseDisplay(t0) {
  const $ = _c(5);
  const {
    content
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text color="success" bold={true}>Response:</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== content) {
    t2 = content.map(_temp);
    $[1] = content;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== t2) {
    t3 = <Box flexDirection="column">{t1}{t2}</Box>;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
// AgentResponseDisplay：Response: 标签 + content 逐文本块渲染（_temp 每块一个 Box，首块无 marginTop）。
function _temp(block, index) {
  return <Box key={index} paddingLeft={2} marginTop={index === 0 ? 0 : 1}><Markdown>{block.text}</Markdown></Box>;
}
type VerboseAgentTranscriptProps = {
  progressMessages: ProgressMessage<Progress>[];
  tools: Tools;
  verbose: boolean;
};
// VerboseAgentTranscriptProps：进度消息 + 工具表 + verbose 开关。
function VerboseAgentTranscript(t0) {
  const $ = _c(15);
  const {
    progressMessages,
    tools,
    verbose
  } = t0;
  let t1;
  if ($[0] !== progressMessages) {
    t1 = buildSubagentLookups(progressMessages.filter(_temp2).map(_temp3));
    $[0] = progressMessages;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const {
    lookups: agentLookups,
    inProgressToolUseIDs
  } = t1;
  let t2;
  if ($[2] !== agentLookups || $[3] !== inProgressToolUseIDs || $[4] !== progressMessages || $[5] !== tools || $[6] !== verbose) {
    const filteredMessages = progressMessages.filter(_temp4);
    let t3;
    if ($[8] !== agentLookups || $[9] !== inProgressToolUseIDs || $[10] !== tools || $[11] !== verbose) {
      t3 = progressMessage => <MessageResponse key={progressMessage.uuid} height={1}><MessageComponent message={progressMessage.data.message} lookups={agentLookups} addMargin={false} tools={tools} commands={[]} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={[]} shouldAnimate={false} shouldShowDot={false} isTranscriptMode={false} isStatic={true} /></MessageResponse>;
      $[8] = agentLookups;
      $[9] = inProgressToolUseIDs;
      $[10] = tools;
      $[11] = verbose;
      $[12] = t3;
    } else {
      t3 = $[12];
    }
    t2 = filteredMessages.map(t3);
    $[2] = agentLookups;
    $[3] = inProgressToolUseIDs;
    $[4] = progressMessages;
    $[5] = tools;
    $[6] = verbose;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  let t3;
  if ($[13] !== t2) {
    t3 = <>{t2}</>;
    $[13] = t2;
    $[14] = t3;
  } else {
    t3 = $[14];
  }
  return t3;
}
// VerboseAgentTranscript：transcript 模式的完整逐条渲染。先 buildSubagentLookups 建查表（工具名→工具对象、进行中的 tool_use ID 集合），再逐条 MessageComponent——isStatic + shouldAnimate=false，历史记录不做逐字动画。
function _temp4(pm_1) {
  if (!hasProgressMessage(pm_1.data)) {
    return false;
  }
  const msg = pm_1.data.message;
  if (msg.type === "user" && msg.toolUseResult === undefined) {
    return false;
  }
  return true;
}
// _temp4 过滤：user 消息没有 toolUseResult 的剔掉——与 107 行同一个理由，渲染出来是空行。
function _temp3(pm_0) {
  return pm_0.data;
}
function _temp2(pm) {
  return hasProgressMessage(pm.data);
}
export function renderToolResultMessage(data: Output, progressMessagesForMessage: ProgressMessage<Progress>[], {
  tools,
  verbose,
  theme,
  isTranscriptMode = false
}: {
  tools: Tools;
  verbose: boolean;
  theme: ThemeName;
  isTranscriptMode?: boolean;
}): React.ReactNode {
// renderToolResultMessage 三分支：remote_launched（ant-only 私有输出类型，公开 schema 里没有，靠内部判别式窄化）/ async_launched（后台启动）/ completed（正常结果）。
  // Remote-launched agents (ant-only) use a private output type not in the
  // public schema. Narrow via the internal discriminant.
  const internal = data as Output | RemoteLaunchedOutput;
  if (internal.status === 'remote_launched') {
    return <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text>
            Remote agent launched{' '}
            <Text dimColor>
              · {internal.taskId} · {internal.sessionUrl}
            </Text>
          </Text>
        </MessageResponse>
      </Box>;
  }
// remote_launched 渲染：一行 Remote agent launched + taskId + sessionUrl（dimColor）——远程 agent 在 CCR 里跑，本地只给追踪入口。
  if (data.status === 'async_launched') {
    const {
      prompt
    } = data;
    return <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text>
            Backgrounded agent
            {!isTranscriptMode && <Text dimColor>
                {' ('}
                <Byline>
                  <KeyboardShortcutHint shortcut="↓" action="manage" />
                  {prompt && <ConfigurableShortcutHint action="app:toggleTranscript" context="Global" fallback="ctrl+o" description="expand" />}
                </Byline>
                {')'}
              </Text>}
          </Text>
        </MessageResponse>
        {isTranscriptMode && prompt && <MessageResponse>
            <AgentPromptDisplay prompt={prompt} theme={theme} />
          </MessageResponse>}
      </Box>;
  }
// async_launched 渲染：Backgrounded agent + ↓ manage 快捷键提示；transcript 模式才展开 prompt（普通模式 prompt 在工具调用行已经显示过）。
  if (data.status !== 'completed') {
    return null;
  }
// 其他状态（killed/failed 等）返回 null——错误和拒绝渲染有专门入口（renderToolUseErrorMessage / renderToolUseRejectedMessage），不在这里重复。
  const {
    agentId,
    totalDurationMs,
    totalToolUseCount,
    totalTokens,
    usage,
    content,
    prompt
  } = data;
  const result = [totalToolUseCount === 1 ? '1 tool use' : `${totalToolUseCount} tool uses`, formatNumber(totalTokens) + ' tokens', formatDuration(totalDurationMs)];
  const completionMessage = `Done (${result.join(' · ')})`;
// 完成态统计行：Done (N tool uses · N tokens · 时长)。createAssistantMessage 伪造一条 assistant 消息承载 usage（inference_geo/iterations/speed 补 null 占位）——复用 MessageComponent 的完整渲染管线，而不是另写一套统计 UI。
  const finalAssistantMessage = createAssistantMessage({
    content: completionMessage,
    usage: {
      ...usage,
      inference_geo: null,
      iterations: null,
      speed: null
    }
  });
// 下面 return 里的 "external" === 'ant' 是又一处泄漏构建的环境替换事故标本：ant 构建才显示 subagent 的 API dump 路径，外部构建里这段恒假、被 DCE 成死代码（与 SyntheticOutputTool 那两处同款）。
  return <Box flexDirection="column">
      {"external" === 'ant' && <MessageResponse>
          <Text color="warning">
            [ANT-ONLY] API calls: {getDisplayPath(getDumpPromptsPath(agentId))}
          </Text>
        </MessageResponse>}
      {isTranscriptMode && prompt && <MessageResponse>
          <AgentPromptDisplay prompt={prompt} theme={theme} />
        </MessageResponse>}
      {isTranscriptMode ? <SubAgentProvider>
          <VerboseAgentTranscript progressMessages={progressMessagesForMessage} tools={tools} verbose={verbose} />
        </SubAgentProvider> : null}
      {isTranscriptMode && content && content.length > 0 && <MessageResponse>
          <AgentResponseDisplay content={content} theme={theme} />
        </MessageResponse>}
      <MessageResponse height={1}>
        <MessageComponent message={finalAssistantMessage} lookups={EMPTY_LOOKUPS} addMargin={false} tools={tools} commands={[]} verbose={verbose} inProgressToolUseIDs={new Set()} progressMessagesForMessage={[]} shouldAnimate={false} shouldShowDot={false} isTranscriptMode={false} isStatic={true} />
      </MessageResponse>
      {!isTranscriptMode && <Text dimColor>
          {'  '}
          <CtrlOToExpand />
        </Text>}
    </Box>;
}
// 收尾组装：transcript 模式三段（prompt 展示 / 逐条 transcript / response 展示）+ 完成行 + 非 transcript 模式的 ctrl+o 展开提示。
export function renderToolUseMessage({
  description,
  prompt
}: Partial<{
  description: string;
  prompt: string;
}>): React.ReactNode {
  if (!description || !prompt) {
    return null;
  }
  return description;
}
// renderToolUseMessage：工具调用行只显示 description；description 或 prompt 缺失返回 null（不渲染半行）。
export function renderToolUseTag(input: Partial<{
  description: string;
  prompt: string;
  subagent_type: string;
  model?: ModelAlias;
}>): React.ReactNode {
  const tags: React.ReactNode[] = [];
  if (input.model) {
    const mainModel = getMainLoopModel();
    const agentModel = parseUserSpecifiedModel(input.model);
    if (agentModel !== mainModel) {
      tags.push(<Box key="model" flexWrap="nowrap" marginLeft={1}>
          <Text dimColor>{renderModelName(agentModel)}</Text>
        </Box>);
    }
  }
  if (tags.length === 0) {
    return null;
  }
  return <>{tags}</>;
}
// renderToolUseTag：模型标签——parseUserSpecifiedModel 归一化后与主循环模型不同才显示（同模型不占地方）。
const INITIALIZING_TEXT = 'Initializing…';
export function renderToolUseProgressMessage(progressMessages: ProgressMessage<Progress>[], {
  tools,
  verbose,
  terminalSize,
  inProgressToolCallCount,
  isTranscriptMode = false
}: {
  tools: Tools;
  verbose: boolean;
  terminalSize?: {
    columns: number;
    rows: number;
  };
  inProgressToolCallCount?: number;
  isTranscriptMode?: boolean;
}): React.ReactNode {
  if (!progressMessages.length) {
    return <MessageResponse height={1}>
        <Text dimColor>{INITIALIZING_TEXT}</Text>
      </MessageResponse>;
  }
// 空进度（agent 起了但一条消息都没产出）显示 Initializing…，height=1 占位防布局跳动。

  // Checks to see if we should show a super condensed progress message summary.
  // This prevents flickers when the terminal size is too small to render all the dynamic content
  const toolToolRenderLinesEstimate = (inProgressToolCallCount ?? 1) * ESTIMATED_LINES_PER_TOOL + TERMINAL_BUFFER_LINES;
  const shouldUseCondensedMode = !isTranscriptMode && terminalSize && terminalSize.rows && terminalSize.rows < toolToolRenderLinesEstimate;
// condensed mode 判据：非 transcript 模式且终端行数 < 在途工具数 × 9 行 + 7 行缓冲——终端装不下动态内容时压成一行统计，防滚动闪烁。
  const getProgressStats = () => {
    const toolUseCount = count(progressMessages, msg => {
      if (!hasProgressMessage(msg.data)) {
        return false;
      }
      const message = msg.data.message;
      return message.message.content.some(content => content.type === 'tool_use');
    });
    const latestAssistant = progressMessages.findLast((msg): msg is ProgressMessage<AgentToolProgress> => hasProgressMessage(msg.data) && msg.data.message.type === 'assistant');
    let tokens = null;
    if (latestAssistant?.data.message.type === 'assistant') {
      const usage = latestAssistant.data.message.message.usage;
      tokens = (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + usage.input_tokens + usage.output_tokens;
    }
    return {
      toolUseCount,
      tokens
    };
  };
// getProgressStats：toolUseCount 数含 tool_use 块的消息；tokens 取最后一条 assistant 的四项用量和（cache_creation + cache_read + input + output）——进行中没有最终 usage，用最新一条近似。
  if (shouldUseCondensedMode) {
    const {
      toolUseCount,
      tokens
    } = getProgressStats();
    return <MessageResponse height={1}>
        <Text dimColor>
          In progress… · <Text bold>{toolUseCount}</Text> tool{' '}
          {toolUseCount === 1 ? 'use' : 'uses'}
          {tokens && ` · ${formatNumber(tokens)} tokens`} ·{' '}
          <ConfigurableShortcutHint action="app:toggleTranscript" context="Global" fallback="ctrl+o" description="expand" parens />
        </Text>
      </MessageResponse>;
  }
// condensed 渲染：In progress… · N tool uses · N tokens · ctrl+o 展开提示——一行装下所有关键信息。

  // Process messages to group consecutive search/read operations into summaries (ants only)
  // isAgentRunning=true since this is the progress view while the agent is still running
  const processedMessages = processProgressMessages(progressMessages, tools, true);

  // For display, take the last few processed messages
  const displayedMessages = isTranscriptMode ? processedMessages : processedMessages.slice(-MAX_PROGRESS_MESSAGES_TO_SHOW);
// 显示策略：transcript 模式全量展示，普通模式只取处理后消息的最后 3 条。

  // Count hidden tool uses specifically (not all messages) to match the
  // final "Done (N tool uses)" count. Each tool use generates multiple
  // progress messages (tool_use + tool_result + text), so counting all
  // hidden messages inflates the number shown to the user.
  const hiddenMessages = isTranscriptMode ? [] : processedMessages.slice(0, Math.max(0, processedMessages.length - MAX_PROGRESS_MESSAGES_TO_SHOW));
// hiddenToolUseCount 只数工具调用（不是全部消息）——与最终 Done (N tool uses) 口径对齐。每条工具调用产生多条进度消息（tool_use + tool_result + text），数消息会把折叠计数吹大，用户看到 +17 more tool uses 而实际只有 5 次调用。
  const hiddenToolUseCount = count(hiddenMessages, m => {
    if (m.type === 'summary') {
      return m.searchCount + m.readCount + m.replCount > 0;
    }
    const data = m.message.data;
    if (!hasProgressMessage(data)) {
      return false;
    }
    return data.message.message.content.some(content => content.type === 'tool_use');
  });
  const firstData = progressMessages[0]?.data;
  const prompt = firstData && hasProgressMessage(firstData) ? firstData.prompt : undefined;
// prompt 从第一条进度数据取——agent 启动时的第一条进度带初始 prompt，后续进度不带。

  // After grouping, displayedMessages can be empty when the only progress so
  // far is an assistant tool_use for a search/read op (grouped but not yet
  // counted, since counts increment on tool_result). Fall back to the
  // initializing text so MessageResponse doesn't render a bare ⎿.
  if (displayedMessages.length === 0 && !(isTranscriptMode && prompt)) {
    return <MessageResponse height={1}>
        <Text dimColor>{INITIALIZING_TEXT}</Text>
      </MessageResponse>;
  }
// 分组后 displayedMessages 可能为空：唯一进度是 search/read 的 tool_use（已分组未计数——计数发生在 tool_result），回落 Initializing… 防 MessageResponse 渲染出一条裸的 ⎿。
  const {
    lookups: subagentLookups,
    inProgressToolUseIDs: collapsedInProgressIDs
  } = buildSubagentLookups(progressMessages.filter((pm): pm is ProgressMessage<AgentToolProgress> => hasProgressMessage(pm.data)).map(pm => pm.data));
// buildSubagentLookups 自建查表：progress 消息流里没有全局 lookups 可借，渲染前现建（与 VerboseAgentTranscript 同一函数）。
  return <MessageResponse>
      <Box flexDirection="column">
        <SubAgentProvider>
          {isTranscriptMode && prompt && <Box marginBottom={1}>
              <AgentPromptDisplay prompt={prompt} />
            </Box>}
          {displayedMessages.map(processed => {
          if (processed.type === 'summary') {
            // Render summary for grouped search/read/REPL operations using shared formatting
            const summaryText = getSearchReadSummaryText(processed.searchCount, processed.readCount, processed.isActive, processed.replCount);
            return <Box key={processed.uuid} height={1} overflow="hidden">
                  <Text dimColor>{summaryText}</Text>
                </Box>;
          }
          // Render original message without height=1 wrapper so null
          // content (tool not found, renderToolUseMessage returns null)
          // doesn't leave a blank line. Tool call headers are single-line
          // anyway so truncation isn't needed.
          return <MessageComponent key={processed.message.uuid} message={processed.message.data.message} lookups={subagentLookups} addMargin={false} tools={tools} commands={[]} verbose={verbose} inProgressToolUseIDs={collapsedInProgressIDs} progressMessagesForMessage={[]} shouldAnimate={false} shouldShowDot={false} style="condensed" isTranscriptMode={false} isStatic={true} />;
        })}
        </SubAgentProvider>
        {hiddenToolUseCount > 0 && <Text dimColor>
            +{hiddenToolUseCount} more tool{' '}
            {hiddenToolUseCount === 1 ? 'use' : 'uses'} <CtrlOToExpand />
          </Text>}
      </Box>
    </MessageResponse>;
}
// 主渲染：SubAgentProvider 提供 ctrl+o 展开上下文；summary 类型渲染单行摘要（height=1 + overflow hidden 防换行撑布局）；original 消息故意不加 height=1 包装——null 内容（工具没找到、renderToolUseMessage 返回 null）不会留空行，工具调用头本来就单行不需要截断。
export function renderToolUseRejectedMessage(_input: {
  description: string;
  prompt: string;
  subagent_type: string;
}, {
  progressMessagesForMessage,
  tools,
  verbose,
  isTranscriptMode
}: {
  columns: number;
  messages: Message[];
  style?: 'condensed';
  theme: ThemeName;
  progressMessagesForMessage: ProgressMessage<Progress>[];
  tools: Tools;
  verbose: boolean;
  isTranscriptMode?: boolean;
}): React.ReactNode {
  // Get agentId from progress messages if available (agent was running before rejection)
  const firstData = progressMessagesForMessage[0]?.data;
  const agentId = firstData && hasProgressMessage(firstData) ? firstData.agentId : undefined;
  return <>
      {"external" === 'ant' && agentId && <MessageResponse>
          <Text color="warning">
            [ANT-ONLY] API calls: {getDisplayPath(getDumpPromptsPath(agentId))}
          </Text>
        </MessageResponse>}
      {renderToolUseProgressMessage(progressMessagesForMessage, {
      tools,
      verbose,
      isTranscriptMode
    })}
      <FallbackToolUseRejectedMessage />
    </>;
}
// renderToolUseRejectedMessage：进度视图 + FallbackToolUseRejectedMessage；agentId 从第一条进度取（被拒前 agent 可能已经跑过一会，dump 路径要能定位）。
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  progressMessagesForMessage,
  tools,
  verbose,
  isTranscriptMode
}: {
  progressMessagesForMessage: ProgressMessage<Progress>[];
  tools: Tools;
  verbose: boolean;
  isTranscriptMode?: boolean;
}): React.ReactNode {
  return <>
      {renderToolUseProgressMessage(progressMessagesForMessage, {
      tools,
      verbose,
      isTranscriptMode
    })}
      <FallbackToolUseErrorMessage result={result} verbose={verbose} />
    </>;
}
// renderToolUseErrorMessage：进度视图 + FallbackToolUseErrorMessage（带原始 result 供 verbose 展开）。
function calculateAgentStats(progressMessages: ProgressMessage<Progress>[]): {
  toolUseCount: number;
  tokens: number | null;
} {
  const toolUseCount = count(progressMessages, msg => {
    if (!hasProgressMessage(msg.data)) {
      return false;
    }
    const message = msg.data.message;
    return message.type === 'user' && message.message.content.some(content => content.type === 'tool_result');
  });
  const latestAssistant = progressMessages.findLast((msg): msg is ProgressMessage<AgentToolProgress> => hasProgressMessage(msg.data) && msg.data.message.type === 'assistant');
  let tokens = null;
  if (latestAssistant?.data.message.type === 'assistant') {
    const usage = latestAssistant.data.message.message.usage;
    tokens = (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + usage.input_tokens + usage.output_tokens;
  }
  return {
    toolUseCount,
    tokens
  };
}
// calculateAgentStats：数 tool_result 消息（已完成调用口径，与 517 行的 tool_use 口径互补）；tokens 同 getProgressStats。
export function renderGroupedAgentToolUse(toolUses: Array<{
  param: ToolUseBlockParam;
  isResolved: boolean;
  isError: boolean;
  isInProgress: boolean;
  progressMessages: ProgressMessage<Progress>[];
  result?: {
    param: ToolResultBlockParam;
    output: Output;
  };
}>, options: {
  shouldAnimate: boolean;
  tools: Tools;
}): React.ReactNode | null {
  const {
    shouldAnimate,
    tools
  } = options;

  // Calculate stats for each agent
  const agentStats = toolUses.map(({
    param,
    isResolved,
    isError,
    progressMessages,
    result
  }) => {
    const stats = calculateAgentStats(progressMessages);
    const lastToolInfo = extractLastToolInfo(progressMessages, tools);
    const parsedInput = inputSchema().safeParse(param.input);

    // teammate_spawned is not part of the exported Output type (cast through unknown
    // for dead code elimination), so check via string comparison on the raw value
    const isTeammateSpawn = result?.output?.status as string === 'teammate_spawned';

    // For teammate spawns, show @name with type in parens and description as status
    let agentType: string;
    let description: string | undefined;
    let color: keyof Theme | undefined;
    let descriptionColor: keyof Theme | undefined;
    let taskDescription: string | undefined;
    if (isTeammateSpawn && parsedInput.success && parsedInput.data.name) {
      agentType = `@${parsedInput.data.name}`;
      const subagentType = parsedInput.data.subagent_type;
      description = isCustomSubagentType(subagentType) ? subagentType : undefined;
      taskDescription = parsedInput.data.description;
      // Use the custom agent definition's color on the type, not the name
      descriptionColor = isCustomSubagentType(subagentType) ? getAgentColor(subagentType) as keyof Theme | undefined : undefined;
    } else {
      agentType = parsedInput.success ? userFacingName(parsedInput.data) : 'Agent';
      description = parsedInput.success ? parsedInput.data.description : undefined;
      color = parsedInput.success ? userFacingNameBackgroundColor(parsedInput.data) : undefined;
      taskDescription = undefined;
    }

    // Check if this was launched as a background agent OR backgrounded mid-execution
    const launchedAsAsync = parsedInput.success && 'run_in_background' in parsedInput.data && parsedInput.data.run_in_background === true;
    const outputStatus = (result?.output as {
      status?: string;
    } | undefined)?.status;
    const backgroundedMidExecution = outputStatus === 'async_launched' || outputStatus === 'remote_launched';
    const isAsync = launchedAsAsync || backgroundedMidExecution || isTeammateSpawn;
    const name = parsedInput.success ? parsedInput.data.name : undefined;
    return {
      id: param.id,
      agentType,
      description,
      toolUseCount: stats.toolUseCount,
      tokens: stats.tokens,
      isResolved,
      isError,
      isAsync,
      color,
      descriptionColor,
      lastToolInfo,
      taskDescription,
      name
    };
// 每条 agent 的统计包：id / 显示类型 / 描述 / 工具数 / tokens / 颜色 / 最后工具信息 / 任务描述 / name——AgentProgressLine 的完整输入。
  });
  const anyUnresolved = toolUses.some(t => !t.isResolved);
  const anyError = toolUses.some(t => t.isError);
  const allComplete = !anyUnresolved;

  // Check if all agents are the same type
  const allSameType = agentStats.length > 0 && agentStats.every(stat => stat.agentType === agentStats[0]?.agentType);
  const commonType = allSameType && agentStats[0]?.agentType !== 'Agent' ? agentStats[0]?.agentType : null;
// commonType 折叠：全部同型才把类型藏进行头（N worker agents），hideType 传给 AgentProgressLine；全是默认 Agent 时不折叠（没有信息量）。

  // Check if all resolved agents are async (background)
  const allAsync = agentStats.every(stat => stat.isAsync);
  return <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <ToolUseLoader shouldAnimate={shouldAnimate && anyUnresolved} isUnresolved={anyUnresolved} isError={anyError} />
        <Text>
          {allComplete ? allAsync ? <>
                <Text bold>{toolUses.length}</Text> background agents launched{' '}
                <Text dimColor>
                  <KeyboardShortcutHint shortcut="↓" action="manage" parens />
                </Text>
              </> : <>
                <Text bold>{toolUses.length}</Text>{' '}
                {commonType ? `${commonType} agents` : 'agents'} finished
              </> : <>
              Running <Text bold>{toolUses.length}</Text>{' '}
              {commonType ? `${commonType} agents` : 'agents'}…
            </>}{' '}
        </Text>
        {!allAsync && <CtrlOToExpand />}
      </Box>
      {agentStats.map((stat, index) => <AgentProgressLine key={stat.id} agentType={stat.agentType} description={stat.description} descriptionColor={stat.descriptionColor} taskDescription={stat.taskDescription} toolUseCount={stat.toolUseCount} tokens={stat.tokens} color={stat.color} isLast={index === agentStats.length - 1} isResolved={stat.isResolved} isError={stat.isError} isAsync={stat.isAsync} shouldAnimate={shouldAnimate} lastToolInfo={stat.lastToolInfo} hideType={allSameType} name={stat.name} />)}
    </Box>;
}
// 分组渲染：ToolUseLoader（有未解决才转圈）+ 三态文案（N background agents launched / N agents finished / Running N agents…）+ 每条 agent 一个 AgentProgressLine（isLast 控制树形连接线）。
export function userFacingName(input: Partial<{
  description: string;
  prompt: string;
  subagent_type: string;
  name: string;
  team_name: string;
}> | undefined): string {
  if (input?.subagent_type && input.subagent_type !== GENERAL_PURPOSE_AGENT.agentType) {
    // Display "worker" agents as "Agent" for cleaner UI
    if (input.subagent_type === 'worker') {
      return 'Agent';
    }
    return input.subagent_type;
  }
  return 'Agent';
}
// userFacingName：subagent_type 是 worker 时显示成 Agent（内部类型名不外露）；general-purpose 同样显示 Agent；没有 subagent_type 也回落 Agent。
export function userFacingNameBackgroundColor(input: Partial<{
  description: string;
  prompt: string;
  subagent_type: string;
}> | undefined): keyof Theme | undefined {
  if (!input?.subagent_type) {
    return undefined;
  }

  // Get the color for this agent
  return getAgentColor(input.subagent_type) as keyof Theme | undefined;
}
// userFacingNameBackgroundColor：按 subagent_type 从 agentColorManager 注册表取色——frontmatter 里声明过 color 的 agent 有专属色。
export function extractLastToolInfo(progressMessages: ProgressMessage<Progress>[], tools: Tools): string | null {
  // Build tool_use lookup from all progress messages (needed for reverse iteration)
  const toolUseByID = new Map<string, ToolUseBlockParam>();
  for (const pm of progressMessages) {
    if (!hasProgressMessage(pm.data)) {
      continue;
    }
    if (pm.data.message.type === 'assistant') {
      for (const c of pm.data.message.message.content) {
        if (c.type === 'tool_use') {
          toolUseByID.set(c.id, c as ToolUseBlockParam);
        }
      }
    }
  }

  // Count trailing consecutive search/read operations from the end
  let searchCount = 0;
  let readCount = 0;
  for (let i = progressMessages.length - 1; i >= 0; i--) {
    const msg = progressMessages[i]!;
    if (!hasProgressMessage(msg.data)) {
      continue;
    }
    const info = getSearchOrReadInfo(msg, tools, toolUseByID);
    if (info && (info.isSearch || info.isRead)) {
      // Only count tool_result messages to avoid double counting
      if (msg.data.message.type === 'user') {
        if (info.isSearch) {
          searchCount++;
        } else if (info.isRead) {
          readCount++;
        }
      }
    } else {
      break;
    }
  }
  if (searchCount + readCount >= 2) {
    return getSearchReadSummaryText(searchCount, readCount, true);
  }

  // Find the last tool_result message
  const lastToolResult = progressMessages.findLast((msg): msg is ProgressMessage<AgentToolProgress> => {
    if (!hasProgressMessage(msg.data)) {
      return false;
    }
    const message = msg.data.message;
    return message.type === 'user' && message.message.content.some(c => c.type === 'tool_result');
  });
  if (lastToolResult?.data.message.type === 'user') {
    const toolResultBlock = lastToolResult.data.message.message.content.find(c => c.type === 'tool_result');
    if (toolResultBlock?.type === 'tool_result') {
      // Look up the corresponding tool_use — already indexed above
      const toolUseBlock = toolUseByID.get(toolResultBlock.tool_use_id);
      if (toolUseBlock) {
        const tool = findToolByName(tools, toolUseBlock.name);
        if (!tool) {
          return toolUseBlock.name; // Fallback to raw name
        }
        const input = toolUseBlock.input as Record<string, unknown>;
        const parsedInput = tool.inputSchema.safeParse(input);

        // Get user-facing tool name
        const userFacingToolName = tool.userFacingName(parsedInput.success ? parsedInput.data : undefined);

        // Try to get summary from the tool itself
        if (tool.getToolUseSummary) {
          const summary = tool.getToolUseSummary(parsedInput.success ? parsedInput.data : undefined);
          if (summary) {
            return `${userFacingToolName}: ${summary}`;
          }
        }

        // Default: just show user-facing tool name
        return userFacingToolName;
      }
    }
  }
  return null;
}
// extractLastToolInfo 两段式：先数末尾连续的 search/read（≥2 出摘要行，进行时态）；否则找最后一条 tool_result → 反查 tool_use → findToolByName 拿工具定义 → userFacingName + getToolUseSummary 摘要；工具没注册（MCP 断开等）回落原始工具名。
function isCustomSubagentType(subagentType: string | undefined): subagentType is string {
  return !!subagentType && subagentType !== GENERAL_PURPOSE_AGENT.agentType && subagentType !== 'worker';
}
// isCustomSubagentType：非 general-purpose 非 worker 即自定义 agent——着色和类型名特例都按这个判。
// 原文件此处有一行 92628 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。