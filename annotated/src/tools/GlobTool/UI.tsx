import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { extractTag } from 'src/utils/messages.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { Text } from '../../ink.js';
import { FILE_NOT_FOUND_CWD_NOTE, getDisplayPath } from '../../utils/file.js';
import { truncate } from '../../utils/format.js';
import { GrepTool } from '../GrepTool/GrepTool.js';
// 这份 UI 直接 import GrepTool——为了复用它的 renderToolResultMessage（见下方 53 行的赋值）。两个「Search」工具共用同一套结果渲染，改一处两个工具同时生效。
export function userFacingName(): string {
  return 'Search';
}
// 对外名称统一叫「Search」——GrepTool.userFacingName 同样返回 Search。用户在 UI 里看到的不是两个工具名，而是同一个「Search」类别；区分靠 pattern 内容本身。
export function renderToolUseMessage({
  pattern,
  path
}: Partial<{
  pattern: string;
  path: string;
}>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!pattern) {
    return null;
  }
  if (!path) {
    return `pattern: "${pattern}"`;
  }
  return `pattern: "${pattern}", path: "${verbose ? path : getDisplayPath(path)}"`;
}
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    const errorMessage = extractTag(result, 'tool_use_error');
    if (errorMessage?.includes(FILE_NOT_FOUND_CWD_NOTE)) {
      return <MessageResponse>
          <Text color="error">File not found</Text>
        </MessageResponse>;
    }
    return <MessageResponse>
        <Text color="error">Error searching files</Text>
      </MessageResponse>;
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
// 错误降级模式与 FileReadTool/UI 相同：非 verbose 时只给一句「File not found」或「Error searching files」，详细信息折叠进可展开区域。判断依据是错误文本里是否带 FILE_NOT_FOUND_CWD_NOTE 标记。

// Note: GlobTool reuses GrepTool's renderToolResultMessage
export const renderToolResultMessage = GrepTool.renderToolResultMessage;
// 一行赋值完成复用：Glob 的结果渲染 = Grep 的实现。这是「孪生工具共享 UI 层」的最省做法——比抽公共组件还少一层间接。
export function getToolUseSummary(input: Partial<{
  pattern: string;
  path: string;
}> | undefined): string | null {
  if (!input?.pattern) {
    return null;
  }
  return truncate(input.pattern, TOOL_SUMMARY_MAX_LENGTH);
}
// 原文件此处有一行 5988 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。