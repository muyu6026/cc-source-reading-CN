import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useMemo } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Ansi, Text } from '../../ink.js';
import { createHyperlink } from '../../utils/hyperlink.js';
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js';
import { renderTruncatedContent } from '../../utils/terminal.js';
import { MessageResponse } from '../MessageResponse.js';
import { InVirtualListContext } from '../messageActions.js';
import { useExpandShellOutput } from './ExpandShellOutputContext.js';
// tryFormatJson：单行若是合法 JSON 就美化重排。核心防线在第 21 行——解析再序列化是有损变换，大整数超过 MAX_SAFE_INTEGER 会悄悄变值，所以先做往返一致性校验。
export function tryFormatJson(line: string): string {
  try {
    const parsed = jsonParse(line);
    const stringified = jsonStringify(parsed);

    // Check if precision was lost during JSON round-trip
    // This happens when large integers exceed Number.MAX_SAFE_INTEGER
    // We normalize both strings by removing whitespace and unnecessary
    // escapes (\/ is valid but optional in JSON) for comparison
// 往返校验的归一化：两侧都去空白、原文侧再去斜杠转义（JSON 里斜杠转义合法但可选）。归一化后不相等即判定精度丢失，返回原始行不美化——宁可不格式化也不改数值。
    const normalizedOriginal = line.replace(/\\\//g, '/').replace(/\s+/g, '');
    const normalizedStringified = stringified.replace(/\s+/g, '');
    if (normalizedOriginal !== normalizedStringified) {
      // Precision loss detected - return original line unformatted
      return line;
    }
// 校验通过才做两空格缩进的美化输出。jsonParse 与 jsonStringify 来自 slowOperations 模块——大 JSON 的解析要走慢路径保护。
    return jsonStringify(parsed, null, 2);
  } catch {
    return line;
  }
}
// 整体长度上限 1 万字符：超长内容直接跳过逐行 JSON 探测——对十 KB 以上的输出做逐行 try-parse 得不偿失。
const MAX_JSON_FORMAT_LENGTH = 10_000;
export function tryJsonFormatContent(content: string): string {
  if (content.length > MAX_JSON_FORMAT_LENGTH) {
    return content;
  }
  const allLines = content.split('\n');
  return allLines.map(tryFormatJson).join('\n');
}

// Match http(s) URLs inside JSON string values. Conservative: no quotes,
// no whitespace, no trailing comma/brace that'd be JSON structure.
// URL 正则的保守策略：不含引号、空白和尖括号反斜杠——宁可漏掉边界情况也不把 JSON 结构字符（收尾的逗号、括号）吞进链接。
const URL_IN_JSON = /https?:\/\/[^\s"'<>\\]+/g;
// linkify 用 createHyperlink 生成 OSC 8 转义序列：终端支持时显示可点击链接，不支持时退化为原文，零成本降级。
export function linkifyUrlsInText(content: string): string {
  return content.replace(URL_IN_JSON, url => createHyperlink(url));
}
// OutputLine：Shell 输出行的统一渲染入口——JSON 自动美化、URL 自动链接、按 verbose 与展开状态决定截断。_c(11) 三段缓存。
export function OutputLine(t0) {
  const $ = _c(11);
  const {
    content,
    verbose,
    isError,
    isWarning,
    linkifyUrls
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const expandShellOutput = useExpandShellOutput();
  const inVirtualList = React.useContext(InVirtualListContext);
// 全量显示的两个开关：verbose（verbose 模式或该消息被标记）或 expandShellOutput 上下文（用户按过展开快捷键）。任一为真就不截断。
  const shouldShowFull = verbose || expandShellOutput;
  let t1;
  if ($[0] !== columns || $[1] !== content || $[2] !== inVirtualList || $[3] !== linkifyUrls || $[4] !== shouldShowFull) {
// bb0 标签块：编译器把 if 早退重写成 break bb2 风格的带标签块——全量与截断两条路径在块内各自给 t1 赋值后跳出，不是业务语法。
    bb0: {
      let formatted = tryJsonFormatContent(content);
      if (linkifyUrls) {
        formatted = linkifyUrlsInText(formatted);
      }
      if (shouldShowFull) {
        t1 = stripUnderlineAnsi(formatted);
        break bb0;
      }
// 截断路径：renderTruncatedContent 按终端列宽截断，inVirtualList 为真时用虚拟列表的截断口径——同一内容在两种容器里截法不同。
      t1 = stripUnderlineAnsi(renderTruncatedContent(formatted, columns, inVirtualList));
    }
    $[0] = columns;
    $[1] = content;
    $[2] = inVirtualList;
    $[3] = linkifyUrls;
    $[4] = shouldShowFull;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const formattedContent = t1;
// 颜色按 isError 与 isWarning 二选一，普通输出不着色——着色决策与内容决策分开缓存。
  const color = isError ? "error" : isWarning ? "warning" : undefined;
  let t2;
  if ($[6] !== formattedContent) {
    t2 = <Ansi>{formattedContent}</Ansi>;
    $[6] = formattedContent;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  let t3;
  if ($[8] !== color || $[9] !== t2) {
    t3 = <MessageResponse><Text color={color}>{t2}</Text></MessageResponse>;
    $[8] = color;
    $[9] = t2;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  return t3;
}

// 注释坦白了一个未解之谜：下划线 ANSI 码特别容易泄漏，连补发重置码都拦不住，原因不明；而全剥 ANSI 又会丢失用户要的格式——所以只精准剥下划线类码，其余原样保留。工程上「承认未知、收窄处理面」的范例。
/**
 * Underline ANSI codes in particular tend to leak out for some reason. I wasn't
 * able to figure out why, or why emitting a reset ANSI code wasn't enough to
 * prevent them from leaking. I also didn't want to strip all ANSI codes with
 * stripAnsi(), because we used to do that and people complained about losing
 * all formatting. So we just strip the underline ANSI codes specifically.
 */
export function stripUnderlineAnsi(content: string): string {
  return content.replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[([0-9]+;)*4(;[0-9]+)*m|\u001b\[4(;[0-9]+)*m|\u001b\[([0-9]+;)*4m/g, '');
}
// 原文件此处有一行 10300 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。