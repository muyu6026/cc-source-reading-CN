import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useMemo } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { Box, NoSelect, Text } from '../../../ink.js';
import { intersperse } from '../../../utils/array.js';
import { getPatchForDisplay } from '../../../utils/diff.js';
import { HighlightedCode } from '../../HighlightedCode.js';
import { StructuredDiff } from '../../StructuredDiff.js';
type Props = {
  file_path: string;
  content: string;
  fileExists: boolean;
  oldContent: string;
};
// 文件写入工具的 diff 预览：已存在的文件显示结构化 diff，新文件直接高亮全文
export function FileWriteToolDiff(t0) {
  const $ = _c(15);
  const {
    file_path,
    content,
    fileExists,
    oldContent
  } = t0;
  const {
    columns
  } = useTerminalSize();
// bb0 标签块是编译器对 useMemo 提前 return 的重写：!fileExists 时置 null 跳出块——非业务 goto 语法
  let t1;
  bb0: {
    if (!fileExists) {
      t1 = null;
      break bb0;
    }
    let t2;
// getPatchForDisplay 把「整文件替换」包成一次 edit：old_string 为旧全文、new_string 为新全文，复用通用 diff 管线
    if ($[0] !== content || $[1] !== file_path || $[2] !== oldContent) {
      t2 = getPatchForDisplay({
        filePath: file_path,
        fileContents: oldContent,
        edits: [{
          old_string: oldContent,
          new_string: content,
          replace_all: false
        }]
      });
      $[0] = content;
      $[1] = file_path;
      $[2] = oldContent;
      $[3] = t2;
    } else {
      t2 = $[3];
    }
    t1 = t2;
  }
  const hunks = t1;
  let t2;
  if ($[4] !== content) {
    t2 = content.split("\n")[0] ?? null;
// firstLine 取新内容首行：diff 显示时辅助定位上下文
    $[4] = content;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const firstLine = t2;
  let t3;
  if ($[6] !== columns || $[7] !== content || $[8] !== file_path || $[9] !== firstLine || $[10] !== hunks || $[11] !== oldContent) {
    t3 = hunks ? intersperse(hunks.map(_ => <StructuredDiff key={_.newStart} patch={_} dim={false} filePath={file_path} firstLine={firstLine} fileContent={oldContent} width={columns - 2} />), _temp) : <HighlightedCode code={content || "(No content)"} filePath={file_path} />;
// 有 hunks 走 StructuredDiff 列表（intersperse 用 _temp 插入省略号分隔），无 hunks（新文件）走 HighlightedCode 全文预览，空内容显示 (No content)
    $[6] = columns;
    $[7] = content;
    $[8] = file_path;
    $[9] = firstLine;
    $[10] = hunks;
    $[11] = oldContent;
    $[12] = t3;
  } else {
    t3 = $[12];
  }
  let t4;
  if ($[13] !== t3) {
    t4 = <Box flexDirection="column"><Box borderColor="subtle" borderStyle="dashed" flexDirection="column" borderLeft={false} borderRight={false} paddingX={1}>{t3}</Box></Box>;
// 虚线边框容器：borderColor=subtle、只留上下边框，视觉上圈出 diff 区域
    $[13] = t3;
    $[14] = t4;
  } else {
    t4 = $[14];
  }
  return t4;
}
// _temp 即省略号分隔项：key 为 ellipsis-i 的 NoSelect 暗色省略号——hunks 之间的视觉间隔
function _temp(i) {
  return <NoSelect fromLeftEdge={true} key={`ellipsis-${i}`}><Text dimColor={true}>...</Text></NoSelect>;
}
// 原文件此处有一行 7180 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。