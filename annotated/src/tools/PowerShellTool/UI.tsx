import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { ShellProgressMessage } from '../../components/shell/ShellProgressMessage.js';
import { ShellTimeDisplay } from '../../components/shell/ShellTimeDisplay.js';
import { Box, Text } from '../../ink.js';
import type { Tool } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { PowerShellProgress } from '../../types/tools.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Out, PowerShellToolInput } from './PowerShellTool.js';

// Constants for command display
const MAX_COMMAND_DISPLAY_LINES = 2;
const MAX_COMMAND_DISPLAY_CHARS = 160;
// 非交互模式命令显示双限：2 行加 160 字符，超限截断加省略号——长命令不必整段刷屏。
export function renderToolUseMessage(input: Partial<PowerShellToolInput>, {
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
  const displayCommand = command;
  if (!verbose) {
    const lines = displayCommand.split('\n');
    const needsLineTruncation = lines.length > MAX_COMMAND_DISPLAY_LINES;
    const needsCharTruncation = displayCommand.length > MAX_COMMAND_DISPLAY_CHARS;
    if (needsLineTruncation || needsCharTruncation) {
      let truncated = displayCommand;
      if (needsLineTruncation) {
        truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n');
      }
      if (truncated.length > MAX_COMMAND_DISPLAY_CHARS) {
        truncated = truncated.slice(0, MAX_COMMAND_DISPLAY_CHARS);
      }
      return <Text>{truncated.trim()}…</Text>;
    }
  }
  return displayCommand;
}
// verbose 直接全文返回，多行命令不做行数截断。
export function renderToolUseProgressMessage(progressMessagesForMessage: ProgressMessage<PowerShellProgress>[], {
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
  if (!lastProgress || !lastProgress.data) {
    return <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>;
  }
  const data = lastProgress.data;
  return <ShellProgressMessage fullOutput={data.fullOutput} output={data.output} elapsedTimeSeconds={data.elapsedTimeSeconds} totalLines={data.totalLines} totalBytes={data.totalBytes} timeoutMs={data.timeoutMs} taskId={data.taskId} verbose={verbose} />;
// 进度复用 ShellProgressMessage——与 BashTool 同一套组件（全输出、行数、字节数、超时、后台任务 ID）。
}
export function renderToolUseQueuedMessage(): React.ReactNode {
  return <MessageResponse height={1}>
      <Text dimColor>Waiting…</Text>
    </MessageResponse>;
}
export function renderToolResultMessage(content: Out, progressMessagesForMessage: ProgressMessage<PowerShellProgress>[], {
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
  const {
    stdout,
    stderr,
    interrupted,
    returnCodeInterpretation,
    isImage,
    backgroundTaskId
  } = content;
  if (isImage) {
    return <MessageResponse height={1}>
        <Text dimColor>[Image data detected and sent to Claude]</Text>
      </MessageResponse>;
  }
// 图像结果不回显——数据已直接发给模型，终端只显示一行说明。
  return <Box flexDirection="column">
      {stdout !== '' ? <OutputLine content={stdout} verbose={verbose} /> : null}
      {stderr.trim() !== '' ? <OutputLine content={stderr} verbose={verbose} isError /> : null}
      {stdout === '' && stderr.trim() === '' ? <MessageResponse height={1}>
          <Text dimColor>
            {backgroundTaskId ? <>
                Running in the background{' '}
                <KeyboardShortcutHint shortcut="↓" action="manage" parens />
              </> : interrupted ? 'Interrupted' : returnCodeInterpretation || '(No output)'}
          </Text>
        </MessageResponse> : null}
      {timeoutMs ? <MessageResponse>
          <ShellTimeDisplay timeoutMs={timeoutMs} />
        </MessageResponse> : null}
    </Box>;
}
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose,
  progressMessagesForMessage: _progressMessagesForMessage,
  tools: _tools
}: {
  verbose: boolean;
  progressMessagesForMessage: ProgressMessage<PowerShellProgress>[];
  tools: Tool[];
}): React.ReactNode {
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
// 空输出的三分支占位：后台任务提示（下箭头键管理）、Interrupted、退出码解释或 No output——退出码解释文案来自 commandSemantics 的 interpretCommandResult。错误渲染退到 Fallback 组件，没有定制折叠。
}
// 原文件此处有一行 14896 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。