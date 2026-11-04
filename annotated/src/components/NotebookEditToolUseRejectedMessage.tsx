import { c as _c } from "react/compiler-runtime";
import { relative } from 'path';
import * as React from 'react';
import { getCwd } from 'src/utils/cwd.js';
import { Box, Text } from '../ink.js';
import { HighlightedCode } from './HighlightedCode.js';
import { MessageResponse } from './MessageResponse.js';
type Props = {
  notebook_path: string;
  cell_id: string | undefined;
  new_source: string;
  cell_type?: 'code' | 'markdown';
  edit_mode?: 'replace' | 'insert' | 'delete';
  verbose: boolean;
};
// notebook 编辑被拒绝的展示：三种编辑模式 replace/insert/delete
export function NotebookEditToolUseRejectedMessage(t0) {
  const $ = _c(20);
  const {
    notebook_path,
    cell_id,
    new_source,
    cell_type,
    edit_mode: t1,
    verbose
  } = t0;
  const edit_mode = t1 === undefined ? "replace" : t1;
// edit_mode 默认 replace：编译器把解构默认值展开成三元表达式
  const operation = edit_mode === "delete" ? "delete" : `${edit_mode} cell in`;
// operation 文案：delete 模式只说 delete，其他模式说 replace/insert cell in——删除的语序不同
  let t2;
  if ($[0] !== operation) {
    t2 = <Text color="subtle">User rejected {operation} </Text>;
    $[0] = operation;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== notebook_path || $[3] !== verbose) {
    t3 = verbose ? notebook_path : relative(getCwd(), notebook_path);
// 路径显示：verbose 模式给完整路径，否则 relative 到 cwd 缩短
    $[2] = notebook_path;
    $[3] = verbose;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t3) {
    t4 = <Text bold={true} color="subtle">{t3}</Text>;
    $[5] = t3;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== cell_id) {
    t5 = <Text color="subtle"> at cell {cell_id}</Text>;
// cell_id 可选：insert 新单元格时可能还没有 id，此时不显示 at cell 段
    $[7] = cell_id;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== t2 || $[10] !== t4 || $[11] !== t5) {
    t6 = <Box flexDirection="row">{t2}{t4}{t5}</Box>;
    $[9] = t2;
    $[10] = t4;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
// 代码预览段依赖 cell_type/edit_mode/new_source 三个比较项
  if ($[13] !== cell_type || $[14] !== edit_mode || $[15] !== new_source) {
    t7 = edit_mode !== "delete" && <Box marginTop={1} flexDirection="column"><HighlightedCode code={new_source} filePath={cell_type === "markdown" ? "file.md" : "file.py"} dim={true} /></Box>;
// delete 模式不渲染代码预览：edit_mode!==delete 与 HighlightedCode 短路——被拒绝的删除没有新代码可看；filePath 按单元格类型给 file.md 或 file.py 以命中对应语法高亮
    $[13] = cell_type;
    $[14] = edit_mode;
    $[15] = new_source;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== t6 || $[18] !== t7) {
    t8 = <MessageResponse><Box flexDirection="column">{t6}{t7}</Box></MessageResponse>;
// MessageResponse 包裹：与用户消息对齐的消息响应区结构
    $[17] = t6;
    $[18] = t7;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  return t8;
}
// 原文件此处有一行 6080 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。