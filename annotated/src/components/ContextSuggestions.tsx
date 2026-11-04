import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '../ink.js';
import type { ContextSuggestion } from '../utils/contextSuggestions.js';
import { formatTokens } from '../utils/format.js';
import { StatusIcon } from './design-system/StatusIcon.js';
// 组件入参：一组上下文建议对象数组。
type Props = {
  suggestions: ContextSuggestion[];
};
// 上下文建议列表：无建议时渲染空；否则渲染标题加逐条建议。
export function ContextSuggestions(t0) {
  const $ = _c(5);
  const {
    suggestions
  } = t0;
// 没有建议则直接返回 null，不占空间。
  if (suggestions.length === 0) {
    return null;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text bold={true}>Suggestions</Text>;
// 标题行：加粗的 Suggestions 字样。
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== suggestions) {
    t2 = suggestions.map(_temp);
// 把每条建议映射为渲染节点。
    $[1] = suggestions;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== t2) {
    t3 = <Box flexDirection="column" marginTop={1}>{t1}{t2}</Box>;
// 用纵向 Box 包裹标题与建议列表。
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
// 返回组装好的建议列表节点。
}
// 单条建议渲染：状态图标加标题，有节省量时附「→ 节省约 N token」提示。
function _temp(suggestion, i) {
  return <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}><Box><StatusIcon status={suggestion.severity} withSpace={true} /><Text bold={true}>{suggestion.title}</Text>{suggestion.savingsTokens ? <Text dimColor={true}>{" "}{figures.arrowRight} save ~{formatTokens(suggestion.savingsTokens)}</Text> : null}</Box><Box marginLeft={2}><Text dimColor={true}>{suggestion.detail}</Text></Box></Box>;
}
// 原文件此处有一行 4496 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。