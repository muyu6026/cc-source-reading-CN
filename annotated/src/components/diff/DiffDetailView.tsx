// React Compiler 运行时，提供 `$` 记忆化缓存数组（编译产物标志）。
import { c as _c } from "react/compiler-runtime";
// 引入结构化 diff 的 hunk 类型、路径解析、终端尺寸与文件读取工具。
import type { StructuredPatchHunk } from 'diff';
import { resolve } from 'path';
import React, { useMemo } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import { getCwd } from '../../utils/cwd.js';
import { readFileSafe } from '../../utils/file.js';
import { Divider } from '../design-system/Divider.js';
import { StructuredDiff } from '../StructuredDiff.js';
// Props：filePath 与 hunks（差异块）；isLargeFile / isBinary / isTruncated / isUntracked 是几种「无法或不便展示真实 diff」的特殊状态。
type Props = {
  filePath: string;
  hunks: StructuredPatchHunk[];
  isLargeFile?: boolean;
  isBinary?: boolean;
  isTruncated?: boolean;
  isUntracked?: boolean;
};

// 组件说明：展示单个文件的 diff 内容，用 StructuredDiff 做词级差异与语法高亮；不滚动，全部渲染（解析上限约 400 行）。
/**
 * Displays the diff content for a single file.
 * Uses StructuredDiff for word-level diffing and syntax highlighting.
 * No scrolling - renders all lines (max 400 due to parsing limits).
 */
// DiffDetailView 组件。先读取文件首行与全文（用于 untracked 文件的行数统计），再按不同状态分支渲染。
export function DiffDetailView(t0) {
  const $ = _c(53);
  const {
    filePath,
    hunks,
    isLargeFile,
    isBinary,
    isTruncated,
    isUntracked
  } = t0;
  const {
    columns
  } = useTerminalSize();
  let t1;
// 用 `bb0` 命名 break 目标组织早期返回：无 filePath 时只构造一个空的首行与内容结构并跳出。
  bb0: {
    if (!filePath) {
      let t2;
      if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
        t2 = {
          firstLine: null,
          fileContent: undefined
        };
        $[0] = t2;
      } else {
        t2 = $[0];
      }
      t1 = t2;
      break bb0;
    }
// 读取文件：把绝对路径拼出来后用 readFileSafe 读全文，取首行用于 untracked 文件的行数提示。
    let content;
    let t2;
    if ($[1] !== filePath) {
      const fullPath = resolve(getCwd(), filePath);
      content = readFileSafe(fullPath);
      t2 = content?.split("\n")[0] ?? null;
      $[1] = filePath;
      $[2] = content;
      $[3] = t2;
    } else {
      content = $[2];
      t2 = $[3];
    }
    const t3 = content ?? undefined;
    let t4;
    if ($[4] !== t2 || $[5] !== t3) {
      t4 = {
        firstLine: t2,
        fileContent: t3
      };
      $[4] = t2;
      $[5] = t3;
      $[6] = t4;
    } else {
      t4 = $[6];
    }
    t1 = t4;
  }
  const {
    firstLine,
    fileContent
  } = t1;
// 未跟踪文件分支：展示文件名与「（untracked）」，提示尚未暂存；并建议 `git add` 以看到行数。
  if (isUntracked) {
    let t2;
    if ($[7] !== filePath) {
      t2 = <Text bold={true}>{filePath}</Text>;
      $[7] = filePath;
      $[8] = t2;
    } else {
      t2 = $[8];
    }
    let t3;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text dimColor={true}> (untracked)</Text>;
      $[9] = t3;
    } else {
      t3 = $[9];
    }
    let t4;
    if ($[10] !== t2) {
      t4 = <Box>{t2}{t3}</Box>;
      $[10] = t2;
      $[11] = t4;
    } else {
      t4 = $[11];
    }
    let t5;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Divider padding={4} />;
      $[12] = t5;
    } else {
      t5 = $[12];
    }
    let t6;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = <Text dimColor={true} italic={true}>New file not yet staged.</Text>;
      $[13] = t6;
    } else {
      t6 = $[13];
    }
    let t7;
    if ($[14] !== filePath) {
      t7 = <Box flexDirection="column">{t6}<Text dimColor={true} italic={true}>Run `git add {filePath}` to see line counts.</Text></Box>;
      $[14] = filePath;
      $[15] = t7;
    } else {
      t7 = $[15];
    }
    let t8;
    if ($[16] !== t4 || $[17] !== t7) {
      t8 = <Box flexDirection="column" width="100%">{t4}{t5}{t7}</Box>;
      $[16] = t4;
      $[17] = t7;
      $[18] = t8;
    } else {
      t8 = $[18];
    }
    return t8;
  }
// 二进制文件分支：无法展示 diff，只显示文件名与一条说明。
  if (isBinary) {
    let t2;
    if ($[19] !== filePath) {
      t2 = <Box><Text bold={true}>{filePath}</Text></Box>;
      $[19] = filePath;
      $[20] = t2;
    } else {
      t2 = $[20];
    }
    let t3;
    if ($[21] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Divider padding={4} />;
      $[21] = t3;
    } else {
      t3 = $[21];
    }
    let t4;
    if ($[22] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Box flexDirection="column"><Text dimColor={true} italic={true}>Binary file - cannot display diff</Text></Box>;
      $[22] = t4;
    } else {
      t4 = $[22];
    }
    let t5;
    if ($[23] !== t2) {
      t5 = <Box flexDirection="column" width="100%">{t2}{t3}{t4}</Box>;
      $[23] = t2;
      $[24] = t5;
    } else {
      t5 = $[24];
    }
    return t5;
  }
// 大文件分支：diff 超过约 1MB 上限时不展开，提示超限。
  if (isLargeFile) {
    let t2;
    if ($[25] !== filePath) {
      t2 = <Box><Text bold={true}>{filePath}</Text></Box>;
      $[25] = filePath;
      $[26] = t2;
    } else {
      t2 = $[26];
    }
    let t3;
    if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Divider padding={4} />;
      $[27] = t3;
    } else {
      t3 = $[27];
    }
    let t4;
    if ($[28] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Box flexDirection="column"><Text dimColor={true} italic={true}>Large file - diff exceeds 1 MB limit</Text></Box>;
      $[28] = t4;
    } else {
      t4 = $[28];
    }
    let t5;
    if ($[29] !== t2) {
      t5 = <Box flexDirection="column" width="100%">{t2}{t3}{t4}</Box>;
      $[29] = t2;
      $[30] = t5;
    } else {
      t5 = $[30];
    }
// 正常分支：展示文件名，若被截断则追加「（truncated）」标记。
    return t5;
  }
  let t2;
  if ($[31] !== filePath) {
    t2 = <Text bold={true}>{filePath}</Text>;
    $[31] = filePath;
    $[32] = t2;
  } else {
    t2 = $[32];
  }
  let t3;
  if ($[33] !== isTruncated) {
    t3 = isTruncated && <Text dimColor={true}> (truncated)</Text>;
    $[33] = isTruncated;
    $[34] = t3;
  } else {
    t3 = $[34];
  }
  let t4;
  if ($[35] !== t2 || $[36] !== t3) {
    t4 = <Box>{t2}{t3}</Box>;
    $[35] = t2;
    $[36] = t3;
    $[37] = t4;
  } else {
    t4 = $[37];
  }
// 把 hunk 列表映射成 StructuredDiff；无内容时显示「No diff content」。宽度按终端列数减去边距计算。
  let t5;
  if ($[38] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Divider padding={4} />;
    $[38] = t5;
  } else {
    t5 = $[38];
  }
  let t6;
  if ($[39] !== columns || $[40] !== fileContent || $[41] !== filePath || $[42] !== firstLine || $[43] !== hunks) {
    t6 = hunks.length === 0 ? <Text dimColor={true}>No diff content</Text> : hunks.map((hunk, index) => <StructuredDiff key={index} patch={hunk} filePath={filePath} firstLine={firstLine} fileContent={fileContent} dim={false} width={columns - 2 - 2} />);
    $[39] = columns;
    $[40] = fileContent;
    $[41] = filePath;
    $[42] = firstLine;
    $[43] = hunks;
    $[44] = t6;
  } else {
    t6 = $[44];
  }
  let t7;
  if ($[45] !== t6) {
// 截断提示：超过 400 行时显示「… diff truncated」。
    t7 = <Box flexDirection="column">{t6}</Box>;
    $[45] = t6;
    $[46] = t7;
  } else {
    t7 = $[46];
  }
// 组合最终竖向布局：文件名 + 分隔线 + diff 主体 + 截断提示，整体宽度占满。
  let t8;
  if ($[47] !== isTruncated) {
    t8 = isTruncated && <Text dimColor={true} italic={true}>… diff truncated (exceeded 400 line limit)</Text>;
    $[47] = isTruncated;
    $[48] = t8;
  } else {
    t8 = $[48];
  }
  let t9;
  if ($[49] !== t4 || $[50] !== t7 || $[51] !== t8) {
    t9 = <Box flexDirection="column" width="100%">{t4}{t5}{t7}{t8}</Box>;
    $[49] = t4;
    $[50] = t7;
    $[51] = t8;
    $[52] = t9;
  } else {
    t9 = $[52];
  }
  return t9;
}
// 原文件此处有一行 15828 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。