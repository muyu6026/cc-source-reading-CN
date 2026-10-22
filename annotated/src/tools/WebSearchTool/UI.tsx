import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { Box, Text } from '../../ink.js';
import type { ProgressMessage } from '../../types/message.js';
import { truncate } from '../../utils/format.js';
import type { Output, SearchResult, WebSearchProgress } from './WebSearchTool.js';
function getSearchSummary(results: (SearchResult | string | null | undefined)[]): {
  searchCount: number;
  totalResultCount: number;
} {
  let searchCount = 0;
  let totalResultCount = 0;
  for (const result of results) {
    if (result != null && typeof result !== 'string') {
      searchCount++;
      totalResultCount += result.content?.length ?? 0;
    }
  }
  return {
    searchCount,
    totalResultCount
  };
}
// getSearchSummary：从混合数组里数出「搜索了几轮、共几条命中」
// （字符串项是模型评论，不计入）。totalResultCount 目前只算不用——UI 只报轮数。
export function renderToolUseMessage({
  query,
  allowed_domains,
  blocked_domains
}: Partial<{
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!query) {
    return null;
  }
  let message = '';
  if (query) {
    message += `"${query}"`;
  }
  if (verbose) {
    if (allowed_domains && allowed_domains.length > 0) {
      message += `, only allowing domains: ${allowed_domains.join(', ')}`;
    }
    if (blocked_domains && blocked_domains.length > 0) {
      message += `, blocking domains: ${blocked_domains.join(', ')}`;
    }
  }
  return message;
}
// 调用行：query 加引号展示；verbose 时追加 only allowing / blocking domains。
export function renderToolUseProgressMessage(progressMessages: ProgressMessage<WebSearchProgress>[]): React.ReactNode {
  if (progressMessages.length === 0) {
    return null;
  }
  const lastProgress = progressMessages[progressMessages.length - 1];
  if (!lastProgress?.data) {
    return null;
  }
  const data = lastProgress.data;
  switch (data.type) {
    case 'query_update':
      return <MessageResponse>
          <Text dimColor>Searching: {data.query}</Text>
        </MessageResponse>;
    case 'search_results_received':
      return <MessageResponse>
          <Text dimColor>
            Found {data.resultCount} results for &quot;{data.query}&quot;
          </Text>
        </MessageResponse>;
    default:
      return null;
  }
}
// 进行中状态按最后一条进度分流：query_update 显示「Searching: <词>」，
// search_results_received 显示「Found N results for <词>」——
// 这就是 call() 里那套 input_json_delta 猜词机制的下游收益。
export function renderToolResultMessage(output: Output): React.ReactNode {
  const {
    searchCount
  } = getSearchSummary(output.results ?? []);
  const timeDisplay = output.durationSeconds >= 1 ? `${Math.round(output.durationSeconds)}s` : `${Math.round(output.durationSeconds * 1000)}ms`;
  return <Box justifyContent="space-between" width="100%">
      <MessageResponse height={1}>
        <Text>
          Did {searchCount} search
          {searchCount !== 1 ? 'es' : ''} in {timeDisplay}
        </Text>
      </MessageResponse>
    </Box>;
}
// 结果行只有一句「Did N searches in Xs」：≥1 秒显示秒，否则毫秒。
// 命中的链接不在此渲染——模型会在回复正文里以 markdown 超链接引用。
export function getToolUseSummary(input: Partial<{
  query: string;
}> | undefined): string | null {
  if (!input?.query) {
    return null;
  }
  return truncate(input.query, TOOL_SUMMARY_MAX_LENGTH);
// 摘要：截断后的 query。
}
// 原文件此处有一行 9172 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。