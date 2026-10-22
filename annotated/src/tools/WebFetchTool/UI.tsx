import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { formatFileSize, truncate } from '../../utils/format.js';
import type { Output } from './WebFetchTool.js';
export function renderToolUseMessage({
  url,
  prompt
}: Partial<{
  url: string;
  prompt: string;
}>, {
  verbose
}: {
  theme?: string;
  verbose: boolean;
}): React.ReactNode {
  if (!url) {
    return null;
  }
  if (verbose) {
    return `url: "${url}"${verbose && prompt ? `, prompt: "${prompt}"` : ''}`;
  }
  return url;
}
// 工具调用行：verbose 显示 url + prompt，紧凑模式只显示 url。
export function renderToolUseProgressMessage(): React.ReactNode {
  return <MessageResponse height={1}>
      <Text dimColor>Fetching…</Text>
    </MessageResponse>;
}
// 进行中状态：一行「Fetching…」。
export function renderToolResultMessage({
  bytes,
  code,
  codeText,
  result
}: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  const formattedSize = formatFileSize(bytes);
  if (verbose) {
    return <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text>
            Received <Text bold>{formattedSize}</Text> ({code} {codeText})
          </Text>
        </MessageResponse>
        <Box flexDirection="column">
          <Text>{result}</Text>
        </Box>
      </Box>;
  }
  return <MessageResponse height={1}>
      <Text>
        Received <Text bold>{formattedSize}</Text> ({code} {codeText})
      </Text>
    </MessageResponse>;
}
// 结果行：Received <大小> (<状态码> <状态文本>)；verbose 追加提炼结果全文，
// 紧凑只留这一行——正文细节都在 Haiku 的 result 里，反正也不长。
export function getToolUseSummary(input: Partial<{
  url: string;
  prompt: string;
}> | undefined): string | null {
  if (!input?.url) {
    return null;
  }
  return truncate(input.url, TOOL_SUMMARY_MAX_LENGTH);
// getToolUseSummary：截断到摘要上限的 URL，供活动流用。
}
// 原文件此处有一行 6160 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。