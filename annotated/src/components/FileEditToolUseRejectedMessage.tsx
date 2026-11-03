import { c as _c } from "react/compiler-runtime";
// 导入 React 编译期缓存运行时
import type { StructuredPatchHunk } from 'diff';
// 引入 diff 库的结构化 hunk 类型
import { relative } from 'path';
import * as React from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { getCwd } from 'src/utils/cwd.js';
import { Box, Text } from '../ink.js';
import { HighlightedCode } from './HighlightedCode.js';
import { MessageResponse } from './MessageResponse.js';
import { StructuredDiffList } from './StructuredDiffList.js';
const MAX_LINES_TO_RENDER = 10;
// 新建文件预览最多渲染的行数
type Props = {
// 组件属性：文件路径、操作类型、差异或内容等
  file_path: string;
  operation: 'write' | 'update';
  // For updates - show diff
  patch?: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent?: string;
  // For new file creation - show content preview
  content?: string;
  style?: 'condensed';
  verbose: boolean;
};
export function FileEditToolUseRejectedMessage(t0) {
// 文件编辑被用户拒绝时的提示消息组件
  const $ = _c(38);
// $ 为 React Compiler 注入的 memo 缓存数组，长度 38
  const {
    file_path,
    operation,
    patch,
    firstLine,
    fileContent,
    content,
    style,
    verbose
  } = t0;
  const {
// 获取终端列宽用于代码宽度
    columns
  } = useTerminalSize();
  let t1;
  if ($[0] !== operation) {
    t1 = <Text color="subtle">User rejected {operation} to </Text>;
// 生成用户拒绝了某操作 前缀文本
    $[0] = operation;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== file_path || $[3] !== verbose) {
    t2 = verbose ? file_path : relative(getCwd(), file_path);
// verbose 时显示绝对路径，否则显示相对路径
    $[2] = file_path;
    $[3] = verbose;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== t2) {
    t3 = <Text bold={true} color="subtle">{t2}</Text>;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t1 || $[8] !== t3) {
    t4 = <Box flexDirection="row">{t1}{t3}</Box>;
    $[7] = t1;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const text = t4;
  if (style === "condensed" && !verbose) {
// 精简模式直接返回简短消息
    let t5;
    if ($[10] !== text) {
      t5 = <MessageResponse>{text}</MessageResponse>;
      $[10] = text;
      $[11] = t5;
    } else {
      t5 = $[11];
    }
    return t5;
  }
  if (operation === "write" && content !== undefined) {
// 写操作且有内容时预览新建文件
    let plusLines;
    let t5;
    if ($[12] !== content || $[13] !== verbose) {
      const lines = content.split("\n");
      const numLines = lines.length;
      plusLines = numLines - MAX_LINES_TO_RENDER;
// 计算超出渲染上限的剩余行数
      t5 = verbose ? content : lines.slice(0, MAX_LINES_TO_RENDER).join("\n");
      $[12] = content;
      $[13] = verbose;
      $[14] = plusLines;
      $[15] = t5;
    } else {
      plusLines = $[14];
      t5 = $[15];
    }
    const truncatedContent = t5;
    const t6 = truncatedContent || "(No content)";
// 无内容时显示占位文案
    const t7 = columns - 12;
    let t8;
    if ($[16] !== file_path || $[17] !== t6 || $[18] !== t7) {
      t8 = <HighlightedCode code={t6} filePath={file_path} width={t7} dim={true} />;
      $[16] = file_path;
      $[17] = t6;
      $[18] = t7;
      $[19] = t8;
    } else {
      t8 = $[19];
    }
    let t9;
    if ($[20] !== plusLines || $[21] !== verbose) {
      t9 = !verbose && plusLines > 0 && <Text dimColor={true}>… +{plusLines} lines</Text>;
// 非 verbose 且超出时提示剩余行数
      $[20] = plusLines;
      $[21] = verbose;
      $[22] = t9;
    } else {
      t9 = $[22];
    }
    let t10;
    if ($[23] !== t8 || $[24] !== t9 || $[25] !== text) {
      t10 = <MessageResponse><Box flexDirection="column">{text}{t8}{t9}</Box></MessageResponse>;
      $[23] = t8;
      $[24] = t9;
      $[25] = text;
      $[26] = t10;
    } else {
      t10 = $[26];
    }
    return t10;
  }
  if (!patch || patch.length === 0) {
// 无差异时仅返回文本消息
    let t5;
    if ($[27] !== text) {
      t5 = <MessageResponse>{text}</MessageResponse>;
      $[27] = text;
      $[28] = t5;
    } else {
      t5 = $[28];
    }
    return t5;
  }
  const t5 = columns - 12;
  let t6;
  if ($[29] !== fileContent || $[30] !== file_path || $[31] !== firstLine || $[32] !== patch || $[33] !== t5) {
    t6 = <StructuredDiffList hunks={patch} dim={true} width={t5} filePath={file_path} firstLine={firstLine} fileContent={fileContent} />;
// 有差异时渲染结构化 diff 列表
    $[29] = fileContent;
    $[30] = file_path;
    $[31] = firstLine;
    $[32] = patch;
    $[33] = t5;
    $[34] = t6;
  } else {
    t6 = $[34];
  }
  let t7;
  if ($[35] !== t6 || $[36] !== text) {
    t7 = <MessageResponse><Box flexDirection="column">{text}{t6}</Box></MessageResponse>;
// 将文本与 diff 包进消息响应组件
    $[35] = t6;
    $[36] = text;
    $[37] = t7;
  } else {
    t7 = $[37];
  }
  return t7;
}
// 原文件此处有一行 10772 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。