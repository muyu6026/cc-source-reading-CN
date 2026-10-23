import * as React from 'react';
import type { z } from 'zod/v4';
import { MessageResponse } from '../../components/MessageResponse.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import type { inputSchema, Output } from './ReadMcpResourceTool.js';
// renderToolUseMessage：uri 或 server 缺失时返回 null——半截输入不渲染，避免出现 Read resource "undefined" 这种噪音行。
export function renderToolUseMessage(input: Partial<z.infer<ReturnType<typeof inputSchema>>>): React.ReactNode {
  if (!input.uri || !input.server) {
    return null;
  }
  return `Read resource "${input.uri}" from server "${input.server}"`;
}
// userFacingName 导出为函数供主工具文件引用（主文件里是 import 后直接挂到 buildTool 上）。
export function userFacingName(): string {
  return 'readMcpResource';
}
// renderToolResultMessage：空 contents 一行置灰；有内容 JSON 美化后走 OutputLine。
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
// 空内容分支。
  if (!output || !output.contents || output.contents.length === 0) {
    return <Box justifyContent="space-between" overflowX="hidden" width="100%">
        <MessageResponse height={1}>
          <Text dimColor>(No content)</Text>
        </MessageResponse>
      </Box>;
  }

  // Format as JSON for better readability
  // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
  const formattedOutput = jsonStringify(output, null, 2);
// 同样带 no-restricted-syntax 豁免——给人看的 UI 不守 tool_result 的序列化规则。
  return <OutputLine content={formattedOutput} verbose={verbose} />;
}
// 原文件此处有一行 4580 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。