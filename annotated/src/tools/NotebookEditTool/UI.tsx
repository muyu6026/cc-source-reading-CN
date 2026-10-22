import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import type { Message, ProgressMessage } from 'src/types/message.js';
import { extractTag } from 'src/utils/messages.js';
import type { ThemeName } from 'src/utils/theme.js';
import type { z } from 'zod/v4';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { FilePathLink } from '../../components/FilePathLink.js';
import { HighlightedCode } from '../../components/HighlightedCode.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { NotebookEditToolUseRejectedMessage } from '../../components/NotebookEditToolUseRejectedMessage.js';
import { Box, Text } from '../../ink.js';
import type { Tools } from '../../Tool.js';
import { getDisplayPath } from '../../utils/file.js';
import type { inputSchema, Output } from './NotebookEditTool.js';
export function getToolUseSummary(input: Partial<z.infer<ReturnType<typeof inputSchema>>> | undefined): string | null {
  if (!input?.notebook_path) {
    return null;
  }
  return getDisplayPath(input.notebook_path);
}
// getToolUseSummary：返回显示路径（绝对路径缩略为 ~/… 形式），供活动流/摘要用。
export function renderToolUseMessage({
  notebook_path,
  cell_id,
  new_source,
  cell_type,
  edit_mode
}: Partial<z.infer<ReturnType<typeof inputSchema>>>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!notebook_path || !new_source || !cell_type) {
    return null;
  }
  const displayPath = verbose ? notebook_path : getDisplayPath(notebook_path);
  if (verbose) {
    return <>
        <FilePathLink filePath={notebook_path}>{displayPath}</FilePathLink>
        {`@${cell_id}, content: ${new_source.slice(0, 30)}…, cell_type: ${cell_type}, edit_mode: ${edit_mode ?? 'replace'}`}
      </>;
  }
  return <>
      <FilePathLink filePath={notebook_path}>{displayPath}</FilePathLink>
      {`@${cell_id}`}
    </>;
}
// renderToolUseMessage：verbose 模式给全路径 + 单元格 id + 内容前 30 字符 + 类型/模式；
// 紧凑模式只留「路径@单元格」。字段缺失返回 null（让上层用兜底渲染）。
export function renderToolUseRejectedMessage(input: z.infer<ReturnType<typeof inputSchema>>, {
  verbose
}: {
  columns?: number;
  messages?: Message[];
  progressMessagesForMessage?: ProgressMessage[];
  theme?: ThemeName;
  tools?: Tools;
  verbose: boolean;
}): React.ReactNode {
  return <NotebookEditToolUseRejectedMessage notebook_path={input.notebook_path} cell_id={input.cell_id} new_source={input.new_source} cell_type={input.cell_type} edit_mode={input.edit_mode} verbose={verbose} />;
}
// 拒绝消息整块委托给共享组件 NotebookEditToolUseRejectedMessage
// （与 FileEditTool 的拒绝 UI 同一体系）。
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse>
        <Text color="error">Error editing notebook</Text>
      </MessageResponse>;
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
// 错误渲染：非 verbose 且内容带 tool_use_error 标签时只显示一句「Error editing notebook」；
// 否则交给 FallbackToolUseErrorMessage 展示完整错误。
export function renderToolResultMessage({
  cell_id,
  new_source,
  error
}: Output): React.ReactNode {
  if (error) {
    return <MessageResponse>
        <Text color="error">{error}</Text>
      </MessageResponse>;
  }
  return <MessageResponse>
      <Box flexDirection="column">
        <Text>
          Updated cell <Text bold>{cell_id}</Text>:
        </Text>
        <Box marginLeft={2}>
          <HighlightedCode code={new_source} filePath="notebook.py" />
        </Box>
      </Box>
    </MessageResponse>;
}
// 结果渲染：成功时显示「Updated cell <id>」+ 新 source 的语法高亮
// （filePath 伪装成 notebook.py 以触发 Python 高亮）；失败直接红字 error。
// 原文件此处有一行 10196 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。