import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import figures from 'figures';
import * as React from 'react';
import type { z } from 'zod/v4';
import { ProgressBar } from '../../components/design-system/ProgressBar.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { linkifyUrlsInText, OutputLine } from '../../components/shell/OutputLine.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Ansi, Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { MCPProgress } from '../../types/tools.js';
import { formatNumber } from '../../utils/format.js';
import { createHyperlink } from '../../utils/hyperlink.js';
import { getContentSizeEstimate, type MCPToolResult } from '../../utils/mcpValidation.js';
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js';
import type { inputSchema } from './MCPTool.js';

// Threshold for displaying warning about large MCP responses
const MCP_OUTPUT_WARNING_THRESHOLD_TOKENS = 10_000;
// 1 万 token 的警告阈值：MCP 服务器不受本地沙箱约束，一个大响应能瞬间吃掉上下文的相当比例，所以 UI 层单独设这道闸。

// In non-verbose mode, truncate individual input values to keep the header
// compact. Matches BashTool's philosophy of showing enough to identify the
// call without dumping the entire payload inline.
const MAX_INPUT_VALUE_CHARS = 80;
// 80 字符截断与 BashTool 同一哲学：header 里给足以识别调用的信息，不把整包参数倒进终端。

// Max number of top-level keys before we fall back to raw JSON display.
// Beyond this a flat k:v list is more noise than help.
const MAX_FLAT_JSON_KEYS = 12;
// 超过 12 个顶层键，平铺 k:v 列表反而比原始 JSON 更吵，退回 pretty-print 路径——「紧凑展示」有自己的收益递减点。

// Don't attempt flat-object parsing for large blobs.
const MAX_FLAT_JSON_CHARS = 5_000;

// Don't attempt to parse JSON blobs larger than this (perf safety).
const MAX_JSON_PARSE_CHARS = 200_000;
// 20 万字符的解析上限是纯性能护栏：jsonParse 在 slowOperations 名单里，大 blob 不值得为渲染付解析成本。

// A string value is "dominant text payload" if it has newlines or is
// long enough that inline display would be worse than unwrapping.
const UNWRAP_MIN_STRING_LEN = 200;
// 200 字符或含换行即「主载荷」：这是为 Slack 的 {"messages":"line1\nline2..."} 形态定制的判据——pretty-print 会把换行转义成字面 \n，用户看到的是一团反斜杠。
export function renderToolUseMessage(input: z.infer<ReturnType<typeof inputSchema>>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (Object.keys(input).length === 0) {
    return '';
  }
  return Object.entries(input).map(([key, value]) => {
    let rendered = jsonStringify(value);
    if (feature('MCP_RICH_OUTPUT') && !verbose && rendered.length > MAX_INPUT_VALUE_CHARS) {
      rendered = rendered.slice(0, MAX_INPUT_VALUE_CHARS).trimEnd() + '…';
    }
    return `${key}: ${rendered}`;
  }).join(', ');
}
// 非交互模式下超长输入值截到 80 字符；MCP_RICH_OUTPUT 特性开关关掉时完全不截断，保持旧行为。
export function renderToolUseProgressMessage(progressMessagesForMessage: ProgressMessage<MCPProgress>[]): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1);
  if (!lastProgress?.data) {
    return <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>;
  }
  const {
    progress,
    total,
    progressMessage
  } = lastProgress.data;
  if (progress === undefined) {
    return <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>;
  }
  if (total !== undefined && total > 0) {
    const ratio = Math.min(1, Math.max(0, progress / total));
    const percentage = Math.round(ratio * 100);
    return <MessageResponse>
        <Box flexDirection="column">
          {progressMessage && <Text dimColor>{progressMessage}</Text>}
          <Box flexDirection="row" gap={1}>
            <ProgressBar ratio={ratio} width={20} />
            <Text dimColor>{percentage}%</Text>
          </Box>
        </Box>
      </MessageResponse>;
  }
  return <MessageResponse height={1}>
      <Text dimColor>{progressMessage ?? `Processing… ${progress}`}</Text>
    </MessageResponse>;
}
// 进度三分支：无数据或无 progress 显示一行 Running；有 total 且大于 0 显示进度条加百分比；只有 progress 显示消息或计数。MCP 的进度上报是可选的，progress 与 total 不保证成对出现，UI 必须每个缺口都有退路。
export function renderToolResultMessage(output: string | MCPToolResult, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  verbose,
  input
}: {
  verbose: boolean;
  input?: unknown;
}): React.ReactNode {
  const mcpOutput = output as MCPToolResult;
  if (!verbose) {
    const slackSend = trySlackSendCompact(mcpOutput, input);
// Slack 发消息结果被特判成一行带超链接的 Sent a message to #channel——放在 token 估算之前，最高频的写操作不该吃大响应警告。
    if (slackSend !== null) {
      return <MessageResponse height={1}>
          <Text>
            Sent a message to{' '}
            <Ansi>{createHyperlink(slackSend.url, slackSend.channel)}</Ansi>
          </Text>
        </MessageResponse>;
    }
  }
  const estimatedTokens = getContentSizeEstimate(mcpOutput);
  const showWarning = estimatedTokens > MCP_OUTPUT_WARNING_THRESHOLD_TOKENS;
  const warningMessage = showWarning ? `${figures.warning} Large MCP response (~${formatNumber(estimatedTokens)} tokens), this can fill up context quickly` : null;
// 警告文案直接说「this can fill up context quickly」：这是说给人听的，不是给模型的——模型那份由 maxResultSizeChars 在别处管。
  let contentElement: React.ReactNode;
  if (Array.isArray(mcpOutput)) {
    const contentBlocks = mcpOutput.map((item, i) => {
      if (item.type === 'image') {
        return <Box key={i} justifyContent="space-between" overflowX="hidden" width="100%">
            <MessageResponse height={1}>
              <Text>[Image]</Text>
            </MessageResponse>
          </Box>;
      }
      // For text blocks and any other block types, extract text if available
      const textContent = item.type === 'text' && 'text' in item && item.text !== null && item.text !== undefined ? String(item.text) : '';
      return feature('MCP_RICH_OUTPUT') ? <MCPTextOutput key={i} content={textContent} verbose={verbose} /> : <OutputLine key={i} content={textContent} verbose={verbose} />;
// image 块只渲染占位符 [Image]（终端不显图）；文本块按 MCP_RICH_OUTPUT 开关走富渲染或普通 OutputLine。
    });

    // Wrap array content in a column layout
    contentElement = <Box flexDirection="column" width="100%">
        {contentBlocks}
      </Box>;
  } else if (!mcpOutput) {
    contentElement = <Box justifyContent="space-between" overflowX="hidden" width="100%">
        <MessageResponse height={1}>
          <Text dimColor>(No content)</Text>
        </MessageResponse>
      </Box>;
  } else {
    contentElement = feature('MCP_RICH_OUTPUT') ? <MCPTextOutput content={mcpOutput} verbose={verbose} /> : <OutputLine content={mcpOutput} verbose={verbose} />;
  }
  if (warningMessage) {
    return <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text color="warning">{warningMessage}</Text>
        </MessageResponse>
        {contentElement}
      </Box>;
  }
  return contentElement;
}

/**
 * Render MCP text output. Tries three strategies in order:
 * 1. If JSON wraps a single dominant text payload (e.g. slack's
 *    {"messages":"line1\nline2..."}), unwrap and let OutputLine truncate.
 * 2. If JSON is a small flat-ish object, render as aligned key: value.
 * 3. Otherwise fall through to OutputLine (pretty-print + truncate).
 */
function MCPTextOutput(t0) {
// React Compiler 产物：_c(18) 申请 18 个 memo 槽位，$[i] 依赖没变就直接复用；early_return_sentinel 用来在编译后的线性代码里模拟「提前 return」。可读性差，但语义就是上面注释里的三条策略级联。
  const $ = _c(18);
  const {
    content,
    verbose
  } = t0;
  let t1;
  if ($[0] !== content || $[1] !== verbose) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const unwrapped = tryUnwrapTextPayload(content);
      if (unwrapped !== null) {
        const t2 = unwrapped.extras.length > 0 && <Text dimColor={true}>{unwrapped.extras.map(_temp).join(" \xB7 ")}</Text>;
        let t3;
        if ($[3] !== unwrapped || $[4] !== verbose) {
          t3 = <OutputLine content={unwrapped.body} verbose={verbose} linkifyUrls={true} />;
          $[3] = unwrapped;
          $[4] = verbose;
          $[5] = t3;
        } else {
          t3 = $[5];
        }
        let t4;
        if ($[6] !== t2 || $[7] !== t3) {
          t4 = <MessageResponse><Box flexDirection="column">{t2}{t3}</Box></MessageResponse>;
          $[6] = t2;
          $[7] = t3;
          $[8] = t4;
        } else {
          t4 = $[8];
        }
        t1 = t4;
        break bb0;
      }
    }
    $[0] = content;
    $[1] = verbose;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  let t2;
  if ($[9] !== content) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb1: {
      const flat = tryFlattenJson(content);
      if (flat !== null) {
        const maxKeyWidth = Math.max(...flat.map(_temp2));
        let t3;
        if ($[11] !== maxKeyWidth) {
          t3 = (t4, i) => {
            const [key, value] = t4;
            return <Text key={i}><Text dimColor={true}>{key.padEnd(maxKeyWidth)}: </Text><Ansi>{linkifyUrlsInText(value)}</Ansi></Text>;
          };
          $[11] = maxKeyWidth;
          $[12] = t3;
        } else {
          t3 = $[12];
        }
        const t4 = <Box flexDirection="column">{flat.map(t3)}</Box>;
        let t5;
        if ($[13] !== t4) {
          t5 = <MessageResponse>{t4}</MessageResponse>;
          $[13] = t4;
          $[14] = t5;
        } else {
          t5 = $[14];
        }
        t2 = t5;
        break bb1;
      }
    }
    $[9] = content;
    $[10] = t2;
  } else {
    t2 = $[10];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  let t3;
  if ($[15] !== content || $[16] !== verbose) {
    t3 = <OutputLine content={content} verbose={verbose} linkifyUrls={true} />;
    $[15] = content;
    $[16] = verbose;
    $[17] = t3;
  } else {
    t3 = $[17];
  }
  return t3;
}

/**
 * Parse content as a JSON object and return its entries. Null if content
 * doesn't parse, isn't an object, is too large, or has 0/too-many keys.
 */
function _temp2(t0) {
  const [k_0] = t0;
  return stringWidth(k_0);
}
function _temp(t0) {
  const [k, v] = t0;
  return `${k}: ${v}`;
}
function parseJsonEntries(content: string, {
  maxChars,
  maxKeys
}: {
  maxChars: number;
  maxKeys: number;
}): [string, unknown][] | null {
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars || trimmed[0] !== '{') {
    return null;
  }
// 五连守卫：空串、超长、非左花括号开头、解析失败、非对象、键数越界，全部返回 null。三条渲染策略共用这一个入口，保证下游拿到的必是合法 entries。
  let parsed: unknown;
  try {
    parsed = jsonParse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > maxKeys) {
    return null;
  }
  return entries;
}

/**
 * If content parses as a JSON object where every value is a scalar or a
 * small nested object, flatten it to [key, displayValue] pairs. Nested
 * objects get one-line JSON. Returns null if content doesn't qualify.
 */
export function tryFlattenJson(content: string): [string, string][] | null {
  const entries = parseJsonEntries(content, {
    maxChars: MAX_FLAT_JSON_CHARS,
    maxKeys: MAX_FLAT_JSON_KEYS
  });
  if (entries === null) return null;
  const result: [string, string][] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      result.push([key, value]);
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      result.push([key, String(value)]);
    } else if (typeof value === 'object') {
      const compact = jsonStringify(value);
      if (compact.length > 120) return null;
      result.push([key, compact]);
    } else {
      return null;
    }
  }
  return result;
}

/**
 * If content is a JSON object where one key holds a dominant string payload
 * (multiline or long) and all siblings are small scalars, unwrap it. This
 * handles the common MCP pattern of {"messages":"line1\nline2..."} where
 * pretty-printing keeps \n escaped but we want real line breaks + truncation.
 */
export function tryUnwrapTextPayload(content: string): {
  body: string;
  extras: [string, string][];
} | null {
  const entries = parseJsonEntries(content, {
    maxChars: MAX_JSON_PARSE_CHARS,
    maxKeys: 4
  });
  if (entries === null) return null;
  // Find the one dominant string payload. Trim first: a trailing \n on a
  // short sibling (e.g. pagination hints) shouldn't make it "dominant".
  let body: string | null = null;
  const extras: [string, string][] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      const t = value.trimEnd();
      const isDominant = t.length > UNWRAP_MIN_STRING_LEN || t.includes('\n') && t.length > 50;
      if (isDominant) {
        if (body !== null) return null; // two big strings — ambiguous
// 两个大字符串无法判定谁是主载荷——宁可整体退回 pretty-print 也不猜。
        body = t;
        continue;
      }
      if (t.length > 150) return null;
// 兄弟键超过 150 字符也放弃：说明这不是「主载荷加小提示」的形态。trimEnd 在判定前执行——分页提示尾部一个换行不该让它被误判成主载荷。
      extras.push([key, t.replace(/\s+/g, ' ')]);
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      extras.push([key, String(value)]);
    } else {
      return null; // nested object/array — use flat or pretty-print path
    }
  }
  if (body === null) return null;
  return {
    body,
    extras
  };
}
const SLACK_ARCHIVES_RE = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p\d+$/;
// archives URL 格式固定为 /archives/<频道ID>/p<时间戳>，这个正则同时承担两个职责：确认确实是 Slack 链接，以及从 URL 里抠出频道 ID 作兜底标签。

/**
 * Detect a Slack send-message result and return a compact {channel, url} pair.
 * Matches both hosted (claude.ai Slack) and community MCP server shapes —
 * both return `message_link` in the result. The channel label prefers the
 * tool input (may be a name like "#foo" or an ID like "C09EVDAN1NK") and
 * falls back to the ID parsed from the archives URL.
 */
export function trySlackSendCompact(output: string | MCPToolResult, input: unknown): {
  channel: string;
  url: string;
} | null {
  let text: unknown = output;
  if (Array.isArray(output)) {
    const block = output.find(b => b.type === 'text');
    text = block && 'text' in block ? block.text : undefined;
  }
// 先做字符串包含快检再尝试解析：绝大多数非 Slack 输出在这里零成本退出，JSON 解析只对含 message_link 的文本发生。
  if (typeof text !== 'string' || !text.includes('"message_link"')) {
    return null;
  }
  const entries = parseJsonEntries(text, {
    maxChars: 2000,
    maxKeys: 6
  });
  const url = entries?.find(([k]) => k === 'message_link')?.[1];
  if (typeof url !== 'string') return null;
  const m = SLACK_ARCHIVES_RE.exec(url);
  if (!m) return null;
  const inp = input as {
    channel_id?: unknown;
    channel?: unknown;
  } | undefined;
  const raw = inp?.channel_id ?? inp?.channel ?? m[1];
// 频道标签优先取工具输入（可能是 #foo 这样的名字，也可能是 C09EVDAN1NK 这样的 ID），输入没有才从 URL 兜底抠——用户视角的名字比内部 ID 可读。
  const label = typeof raw === 'string' && raw ? raw : 'slack';
  return {
    channel: label.startsWith('#') ? label : `#${label}`,
    url
  };
}
// 原文件此处有一行 36928 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。