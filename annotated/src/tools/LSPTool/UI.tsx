import { c as _c } from "react/compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { CtrlOToExpand } from '../../components/CtrlOToExpand.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Box, Text } from '../../ink.js';
import { getDisplayPath } from '../../utils/file.js';
import { extractTag } from '../../utils/messages.js';
import type { Input, Output } from './LSPTool.js';
import { getSymbolAtPosition } from './symbolContext.js';

// Lookup map for operation-specific labels
const OPERATION_LABELS: Record<Input['operation'], {
  singular: string;
  plural: string;
  special?: string;
}> = {
  goToDefinition: {
    singular: 'definition',
    plural: 'definitions'
  },
  findReferences: {
    singular: 'reference',
    plural: 'references'
  },
  documentSymbol: {
    singular: 'symbol',
    plural: 'symbols'
  },
  workspaceSymbol: {
    singular: 'symbol',
    plural: 'symbols'
  },
  hover: {
    singular: 'hover info',
    plural: 'hover info',
    special: 'available'
  },
  goToImplementation: {
    singular: 'implementation',
    plural: 'implementations'
  },
  prepareCallHierarchy: {
    singular: 'call item',
    plural: 'call items'
  },
  incomingCalls: {
    singular: 'caller',
    plural: 'callers'
  },
  outgoingCalls: {
    singular: 'callee',
    plural: 'callees'
  }
};
// 九种操作的标签表：单复数加 special 字段。hover 用 available 替代数字计数——「Hover info available」比「Found 1 hover info」自然。

/**
 * Reusable component for LSP result summaries with collapsed/expanded views
 */
function LSPResultSummary(t0) {
  const $ = _c(24);
  const {
    operation,
    resultCount,
    fileCount,
    content,
    verbose
  } = t0;
  let t1;
  if ($[0] !== operation) {
    t1 = OPERATION_LABELS[operation] || {
      singular: "result",
      plural: "results"
    };
    $[0] = operation;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const labelConfig = t1;
  const countLabel = resultCount === 1 ? labelConfig.singular : labelConfig.plural;
// resultCount 为 1 用单数——英文界面里数量词必须跟数走。
  let t2;
  if ($[2] !== countLabel || $[3] !== labelConfig.special || $[4] !== operation || $[5] !== resultCount) {
    t2 = operation === "hover" && resultCount > 0 && labelConfig.special ? <Text>Hover info {labelConfig.special}</Text> : <Text>Found <Text bold={true}>{resultCount} </Text>{countLabel}</Text>;
// hover 有结果时整个主文案换成 Hover info available，不走 Found N 模板——计数值对 hover 没有意义。
    $[2] = countLabel;
    $[3] = labelConfig.special;
    $[4] = operation;
    $[5] = resultCount;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  const primaryText = t2;
  let t3;
  if ($[7] !== fileCount) {
    t3 = fileCount > 1 ? <Text>{" "}across <Text bold={true}>{fileCount} </Text>files</Text> : null;
    $[7] = fileCount;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  const secondaryText = t3;
  if (verbose) {
    let t4;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text dimColor={true}>  ⎿  </Text>;
      $[9] = t4;
    } else {
      t4 = $[9];
    }
    let t5;
    if ($[10] !== primaryText || $[11] !== secondaryText) {
      t5 = <Box flexDirection="row"><Text>{t4}{primaryText}{secondaryText}</Text></Box>;
      $[10] = primaryText;
      $[11] = secondaryText;
      $[12] = t5;
    } else {
      t5 = $[12];
    }
    let t6;
    if ($[13] !== content) {
      t6 = <Box marginLeft={5}><Text>{content}</Text></Box>;
      $[13] = content;
      $[14] = t6;
    } else {
      t6 = $[14];
    }
    let t7;
    if ($[15] !== t5 || $[16] !== t6) {
      t7 = <Box flexDirection="column">{t5}{t6}</Box>;
      $[15] = t5;
      $[16] = t6;
      $[17] = t7;
    } else {
      t7 = $[17];
    }
    return t7;
  }
// verbose 展开完整内容（缩进排版），非 verbose 折叠成一行摘要加 Ctrl+O 展开提示——与 Bash 系工具同款折叠协议。
  let t4;
  if ($[18] !== resultCount) {
    t4 = resultCount > 0 && <CtrlOToExpand />;
    $[18] = resultCount;
    $[19] = t4;
  } else {
    t4 = $[19];
  }
  let t5;
  if ($[20] !== primaryText || $[21] !== secondaryText || $[22] !== t4) {
    t5 = <MessageResponse height={1}><Text>{primaryText}{secondaryText} {t4}</Text></MessageResponse>;
    $[20] = primaryText;
    $[21] = secondaryText;
    $[22] = t4;
    $[23] = t5;
  } else {
    t5 = $[23];
  }
  return t5;
}
export function userFacingName(): string {
  return 'LSP';
}
export function renderToolUseMessage(input: Partial<Input>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!input.operation) {
    return null;
  }
  const parts: string[] = [];

  // For position-based operations (goToDefinition, findReferences, hover, goToImplementation),
  // show the symbol at the position for better context
  if ((input.operation === 'goToDefinition' || input.operation === 'findReferences' || input.operation === 'hover' || input.operation === 'goToImplementation') && input.filePath && input.line !== undefined && input.character !== undefined) {
    // Convert from 1-based (user input) to 0-based (internal file reading)
    const symbol = getSymbolAtPosition(input.filePath, input.line - 1, input.character - 1);
    const displayPath = verbose ? input.filePath : getDisplayPath(input.filePath);
    if (symbol) {
      parts.push(`operation: "${input.operation}"`);
      parts.push(`symbol: "${symbol}"`);
      parts.push(`in: "${displayPath}"`);
    } else {
      parts.push(`operation: "${input.operation}"`);
      parts.push(`file: "${displayPath}"`);
      parts.push(`position: ${input.line}:${input.character}`);
    }
    return parts.join(', ');
  }
// 位置类操作在 header 里显示光标处的符号名（getSymbolAtPosition 同步提取）——「hover: "foo" in "bar.ts"」比裸坐标可读得多；提取失败退回 position 显示。

  // For other operations (documentSymbol, workspaceSymbol),
  // show operation and file without position details
  parts.push(`operation: "${input.operation}"`);
  if (input.filePath) {
    const displayPath = verbose ? input.filePath : getDisplayPath(input.filePath);
    parts.push(`file: "${displayPath}"`);
  }
  return parts.join(', ');
}
// documentSymbol/workspaceSymbol 只显示操作与文件——没有「光标处符号」概念，坐标列出来也是噪音。
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse>
        <Text color="error">LSP operation failed</Text>
      </MessageResponse>;
  }
// 非交互模式下错误折叠成一行红字；verbose 才给完整错误内容——错误详情主要给调试，日常把注意力留给结果。
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
export function renderToolResultMessage(output: Output, _progressMessages: unknown[], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  // Use collapsed/expanded view if we have count information
  if (output.resultCount !== undefined && output.fileCount !== undefined) {
    return <LSPResultSummary operation={output.operation} resultCount={output.resultCount} fileCount={output.fileCount} content={output.result} verbose={verbose} />;
  }
// 有计数走折叠摘要；没有（服务器初始化失败、请求异常等错误路径）直接输出原文——错误文本不值得做摘要。

  // Fallback for error cases where counts aren't available
  // (e.g., LSP server initialization failures, request errors)
  return <MessageResponse>
      <Text>{output.result}</Text>
    </MessageResponse>;
}
// 原文件此处有一行 18204 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。