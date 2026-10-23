import { c as _c } from "react/compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { ShellProgressMessage } from '../../components/shell/ShellProgressMessage.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { useAppStateStore, useSetAppState } from '../../state/AppState.js';
import type { Tool } from '../../Tool.js';
import { backgroundAll } from '../../tasks/LocalShellTask/LocalShellTask.js';
import type { ProgressMessage } from '../../types/message.js';
import { env } from '../../utils/env.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { getDisplayPath } from '../../utils/file.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import type { ThemeName } from '../../utils/theme.js';
import type { BashProgress, BashToolInput, Out } from './BashTool.js';
import BashToolResultMessage from './BashToolResultMessage.js';
import { extractBashCommentLabel } from './commentLabel.js';
import { parseSedEditCommand } from './sedEditParser.js';

// Constants for command display
// 命令显示的两道截断线：2 行 / 160 字符。
const MAX_COMMAND_DISPLAY_LINES = 2;
const MAX_COMMAND_DISPLAY_CHARS = 160;

// Simple component to show background hint and handle ctrl+b
// When ctrl+b is pressed, backgrounds ALL running foreground commands
// BackgroundHint：ctrl+b 把**所有**前台运行中的命令转后台（backgroundAll 批量操作，不是只转当前一条）。
export function BackgroundHint(t0) {
  const $ = _c(9);
  let t1;
  if ($[0] !== t0) {
    t1 = t0 === undefined ? {} : t0;
    $[0] = t0;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const {
    onBackground
  } = t1;
  const store = useAppStateStore();
  const setAppState = useSetAppState();
  let t2;
  if ($[2] !== onBackground || $[3] !== setAppState || $[4] !== store) {
    t2 = () => {
// handleBackground 从 AppState store 现取状态再 backgroundAll——不用闭包旧状态。
      backgroundAll(() => store.getState(), setAppState);
      onBackground?.();
    };
    $[2] = onBackground;
    $[3] = setAppState;
    $[4] = store;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const handleBackground = t2;
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      context: "Task"
    };
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  useKeybinding("task:background", handleBackground, t3);
// 快捷键走 useKeybinding 注册（context: Task），显示文案走 useShortcutDisplay。
  const baseShortcut = useShortcutDisplay("task:background", "Task", "ctrl+b");
// tmux 环境下 ctrl+b 会被 tmux 自己吃掉，提示改成 ctrl+b ctrl+b（按两次）。
  const shortcut = env.terminal === "tmux" && baseShortcut === "ctrl+b" ? "ctrl+b ctrl+b (twice)" : baseShortcut;
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)) {
// CLAUDE_CODE_DISABLE_BACKGROUND_TASKS 环境变量直接隐藏整个 hint。
    return null;
  }
  let t4;
  if ($[7] !== shortcut) {
    t4 = <Box paddingLeft={5}><Text dimColor={true}><KeyboardShortcutHint shortcut={shortcut} action="run in background" parens={true} /></Text></Box>;
    $[7] = shortcut;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  return t4;
}
export function renderToolUseMessage(input: Partial<BashToolInput>, {
// renderToolUseMessage 决定工具调用在对话里长什么样。
  verbose,
  theme: _theme
}: {
  verbose: boolean;
  theme: ThemeName;
}): React.ReactNode {
  const {
    command
  } = input;
  if (!command) {
    return null;
  }

  // Render sed in-place edits like file edits (show file path only)
// sed -i 就地编辑的渲染特判：只显示文件路径（像文件编辑一样），不显示又长又难读的 sed 表达式。verbose 模式才给完整路径。
  const sedInfo = parseSedEditCommand(command);
  if (sedInfo) {
    return verbose ? sedInfo.filePath : getDisplayPath(sedInfo.filePath);
  }
  if (!verbose) {
// 非 verbose 模式的截断逻辑：先看全屏环境下有没有注释标签可替代。
    const lines = command.split('\n');
    if (isFullscreenEnvEnabled()) {
// 全屏模式（isFullscreenEnvEnabled）优先用命令里的注释标签（# xxx）当显示文本——人类写的注释比截断的命令更好读。
      const label = extractBashCommentLabel(command);
      if (label) {
        return label.length > MAX_COMMAND_DISPLAY_CHARS ? label.slice(0, MAX_COMMAND_DISPLAY_CHARS) + '…' : label;
      }
    }
    const needsLineTruncation = lines.length > MAX_COMMAND_DISPLAY_LINES;
// 行数和字符数双重截断：先切行再切字符，末尾加省略号。
    const needsCharTruncation = command.length > MAX_COMMAND_DISPLAY_CHARS;
    if (needsLineTruncation || needsCharTruncation) {
      let truncated = command;

      // First truncate by lines if needed
      if (needsLineTruncation) {
        truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n');
      }

      // Then truncate by chars if still too long
      if (truncated.length > MAX_COMMAND_DISPLAY_CHARS) {
        truncated = truncated.slice(0, MAX_COMMAND_DISPLAY_CHARS);
      }
      return <Text>{truncated.trim()}…</Text>;
// truncated.trim() 后再加 …——避免截断点正好在空白上出现「空格 + 省略号」。
    }
  }
  return command;
}
export function renderToolUseProgressMessage(progressMessagesForMessage: ProgressMessage<BashProgress>[], {
// renderToolUseProgressMessage：取最后一条 progress（.at(-1)），没有就显示 Running…。
  verbose,
  tools: _tools,
  terminalSize: _terminalSize,
  inProgressToolCallCount: _inProgressToolCallCount
}: {
  tools: Tool[];
  verbose: boolean;
  terminalSize?: {
    columns: number;
    rows: number;
  };
  inProgressToolCallCount?: number;
}): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1);
// 有进度数据就交给 ShellProgressMessage（完整输出、已用时间、行数、字节数、超时、taskId）。
  if (!lastProgress || !lastProgress.data) {
    return <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>;
  }
  const data = lastProgress.data;
  return <ShellProgressMessage fullOutput={data.fullOutput} output={data.output} elapsedTimeSeconds={data.elapsedTimeSeconds} totalLines={data.totalLines} totalBytes={data.totalBytes} timeoutMs={data.timeoutMs} taskId={data.taskId} verbose={verbose} />;
}
export function renderToolUseQueuedMessage(): React.ReactNode {
// 排队中的调用显示 Waiting…。
  return <MessageResponse height={1}>
      <Text dimColor>Waiting…</Text>
    </MessageResponse>;
}
export function renderToolResultMessage(content: Out, progressMessagesForMessage: ProgressMessage<BashProgress>[], {
// renderToolResultMessage：timeoutMs 从最后一条 progress 里取（结果消息本身不带）。
  verbose,
  theme: _theme,
  tools: _tools,
  style: _style
}: {
  verbose: boolean;
  theme: ThemeName;
  tools: Tool[];
  style?: 'condensed';
}): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1);
  const timeoutMs = lastProgress?.data?.timeoutMs;
  return <BashToolResultMessage content={content} verbose={verbose} timeoutMs={timeoutMs} />;
}
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
// 错误消息走通用 FallbackToolUseErrorMessage。
  verbose,
  progressMessagesForMessage: _progressMessagesForMessage,
  tools: _tools
}: {
  verbose: boolean;
  progressMessagesForMessage: ProgressMessage<BashProgress>[];
  tools: Tool[];
}): React.ReactNode {
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
// 原文件此处有一行 18760 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。