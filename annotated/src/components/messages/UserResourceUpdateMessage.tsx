// 【MCP 资源变更通知：`↻ server: 资源名 · 原因`】
//
//  当 MCP server 推来「某个 resource 变了」或者「某个 tool 的轮询有结果了」，
//  会作为一条用户消息里的 XML 标签出现，由这个文件渲染成一行提示。
//
//  两类更新共用一套渲染：
//      <mcp-resource-update>   target 是 URI
//      <mcp-polling-update>    target 是工具名
//
//  差别只在 formatUri 那一步（资源要裁短，工具名原样）。
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { REFRESH_ARROW } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
type ParsedUpdate = {
  kind: 'resource' | 'polling';
  server: string;
  /** URI for resource updates, tool name for polling updates */
  target: string;
  reason?: string;
};

// Parse resource and polling updates from XML format
function parseUpdates(text: string): ParsedUpdate[] {
  const updates: ParsedUpdate[] = [];

  // Match <mcp-resource-update server="..." uri="...">
// 【两个正则各自跑一遍 while exec 循环，而不是一个正则匹配两种标签】
//
//  因为两种标签的属性**位置不同**：
//
//      resource  server="..." uri="..."        → 捕获组 1、2
//      polling   type="..." server="..." tool="..."  → 捕获组 2、3
//
//  想合成一个正则，就得让 server 的组号在两条分支里不同 ——
//  读的人每次都要数括号。拆成两个，各自组号从 1 开始，更好维护。
//
//  代价是两次全串扫描。这种「一次性解析」的成本可以接受：
//  每条消息解析一次，结果进缓存。
  const resourceRegex = /<mcp-resource-update\s+server="([^"]+)"\s+uri="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g;
  let match;
  while ((match = resourceRegex.exec(text)) !== null) {
    updates.push({
      kind: 'resource',
      server: match[1] ?? '',
      target: match[2] ?? '',
      reason: match[3]
    });
  }

  // Match <mcp-polling-update type="tool" server="..." tool="...">
  const pollingRegex = /<mcp-polling-update\s+type="([^"]+)"\s+server="([^"]+)"\s+tool="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g;
  while ((match = pollingRegex.exec(text)) !== null) {
    updates.push({
      kind: 'polling',
      server: match[2] ?? '',
      target: match[3] ?? '',
      reason: match[4]
    });
  }
  return updates;
}

// Format URI for display - show just the meaningful part
function formatUri(uri: string): string {
  // For file:// URIs, show just the filename
  if (uri.startsWith('file://')) {
    const path = uri.slice(7);
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }
  // For other URIs, show the whole thing but truncated
// 【URI 太长就截到 39 格 + 省略号，凑满 40】
//
//  这是「固定宽度」而不是「按终端宽度」——
//  因为这一行还要放 server 名和原因，给 URI 的预算固定 40 格最稳。
//
//  注意 slice(0, 39) 是按码元切，可能切坏一个多字节字符或多字节 emoji；
//  但后面紧跟省略号，视觉上仍然是「截断了」，不会引起误解。
//  这在本仓库里是一种被接受的取舍（另一个做法是 truncateToWidth，见 UserChannelMessage）。
  if (uri.length > 40) {
    return uri.slice(0, 39) + '\u2026';
  }
  return uri;
}
export function UserResourceUpdateMessage(t0) {
  const $ = _c(12);
  const {
    addMargin,
    param: t1
  } = t0;
  const {
    text
  } = t1;
// 【`let T0; let t2; ...` 一大排声明 —— 这是 early return 编译后的痕迹】
//
//  原始代码是：
//
//      const updates = parseUpdates(text)
//      if (updates.length === 0) return null
//      return <Box ...>{updates.map(...)}</Box>
//
//  Compiler 要缓存 JSX 的各个部分，就必须把「中间结果」提升到条件块外面，
//  于是出现 T0（组件类型 Box）、t2（"column"）、t3（marginTop）、t4（children）。
//
//  同时它引入了 `bb0:`（带标签的语句块）+ `react.early_return_sentinel`：
//  在块里算出「提前 return 的值」或者「正常路径的中间值」，
//  出了块再判断是哪种（见第 102 行）。
//
//  这套写法在本批会出现很多次（HighlightedThinkingText、UserChannelMessage、
//  RateLimitMessage、UserLocalCommandOutputMessage）。
//  **看到 bb0 和 sentinel，就说明原始代码里有个 early return。**
  let T0;
  let t2;
  let t3;
  let t4;
  let t5;
  if ($[0] !== addMargin || $[1] !== text) {
    t5 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const updates = parseUpdates(text);
      if (updates.length === 0) {
        t5 = null;
        break bb0;
      }
// 【`T0 = Box` —— JSX 的元素类型也进了缓存槽】
//
//  产物里 `<Box>` 变成了 `<T0>`，T0 是槽 $[2] 里存的值。
//  也就是说 Compiler 认为**组件引用本身也可能是变的**
//  （在它看来 <T0> 的 T0 是一个变量，可能来自 props 或条件表达式）。
//
//  这里当然是常量，缓存纯属浪费 —— 但 Compiler 不做「这个变量会不会变」的推断，
//  它保守地把所有作为标签使用的标识符都当变量处理。
//
//  读的时候直接当 `<Box>` 看就行。
      T0 = Box;
      t2 = "column";
      t3 = addMargin ? 1 : 0;
      t4 = updates.map(_temp);
    }
    $[0] = addMargin;
    $[1] = text;
    $[2] = T0;
    $[3] = t2;
    $[4] = t3;
    $[5] = t4;
    $[6] = t5;
  } else {
    T0 = $[2];
    t2 = $[3];
    t3 = $[4];
    t4 = $[5];
    t5 = $[6];
  }
  if (t5 !== Symbol.for("react.early_return_sentinel")) {
    return t5;
  }
  let t6;
  if ($[7] !== T0 || $[8] !== t2 || $[9] !== t3 || $[10] !== t4) {
    t6 = <T0 flexDirection={t2} marginTop={t3}>{t4}</T0>;
    $[7] = T0;
    $[8] = t2;
    $[9] = t3;
    $[10] = t4;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  return t6;
}
// 【`_temp` 是 map 的回调被提到模块顶层 —— 因为它在 JSX 里被引用】
//
//  原始代码大概是 `{updates.map(update => <Box>…</Box>)}`。
//  Compiler 把箭头函数提到模块作用域（_temp），这样它的**引用是稳定的**，
//  不会每次渲染都新建一个函数。
//
//  这也是一个可读的线索：产物里凡是叫 `_temp` / `_temp2` / `_temp3` 的模块级函数，
//  原本都是内联在 JSX 里的箭头函数。
function _temp(update, i) {
  return <Box key={i}><Text><Text color="success">{REFRESH_ARROW}</Text>{" "}<Text dimColor={true}>{update.server}:</Text>{" "}<Text color="suggestion">{update.kind === "resource" ? formatUri(update.target) : update.target}</Text>{update.reason && <Text dimColor={true}> · {update.reason}</Text>}</Text></Box>;
}
// 原文件此处有一行 9048 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。