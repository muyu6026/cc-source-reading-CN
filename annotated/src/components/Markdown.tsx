// Markdown 渲染核心：marked 词法分析 + 表格走 React 组件、其余走 ANSI 字符串的混合渲染，外加流式输出的增量词法方案。
import { c as _c } from "react/compiler-runtime";
import { marked, type Token, type Tokens } from 'marked';
import React, { Suspense, use, useMemo, useRef } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, useTheme } from '../ink.js';
import { type CliHighlight, getCliHighlightPromise } from '../utils/cliHighlight.js';
import { hashContent } from '../utils/hash.js';
import { configureMarked, formatToken } from '../utils/markdown.js';
import { stripPromptXMLTags } from '../utils/messages.js';
import { MarkdownTable } from './MarkdownTable.js';
type Props = {
  children: string;
  /** When true, render all text content as dim */
  dimColor?: boolean;
};

// Module-level token cache — marked.lexer is the hot cost on virtual-scroll
// remounts (~3ms per message). useMemo doesn't survive unmount→remount, so
// scrolling back to a previously-visible message re-parses. Messages are
// immutable in history; same content → same tokens. Keyed by hash to avoid
// retaining full content strings (turn50→turn99 RSS regression, #24180).
// 模块级 token 缓存：useMemo 活不过卸载重挂，虚拟滚动回滚到旧消息会重复解析（每次约 3ms）。消息内容不可变，同内容必得同 token。键用内容哈希——存全文会让 500 条缓存扣住约 4 倍内容体积的内存（曾引发 RSS 回归）。
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();

// Characters that indicate markdown syntax. If none are present, skip the
// ~3ms marked.lexer call entirely — render as a single paragraph. Covers
// the majority of short assistant responses and user prompts that are
// plain sentences. Checked via indexOf (not regex) for speed.
// Single regex: matches any MD marker or ordered-list start (N. at line start).
// One pass instead of 10× includes scans.
// Markdown 语法探测正则：命中任一标记符或有序列表行首才算 Markdown。用单条正则替代十次 includes 扫描，一次遍历完成。
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
// 语法探测只采样前 500 字符：Markdown 特征几乎总在开头（标题、代码栅栏、列表），长工具输出的尾部多是纯文本。
function hasMarkdownSyntax(s: string): boolean {
  // Sample first 500 chars — if markdown exists it's usually early (headers,
  // code fence, list). Long tool outputs are mostly plain text tails.
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}
// 带缓存的词法入口：纯文本走免解析快路径，其余走哈希缓存。
function cachedLexer(content: string): Token[] {
  // Fast path: plain text with no markdown syntax → single paragraph token.
  // Skips marked.lexer's full GFM parse (~3ms on long content). Not cached —
  // reconstruction is a single object allocation, and caching would retain
  // 4× content in raw/text fields plus the hash key for zero benefit.
// 快路径：没有语法特征时手工构造单个 paragraph token，跳过 marked 的完整 GFM 解析。快路径不缓存——重建只是一次对象分配，缓存反而要额外扣住 raw 与 text 字段里的全文。
  if (!hasMarkdownSyntax(content)) {
    return [{
      type: 'paragraph',
      raw: content,
      text: content,
      tokens: [{
        type: 'text',
        raw: content,
        text: content
      }]
    } as Token];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
// 命中即提升到 Map 末尾实现 LRU 语义：不提升的话淘汰是 FIFO，回滚到早期消息会把正在看的那条挤出去。
    // Promote to MRU — without this the eviction is FIFO (scrolling back to
    // an early message evicts the very item you're looking at).
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
// 容量满时删 Map 首项：Map 按插入序迭代，最旧（最久未用）的先走。
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    // LRU-ish: drop oldest. Map preserves insertion order.
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

/**
 * Renders markdown content using a hybrid approach:
 * - Tables are rendered as React components with proper flexbox layout
 * - Other content is rendered as ANSI strings via formatToken
 */
// 入口组件：语法高亮可关。关闭时直接渲染无高亮版本，开启时挂 Suspense 等高亮器就绪。
export function Markdown(props) {
  const $ = _c(4);
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    let t0;
    if ($[0] !== props) {
      t0 = <MarkdownBody {...props} highlight={null} />;
      $[0] = props;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
  let t0;
  if ($[2] !== props) {
// Suspense 的 fallback 是无高亮版本而非空白：高亮器加载期间先显示纯文本，就绪后无缝换成高亮——零闪烁降级。
    t0 = <Suspense fallback={<MarkdownBody {...props} highlight={null} />}><MarkdownWithHighlight {...props} /></Suspense>;
    $[2] = props;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}
function MarkdownWithHighlight(props) {
  const $ = _c(4);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = getCliHighlightPromise();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
// use(promise) 消费高亮器 Promise：未决时挂起，由最近的 Suspense 接管。
  const highlight = use(t0);
  let t1;
  if ($[1] !== highlight || $[2] !== props) {
    t1 = <MarkdownBody {...props} highlight={highlight} />;
    $[1] = highlight;
    $[2] = props;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
// 正文渲染：token 流被切成「表格节点」与「非表格 ANSI 串」两类元素。
function MarkdownBody(t0) {
  const $ = _c(7);
  const {
    children,
    dimColor,
    highlight
  } = t0;
  const [theme] = useTheme();
  configureMarked();
  let elements;
  if ($[0] !== children || $[1] !== dimColor || $[2] !== highlight || $[3] !== theme) {
// 先剥提示词 XML 标签再词法分析，保证流式与非流式两条路径输入一致。
    const tokens = cachedLexer(stripPromptXMLTags(children));
    elements = [];
    let nonTableContent = "";
// 非表格内容累积到缓冲串，遇到表格 token 时 flush 成一个 Ansi 节点——表格必须独占 React 组件做 flexbox 布局，不能混进 ANSI 字符串。
    const flushNonTableContent = function flushNonTableContent() {
      if (nonTableContent) {
        elements.push(<Ansi key={elements.length} dimColor={dimColor}>{nonTableContent.trim()}</Ansi>);
        nonTableContent = "";
      }
    };
    for (const token of tokens) {
      if (token.type === "table") {
        flushNonTableContent();
        elements.push(<MarkdownTable key={elements.length} token={token as Tokens.Table} highlight={highlight} />);
      } else {
// formatToken 把 token 转成带主题色的 ANSI 序列，表格之外的一切（段落、代码、列表）都走这里。
        nonTableContent = nonTableContent + formatToken(token, theme, 0, null, null, highlight);
        nonTableContent;
      }
    }
    flushNonTableContent();
    $[0] = children;
    $[1] = dimColor;
    $[2] = highlight;
    $[3] = theme;
    $[4] = elements;
  } else {
    elements = $[4];
  }
  const elements_0 = elements;
  let t1;
  if ($[5] !== elements_0) {
    t1 = <Box flexDirection="column" gap={1}>{elements_0}</Box>;
    $[5] = elements_0;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  return t1;
}
type StreamingProps = {
  children: string;
};

/**
 * Renders markdown during streaming by splitting at the last top-level block
 * boundary: everything before is stable (memoized, never re-parsed), only the
 * final block is re-parsed per delta. marked.lexer() correctly handles
 * unclosed code fences as a single token, so block boundaries are always safe.
 *
 * The stable boundary only advances (monotonic), so ref mutation during render
 * is idempotent and safe under StrictMode double-rendering. Component unmounts
 * between turns (streamingText → null), resetting the ref.
 */
// 流式 Markdown：把整段文本在最后一个稳定块边界切开，前缀不再重解析，只有尾部块随增量重解析。
export function StreamingMarkdown({
  children
}: StreamingProps): React.ReactNode {
  // React Compiler: this component reads and writes stablePrefixRef.current
  // during render by design. The boundary only advances (monotonic), so
  // the ref mutation is idempotent under StrictMode double-render — but the
  // compiler can't prove that, and memoizing around the ref reads would
  // break the algorithm (stale boundary). Opt out.
// use no memo 指令：本组件渲染期读写 ref 是设计使然（边界只单调前进，StrictMode 双渲染下幂等），但编译器无法证明，若把 ref 读取缓存住会让边界永久变旧。这里选择整体退出编译器优化。
  'use no memo';

  configureMarked();

  // Strip before boundary tracking so it matches <Markdown>'s stripping
  // (line 29). When a closing tag arrives, stripped(N+1) is not a prefix
  // of stripped(N), but the startsWith reset below handles that with a
  // one-time re-lex on the smaller stripped string.
// 先剥离 XML 标签再追踪边界，与非流式路径的剥离一致。闭合标签到达时剥离结果可能不再是原前缀的前缀，206 行的重置逻辑兜底。
  const stripped = stripPromptXMLTags(children);
  const stablePrefixRef = useRef('');

  // Reset if text was replaced (defensive; normally unmount handles this)
// 前缀断裂防御：内容被整体替换（罕见）时清空边界重新解析。
  if (!stripped.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }

  // Lex only from current boundary — O(unstable length), not O(full text)
  const boundary = stablePrefixRef.current.length;
// 只从当前边界开始词法分析，成本正比于不稳定尾部而非全文——这是流式场景下每 delta 只付尾部成本的保证。
  const tokens = marked.lexer(stripped.substring(boundary));

  // Last non-space token is the growing block; everything before is final
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }
  let advance = 0;
// 扫描到最后一个非空 token 为止：其后的都是正在生长的尾巴；之前所有 token 的 raw 长度之和即新的稳定边界。
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = stripped.substring(0, boundary + advance);
  }
  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = stripped.substring(stablePrefix.length);

  // stablePrefix is memoized inside <Markdown> via useMemo([children, ...])
  // so it never re-parses as the unstable suffix grows
// 稳定前缀交给 <Markdown>（内部有缓存，永不重解析），不稳定尾巴单独渲染。两段上下排布。
  return <Box flexDirection="column" gap={1}>
      {stablePrefix && <Markdown>{stablePrefix}</Markdown>}
      {unstableSuffix && <Markdown>{unstableSuffix}</Markdown>}
    </Box>;
}
// 原文件此处有一行 19844 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。