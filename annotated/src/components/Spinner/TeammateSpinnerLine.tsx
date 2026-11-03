import figures from 'figures';
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { useRef, useState } from 'react';
import { getSpinnerVerbs } from '../../constants/spinnerVerbs.js';
import { TURN_COMPLETION_VERBS } from '../../constants/turnCompletionVerbs.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { summarizeRecentActivities } from '../../utils/collapseReadSearch.js';
import { formatDuration, formatNumber, truncateToWidth } from '../../utils/format.js';
import { toInkColor } from '../../utils/ink.js';
import { TEAMMATE_SELECT_HINT } from './teammateSelectHint.js';
// Props 类型：对端智能体的展示属性（是否选中、是否空闲、是否显示预览等）。
type Props = {
  teammate: InProcessTeammateTaskState;
  isLast: boolean;
  isSelected?: boolean;
  isForegrounded?: boolean;
  allIdle?: boolean;
  showPreview?: boolean;
};

/**
 * Extract the last 3 lines of content from a teammate's conversation.
 * Shows recent activity from any message type (user or assistant).
 */
// 文档注释：从对端最近对话里抽取最后 3 行作为预览。
// getMessagePreview：从最近消息（用户或助手）里收集最多 3 行预览文本。
function getMessagePreview(messages: InProcessTeammateTaskState['messages']): string[] {
  if (!messages?.length) return [];
  const allLines: string[] = [];
  const maxLineLength = 80;

  // Collect lines from recent messages (newest first)
  for (let i = messages.length - 1; i >= 0 && allLines.length < 3; i--) {
    const msg = messages[i];
    // Only process messages that have content (user/assistant messages)
    if (!msg || msg.type !== 'user' && msg.type !== 'assistant' || !msg.message?.content?.length) {
      continue;
    }
    const content = msg.message.content;
    for (const block of content) {
      if (allLines.length >= 3) break;
      if (!block || typeof block !== 'object') continue;
      if ('type' in block && block.type === 'tool_use' && 'name' in block) {
        // Try to show meaningful info from tool input
        const input = 'input' in block ? block.input as Record<string, unknown> : null;
        let toolLine = `Using ${block.name}…`;
        if (input) {
          // Look for common descriptive fields
          const desc = input.description as string | undefined || input.prompt as string | undefined || input.command as string | undefined || input.query as string | undefined || input.pattern as string | undefined;
          if (desc) {
            toolLine = desc.split('\n')[0] ?? toolLine;
          }
        }
        allLines.push(truncateToWidth(toolLine, maxLineLength));
      } else if ('type' in block && block.type === 'text' && 'text' in block) {
        const textLines = (block.text as string).split('\n').filter(l => l.trim());
        // Take from end of text (most recent lines)
        for (let j = textLines.length - 1; j >= 0 && allLines.length < 3; j--) {
          const line = textLines[j];
          if (!line) continue;
          allLines.push(truncateToWidth(line, maxLineLength));
        }
      }
    }
  }

  // Reverse so oldest of the 3 is first (reading order)
  return allLines.reverse();
}
export function TeammateSpinnerLine({
  teammate,
  isLast,
  isSelected,
  isForegrounded,
  allIdle,
  showPreview
}: Props): React.ReactNode {
// 随机动效动词：优先用对端自带 spinnerVerb，否则从全局动词表随机取一个。
  const [randomVerb] = useState(() => teammate.spinnerVerb ?? sample(getSpinnerVerbs()));
  const [pastTenseVerb] = useState(() => teammate.pastTenseVerb ?? sample(TURN_COMPLETION_VERBS));
  const isHighlighted = isSelected || isForegrounded;
  const treeChar = isHighlighted ? isLast ? '╘═' : '╞═' : isLast ? '└─' : '├─';
// 根据高亮状态选择树形连接符（╘/╞/└/├）。
  const nameColor = toInkColor(teammate.identity.color);
  const {
    columns
  } = useTerminalSize();

  // Track when teammate became idle (for "Idle for X..." display)
  const idleStartRef = useRef<number | null>(null);
  // Freeze elapsed time when entering all-idle state
  const frozenDurationRef = useRef<string | null>(null);

  // Track idle start time
// 记录对端进入空闲的开始时刻，用于显示「已空闲 X 秒」。
  if (teammate.isIdle && idleStartRef.current === null) {
    idleStartRef.current = Date.now();
  } else if (!teammate.isIdle) {
    idleStartRef.current = null;
  }

  // Reset frozen duration when leaving all-idle state
  if (!allIdle && frozenDurationRef.current !== null) {
    frozenDurationRef.current = null;
  }

  // Get elapsed idle time (how long they've been idle) - for "Idle for X..." display
// 计算已空闲时长；全部空闲时冻结显示时长，不再实时跳动。
  const idleElapsedTime = useElapsedTime(idleStartRef.current ?? Date.now(), teammate.isIdle && !allIdle);

  // Freeze the duration when we first detect all idle
  // Use the teammate's actual work time (since task started) for the past-tense display
  if (allIdle && frozenDurationRef.current === null) {
    frozenDurationRef.current = formatDuration(Math.max(0, Date.now() - teammate.startTime - (teammate.totalPausedMs ?? 0)));
  }

  // Use frozen work duration when all idle, otherwise use idle elapsed time
  const displayTime = allIdle ? frozenDurationRef.current ?? (() => {
    throw new Error(`frozenDurationRef is null for idle teammate ${teammate.identity.agentName}`);
  })() : idleElapsedTime;

// 响应式布局：先计算固定前缀宽度，再按终端列数决定显示哪些信息。
  // Layout: paddingLeft(3) + pointer(1) + space(1) + treeChar(2) + space(1) = 8 fixed chars
  // Then optionally: @name + ": " OR just ": "
  // Then: activity text + optional extras (stats, hints)
  const basePrefix = 8;
  const fullAgentName = `@${teammate.identity.agentName}`;
  const fullNameWidth = stringWidth(fullAgentName);

  // Get stats from progress
  const toolUseCount = teammate.progress?.toolUseCount ?? 0;
  const tokenCount = teammate.progress?.tokenCount ?? 0;
  const statsText = ` · ${toolUseCount} tool ${toolUseCount === 1 ? 'use' : 'uses'} · ${formatNumber(tokenCount)} tokens`;
  const statsWidth = stringWidth(statsText);
  const selectHintText = ` · ${TEAMMATE_SELECT_HINT}`;
  const selectHintWidth = stringWidth(selectHintText);
  const viewHintText = ' · enter to view';
  const viewHintWidth = stringWidth(viewHintText);

  // Progressive responsive layout:
  // Wide (80+): full name + activity + stats + hint
  // Medium (60-80): full name + activity
  // Narrow (<60): hide name, just show activity
  const minActivityWidth = 25;

  // Hide name on narrow terminals (< 60 cols) or if there's not enough room
  const spaceWithFullName = columns - basePrefix - fullNameWidth - 2;
  const showName = columns >= 60 && spaceWithFullName >= minActivityWidth;
  const nameWidth = showName ? fullNameWidth + 2 : 0; // +2 for ": " when name shown
  const availableForActivity = columns - basePrefix - nameWidth;

  // Progressive hiding: view hint → select hint → stats
  // Stats always visible (dimmed when not selected); hints only when highlighted/selected
// 渐进式隐藏：优先级为 查看提示 → 选择提示 → 统计信息，空间不够依次隐藏。
  const showViewHint = isSelected && !isForegrounded && availableForActivity > viewHintWidth + statsWidth + minActivityWidth + 5;
  const showSelectHint = isHighlighted && availableForActivity > selectHintWidth + (showViewHint ? viewHintWidth : 0) + statsWidth + minActivityWidth + 5;
  const showStats = availableForActivity > statsWidth + minActivityWidth + 5;

  // Activity text gets remaining space
  const extrasCost = (showStats ? statsWidth : 0) + (showSelectHint ? selectHintWidth : 0) + (showViewHint ? viewHintWidth : 0);
  const activityMaxWidth = Math.max(minActivityWidth, availableForActivity - extrasCost - 1);

  // Format the activity text for active teammates, rolling up search/read ops
  const activityText = (() => {
    const activities = teammate.progress?.recentActivities;
    if (activities && activities.length > 0) {
      const summary = summarizeRecentActivities(activities);
      if (summary) return truncateToWidth(summary, activityMaxWidth);
    }
    const desc = teammate.progress?.lastActivity?.activityDescription;
    if (desc) return truncateToWidth(desc, activityMaxWidth);
    return randomVerb;
  })();

// renderStatus：根据对端状态渲染不同的状态文案（停止中/待审批/空闲/进行中）。
  // Status rendering logic
  const renderStatus = (): React.ReactNode => {
    if (teammate.shutdownRequested) {
      return <Text dimColor>[stopping]</Text>;
    }
    if (teammate.awaitingPlanApproval) {
      return <Text color="warning">[awaiting approval]</Text>;
    }
    if (teammate.isIdle) {
      if (allIdle) {
        return <Text dimColor>
            {pastTenseVerb} for {displayTime}
          </Text>;
      }
      return <Text dimColor>Idle for {idleElapsedTime}</Text>;
    }
    // Active - show spinner glyph + activity description (only when not highlighted;
    // when highlighted, the main spinner above already shows the verb)
    if (isHighlighted) {
      return null;
    }
    return <Text dimColor>
        {activityText?.endsWith('…') ? activityText : `${activityText}…`}
      </Text>;
  };

  // Get preview lines if enabled
// 若开启预览，则取出最近消息的预览行。
  const previewLines = showPreview ? getMessagePreview(teammate.messages) : [];

  // Tree continuation character for preview lines
  const previewTreeChar = isLast ? '   ' : '│  ';
// 渲染：外层纵向布局，先画带指针与树形符的主行，再追加预览行。
  return <Box flexDirection="column">
      <Box paddingLeft={3}>
        {/* Selection indicator: pointer when selected, otherwise space */}
        <Text color={isSelected ? 'suggestion' : undefined} bold={isSelected}>
          {isSelected ? figures.pointer : ' '}
        </Text>
        <Text dimColor={!isSelected}>{treeChar} </Text>
        {/* Agent name: hidden on very narrow screens */}
        {showName && <Text color={isSelected ? 'suggestion' : nameColor}>
            @{teammate.identity.agentName}
          </Text>}
        {showName && <Text dimColor={!isSelected}>: </Text>}
        {renderStatus()}
        {/* Stats: only shown when selected and terminal is wide enough */}
        {showStats && <Text dimColor>
            {' '}
            · {toolUseCount} tool {toolUseCount === 1 ? 'use' : 'uses'} ·{' '}
            {formatNumber(tokenCount)} tokens
          </Text>}
        {/* Hints: select hint when highlighted, view hint when selected but not foregrounded */}
        {showSelectHint && <Text dimColor> · {TEAMMATE_SELECT_HINT}</Text>}
        {showViewHint && <Text dimColor> · enter to view</Text>}
      </Box>
      {/* Preview lines */}
      {previewLines.map((line, idx) => <Box key={idx} paddingLeft={3}>
          <Text dimColor> </Text>
          <Text dimColor>{previewTreeChar} </Text>
          <Text dimColor>{line}</Text>
        </Box>)}
    </Box>;
}
// 原文件此处有一行 28496 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。