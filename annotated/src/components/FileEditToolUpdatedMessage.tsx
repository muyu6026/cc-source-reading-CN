import { c as _c } from "react/compiler-runtime";
import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '../ink.js';
import { count } from '../utils/array.js';
import { MessageResponse } from './MessageResponse.js';
import { StructuredDiffList } from './StructuredDiffList.js';
type Props = {
  filePath: string;
  structuredPatch: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent?: string;
  style?: 'condensed';
// 文件编辑工具的「更新消息」组件：顶部一行增删行数统计，按 style 与 verbose 组合决定是只给一行摘要还是展开完整结构化 diff。Props 里的 fileContent 可选，传入时 diff 列表能对齐真实文件内容。
  verbose: boolean;
  previewHint?: string;
};
// 组件入口。注意 t0 是解构前的 props 对象——编译器产物把解构延后到第 20 行，便于把整个 props 作为单一依赖参与缓存比较。
export function FileEditToolUpdatedMessage(t0) {
// _c(22)：申请 22 个记忆槽。本组件的渲染输出被拆成 8 段独立缓存的 JSX（统计行、逗号、移除行、外层文本、previewHint、摘要文本、diff 列表、最终容器），段间靠槽位串联。
  const $ = _c(22);
  const {
    filePath,
    structuredPatch,
    firstLine,
    fileContent,
    style,
    verbose,
    previewHint
  } = t0;
  const {
    columns
  } = useTerminalSize();
// 增删行数统计：reduce 遍历每个 hunk，数以加号/减号开头的行。两条统计的归并函数被编译器提取为模块级 _temp2 与 _temp4（及其行判定 _temp 与 _temp3），见文件尾。
  const numAdditions = structuredPatch.reduce(_temp2, 0);
// 提取成模块级函数的关键收益：reduce 的回调引用在多次渲染间保持同一，编译器对 numAdditions 只需做值比较，不必担心回调身份变化击穿缓存。
  const numRemovals = structuredPatch.reduce(_temp4, 0);
  let t1;
  if ($[0] !== numAdditions) {
    t1 = numAdditions > 0 ? <>Added <Text bold={true}>{numAdditions}</Text>{" "}{numAdditions > 1 ? "lines" : "line"}</> : null;
    $[0] = numAdditions;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 分隔符只在「既有增又有删」时才给逗号，否则为 null——三段文本按 t1 加 t2 加 t3 直接拼接，空段自然消失。
  const t2 = numAdditions > 0 && numRemovals > 0 ? ", " : null;
  let t3;
  if ($[2] !== numAdditions || $[3] !== numRemovals) {
// 单数时大写 Removed、复数时小写 removed——because 两段统计拼接时，第一段后接逗号加小写续行更自然；只有删除没有新增时它才是句子开头，所以首字母按位置切换大小写。
    t3 = numRemovals > 0 ? <>{numAdditions === 0 ? "R" : "r"}emoved <Text bold={true}>{numRemovals}</Text>{" "}{numRemovals > 1 ? "lines" : "line"}</> : null;
    $[2] = numAdditions;
    $[3] = numRemovals;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t1 || $[6] !== t2 || $[7] !== t3) {
    t4 = <Text>{t1}{t2}{t3}</Text>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const text = t4;
// previewHint 分支：预览模式（还没真正落盘的编辑）不展示 diff，只给一行暗色提示。此分支在非 condensed 且非 verbose 时早退，直接返回不再往下走。
  if (previewHint) {
    if (style !== "condensed" && !verbose) {
      let t5;
      if ($[9] !== previewHint) {
        t5 = <MessageResponse><Text dimColor={true}>{previewHint}</Text></MessageResponse>;
        $[9] = previewHint;
        $[10] = t5;
      } else {
        t5 = $[10];
      }
      return t5;
    }
  } else {
// condensed 且非 verbose：只返回前面拼好的统计行 text，完整 diff 不渲染——这是聊天流里默认的紧凑视图。
    if (style === "condensed" && !verbose) {
      return text;
    }
  }
  let t5;
  if ($[11] !== text) {
    t5 = <Text>{text}</Text>;
    $[11] = text;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
// diff 列表宽度减 12：为 MessageResponse 的左侧竖线与缩进留出边距，否则宽 diff 会溢出触发重绘闪烁。
  const t6 = columns - 12;
  let t7;
// StructuredDiffList 是重组件，依赖数组给全五个入参：fileContent、filePath、firstLine、structuredPatch 与宽度。任一不变就复用 $[18] 的旧节点，大列表不会因父组件其他状态变化而重建。
  if ($[13] !== fileContent || $[14] !== filePath || $[15] !== firstLine || $[16] !== structuredPatch || $[17] !== t6) {
    t7 = <StructuredDiffList hunks={structuredPatch} dim={false} width={t6} filePath={filePath} firstLine={firstLine} fileContent={fileContent} />;
    $[13] = fileContent;
    $[14] = filePath;
    $[15] = firstLine;
    $[16] = structuredPatch;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  let t8;
  if ($[19] !== t5 || $[20] !== t7) {
// 最终容器：MessageResponse 包一列，统计行在上、diff 列表在下。注意 text 在第 82 行又被包了一层 Text——t5 与第 77 行直接返回的 text 不是同一个节点，两处缓存互不影响。
    t8 = <MessageResponse><Box flexDirection="column">{t5}{t7}</Box></MessageResponse>;
    $[19] = t5;
    $[20] = t7;
    $[21] = t8;
  } else {
    t8 = $[21];
  }
  return t8;
}
function _temp4(acc_0, hunk_0) {
  return acc_0 + count(hunk_0.lines, _temp3);
}
// 行判定函数：减号开头即删除行。编译器把内联箭头函数提升为模块级常量，四个 _temp 按引用顺序倒着编号（_temp2 定义在后、先被引用）。
function _temp3(__0) {
  return __0.startsWith("-");
}
function _temp2(acc, hunk) {
  return acc + count(hunk.lines, _temp);
}
function _temp(_) {
  return _.startsWith("+");
}
// 原文件此处有一行 8828 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。