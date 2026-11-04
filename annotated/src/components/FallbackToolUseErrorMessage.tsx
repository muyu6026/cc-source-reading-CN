import { c as _c } from "react/compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import * as React from 'react';
import { stripUnderlineAnsi } from 'src/components/shell/OutputLine.js';
import { extractTag } from 'src/utils/messages.js';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { Box, Text } from '../ink.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { countCharInString } from '../utils/stringUtils.js';
import { MessageResponse } from './MessageResponse.js';
// 默认最多渲染 10 行——工具报错往往是大段堆栈，聊天流里只给头 10 行加省略提示。
const MAX_RENDERED_LINES = 10;
type Props = {
  result: ToolResultBlockParam['content'];
  verbose: boolean;
};
// FallbackToolUseErrorMessage：所有工具调用的兜底错误渲染。result 可能是字符串也可能是块数组，本组件负责把它归一成红字错误块。
export function FallbackToolUseErrorMessage(t0) {
  const $ = _c(25);
  const {
    result,
    verbose
  } = t0;
// transcript 快捷键文案来自 useShortcutDisplay：键位可被用户重映射，显示实际绑定而不是写死 ctrl+o。
  const transcriptShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  let T0;
  let T1;
  let T2;
  let plusLines;
  let t1;
  let t2;
  let t3;
// 整个错误归一管线在一个大缓存块里：依赖只有 result 与 verbose 两个。注意编译器把 Box、Text、MessageResponse 三个组件提升到 T0、T1、T2 局部变量——组件身份也参与缓存。
  if ($[0] !== result || $[1] !== verbose) {
    let error;
// 归一第一层：非字符串结果（块数组）没有可读文本，直接给通用文案。
    if (typeof result !== "string") {
      error = "Tool execution failed";
    } else {
// 第二层：从结果里抽 tool_use_error 标签内容，抽不到就用原文。第三层去掉沙箱违规标签与 error 标签——这些是机器标记，不该露给用户。
      const extractedError = extractTag(result, "tool_use_error") ?? result;
      const withoutSandboxViolations = removeSandboxViolationTags(extractedError);
      const withoutErrorTags = withoutSandboxViolations.replace(/<\/?error>/g, "");
      const trimmed = withoutErrorTags.trim();
// 第四层：非 verbose 下把 InputValidationError 折叠成「参数无效」——参数校验错误的原文动辄几十行 JSON schema 说明，用户只需要知道输错了。
      if (!verbose && trimmed.includes("InputValidationError: ")) {
        error = "Invalid tool parameters";
      } else {
// 第五层：已有 Error: 或 Cancelled: 前缀就保留，否则补一个——保证错误块的首词永远是 Error，视觉扫描时一行定位。
        if (trimmed.startsWith("Error: ") || trimmed.startsWith("Cancelled: ")) {
          error = trimmed;
        } else {
          error = `Error: ${trimmed}`;
        }
      }
    }
// plusLines：总行数减 10。行数用换行符计数加一算出，避免 split 建整个数组。
    plusLines = countCharInString(error, "\n") + 1 - MAX_RENDERED_LINES;
    T2 = MessageResponse;
    T1 = Box;
    t3 = "column";
    T0 = Text;
    t1 = "error";
// verbose 给全文，否则 split 取前 10 行再拼回——截断发生在 stripUnderlineAnsi 之前，被截掉的行连 ANSI 清理都省了。
    t2 = stripUnderlineAnsi(verbose ? error : error.split("\n").slice(0, MAX_RENDERED_LINES).join("\n"));
    $[0] = result;
    $[1] = verbose;
    $[2] = T0;
    $[3] = T1;
    $[4] = T2;
    $[5] = plusLines;
    $[6] = t1;
    $[7] = t2;
    $[8] = t3;
  } else {
    T0 = $[2];
    T1 = $[3];
    T2 = $[4];
    plusLines = $[5];
    t1 = $[6];
    t2 = $[7];
    t3 = $[8];
  }
  let t4;
  if ($[9] !== T0 || $[10] !== t1 || $[11] !== t2) {
    t4 = <T0 color={t1}>{t2}</T0>;
    $[9] = T0;
    $[10] = t1;
    $[11] = t2;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  let t5;
  if ($[13] !== plusLines || $[14] !== transcriptShortcut || $[15] !== verbose) {
// 省略提示：只在非 verbose 且确实有剩余行时显示，附实际键位文案。单复数按 plusLines 是否为一。
    t5 = !verbose && plusLines > 0 && <Box><Text dimColor={true}>… +{plusLines} {plusLines === 1 ? "line" : "lines"} (</Text><Text dimColor={true} bold={true}>{transcriptShortcut}</Text><Text> </Text><Text dimColor={true}>to see all)</Text></Box>;
    $[13] = plusLines;
    $[14] = transcriptShortcut;
    $[15] = verbose;
    $[16] = t5;
  } else {
    t5 = $[16];
  }
  let t6;
  if ($[17] !== T1 || $[18] !== t3 || $[19] !== t4 || $[20] !== t5) {
    t6 = <T1 flexDirection={t3}>{t4}{t5}</T1>;
    $[17] = T1;
    $[18] = t3;
    $[19] = t4;
    $[20] = t5;
    $[21] = t6;
  } else {
    t6 = $[21];
  }
  let t7;
  if ($[22] !== T2 || $[23] !== t6) {
    t7 = <T2>{t6}</T2>;
    $[22] = T2;
    $[23] = t6;
    $[24] = t7;
  } else {
    t7 = $[24];
  }
  return t7;
}
// 原文件此处有一行 9244 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。