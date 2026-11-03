// Diff 查看器左侧的文件清单。三件事：把文件数**限制在 5 行**并做滚动窗口（含「上方还有 N 个 / 下方还有 N 个」提示）、路径**从头部截断**（保留尾部文件名）、以及每种不可 diff 的文件（未跟踪 / 二进制 / 超长）各给一句状态而不是空白。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useMemo } from 'react';
import type { DiffFile } from '../../hooks/useDiffData.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import { truncateStartToWidth } from '../../utils/format.js';
import { plural } from '../../utils/stringUtils.js';
// `MAX_VISIBLE_FILES = 5` 是个硬上限而不是可配的。原因是这个清单挤在 diff 正文旁边，它的高度直接吃掉正文的行数——文件一多就该让用户用滚动而不是把清单撑长。
const MAX_VISIBLE_FILES = 5;
type Props = {
  files: DiffFile[];
  selectedIndex: number;
};
// 注意这里 `useTerminalSize` 与滚动窗口计算都放在**两个提前 return 之前**：React 的 hook 顺序必须稳定，若把 useMemo 放到 `files.length === 0` 的 return 之后，文件数从 0 变 1 时 hook 数量就变了。注释里也写了「必须在 early return 之前，为了 hook 规则」。
export function DiffFileList(t0) {
  const $ = _c(36);
  const {
    files,
    selectedIndex
  } = t0;
  const {
    columns
  } = useTerminalSize();
  let t1;
  bb0: {
// 两条件合并成一个判断：文件数 ≤ 5 时窗口就是全量。这时 `startIndex` 恒为 0，下面所有「上方还有更多」的判断都会自然为假，不需要额外分支。
    if (files.length === 0 || files.length <= MAX_VISIBLE_FILES) {
      let t2;
      if ($[0] !== files.length) {
        t2 = {
          startIndex: 0,
          endIndex: files.length
        };
        $[0] = files.length;
        $[1] = t2;
      } else {
        t2 = $[1];
      }
      t1 = t2;
      break bb0;
    }
// 常规窗口算法：让选中项**居中**（`selectedIndex - floor(5/2)`），再钳到 0。居中而不是贴边，是因为用户用上下键逐项浏览时，希望看到「前后各两个」的上下文。
    let start = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE_FILES / 2));
    let end = start + MAX_VISIBLE_FILES;
// 窗口右端越界时，不是把 end 钳到 length 就完事，还要**回拉 start**（`start = end - 5`）。只钳 end 会让最后几项时窗口变短、清单高度从 5 行掉到 2 行，整块布局跟着跳。
    if (end > files.length) {
      end = files.length;
      start = Math.max(0, end - MAX_VISIBLE_FILES);
    }
    let t2;
    if ($[2] !== end || $[3] !== start) {
      t2 = {
        startIndex: start,
        endIndex: end
      };
      $[2] = end;
      $[3] = start;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    t1 = t2;
  }
  const {
    startIndex,
    endIndex
  } = t1;
// 空列表单独早退，返回一行 dim 的 No changed files。它没有像 FuzzyPicker 那样预留等高占位——因为 diff 查看器本身就是整屏布局，少 5 行不会导致输入框跳动，与 picker 的场景不同。
  if (files.length === 0) {
    let t2;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>No changed files</Text>;
      $[5] = t2;
    } else {
      t2 = $[5];
    }
    return t2;
  }
  let T0;
  let hasMoreBelow;
  let needsPagination;
  let t2;
  let t3;
  let t4;
  if ($[6] !== columns || $[7] !== endIndex || $[8] !== files || $[9] !== selectedIndex || $[10] !== startIndex) {
    const visibleFiles = files.slice(startIndex, endIndex);
    const hasMoreAbove = startIndex > 0;
    hasMoreBelow = endIndex < files.length;
    needsPagination = files.length > MAX_VISIBLE_FILES;
// 路径可用宽度是 `columns - 16 - 3 - 4`：16 预留右侧的增删行数，3 是边框与间距，4 是安全余量。和 MarkdownTable 里的 SAFETY_MARGIN 是同一个思路——终端布局里必须手算并留余量，否则窄终端下会挤出容器。
    const maxPathWidth = Math.max(20, columns - 16 - 3 - 4);
    T0 = Box;
    t2 = "column";
    if ($[17] !== hasMoreAbove || $[18] !== needsPagination || $[19] !== startIndex) {
// 上方提示只在**需要分页**时才渲染，且没有更多时渲染一个空格（不是 null）。渲染空格是为了保持清单总高度恒定：有提示与无提示差一行，会让下面的文件项整体上移一格、光标所指的文件看起来变了。
      t3 = needsPagination && <Text dimColor={true}>{hasMoreAbove ? ` ↑ ${startIndex} more ${plural(startIndex, "file")}` : " "}</Text>;
      $[17] = hasMoreAbove;
      $[18] = needsPagination;
      $[19] = startIndex;
      $[20] = t3;
    } else {
      t3 = $[20];
    }
    let t5;
    if ($[21] !== maxPathWidth || $[22] !== selectedIndex || $[23] !== startIndex) {
      t5 = (file, index) => <FileItem key={file.path} file={file} isSelected={startIndex + index === selectedIndex} maxPathWidth={maxPathWidth} />;
      $[21] = maxPathWidth;
      $[22] = selectedIndex;
      $[23] = startIndex;
      $[24] = t5;
    } else {
      t5 = $[24];
    }
    t4 = visibleFiles.map(t5);
    $[6] = columns;
    $[7] = endIndex;
    $[8] = files;
    $[9] = selectedIndex;
    $[10] = startIndex;
    $[11] = T0;
    $[12] = hasMoreBelow;
    $[13] = needsPagination;
    $[14] = t2;
    $[15] = t3;
    $[16] = t4;
  } else {
    T0 = $[11];
    hasMoreBelow = $[12];
    needsPagination = $[13];
    t2 = $[14];
    t3 = $[15];
    t4 = $[16];
  }
  let t5;
  if ($[25] !== endIndex || $[26] !== files.length || $[27] !== hasMoreBelow || $[28] !== needsPagination) {
// 下方提示与上方对称，数量用 `files.length - endIndex`。`plural(n, file)` 处理单复数，避免出现 `1 more files`。
    t5 = needsPagination && <Text dimColor={true}>{hasMoreBelow ? ` ↓ ${files.length - endIndex} more ${plural(files.length - endIndex, "file")}` : " "}</Text>;
    $[25] = endIndex;
    $[26] = files.length;
    $[27] = hasMoreBelow;
    $[28] = needsPagination;
    $[29] = t5;
  } else {
    t5 = $[29];
  }
  let t6;
  if ($[30] !== T0 || $[31] !== t2 || $[32] !== t3 || $[33] !== t4 || $[34] !== t5) {
    t6 = <T0 flexDirection={t2}>{t3}{t4}{t5}</T0>;
    $[30] = T0;
    $[31] = t2;
    $[32] = t3;
    $[33] = t4;
    $[34] = t5;
    $[35] = t6;
  } else {
    t6 = $[35];
  }
  return t6;
}
function FileItem(t0) {
  const $ = _c(14);
  const {
    file,
    isSelected,
    maxPathWidth
  } = t0;
  let t1;
  if ($[0] !== file.path || $[1] !== maxPathWidth) {
// 路径用 `truncateStartToWidth` **从头部截断**，保留尾巴。这是路径展示的通用选择：文件名与最后两级目录才是辨别依据，`/Users/xxx/projects/...` 这段前缀对所有人几乎一样。反过来从尾部截断（`truncateToWidth`）会正好砍掉最有信息量的部分。
    t1 = truncateStartToWidth(file.path, maxPathWidth);
    $[0] = file.path;
    $[1] = maxPathWidth;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const displayPath = t1;
// 指针用 `figures.pointer + 空格`，未选中时用**两个空格**而不是空串——保证选中前后每行的字符数完全一致。差一个字符会让整份清单在按上下键时左右抖动。
  const pointer = isSelected ? figures.pointer + " " : "  ";
  const line = `${pointer}${displayPath}`;
  const t2 = isSelected ? "background" : undefined;
  let t3;
  if ($[3] !== isSelected || $[4] !== line || $[5] !== t2) {
// 选中态同时用了 `bold`、`color=「background」`、`inverse` 三种强调。`inverse` 是反色（前景背景互换），在终端里这是最稳的「整行高亮」手段；加 bold 是为了在部分终端反色不够明显时仍有区分。
    t3 = <Text bold={isSelected} color={t2} inverse={isSelected}>{line}</Text>;
    $[3] = isSelected;
    $[4] = line;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// 路径文本与右侧统计之间插一个 `flexGrow={1}` 的空盒，把两者顶到两端。这是 Ink 里实现「左对齐 + 右对齐」的标准写法——没有 justify-content，只能靠弹性占位。
    t4 = <Box flexGrow={1} />;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== file || $[9] !== isSelected) {
    t5 = <FileStats file={file} isSelected={isSelected} />;
    $[8] = file;
    $[9] = isSelected;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== t3 || $[12] !== t5) {
    t6 = <Box flexDirection="row">{t3}{t4}{t5}</Box>;
    $[11] = t3;
    $[12] = t5;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  return t6;
}
function FileStats(t0) {
  const $ = _c(20);
  const {
    file,
    isSelected
  } = t0;
// 未跟踪文件走单独分支：只显示 untracked，不显示增删行数。因为未跟踪文件没有基线可比，git 算不出增删；显示 +0 -0 反而误导用户以为是空文件。
  if (file.isUntracked) {
    const t1 = !isSelected;
    let t2;
    if ($[0] !== t1) {
// 三种「不可 diff」状态的 dimColor 都取 `!isSelected`：未选中时变暗、选中时保持正常亮度。原因是选中行已经反色显示，再叠加 dim 会几乎看不清——这是「强调叠加要互斥」的一个具体例子。
      t2 = <Text dimColor={t1} italic={true}>untracked</Text>;
      $[0] = t1;
      $[1] = t2;
    } else {
      t2 = $[1];
    }
    return t2;
  }
  if (file.isBinary) {
    const t1 = !isSelected;
    let t2;
    if ($[2] !== t1) {
      t2 = <Text dimColor={t1} italic={true}>Binary file</Text>;
      $[2] = t1;
      $[3] = t2;
    } else {
      t2 = $[3];
    }
    return t2;
  }
  if (file.isLargeFile) {
    const t1 = !isSelected;
    let t2;
    if ($[4] !== t1) {
      t2 = <Text dimColor={t1} italic={true}>Large file modified</Text>;
      $[4] = t1;
      $[5] = t2;
    } else {
      t2 = $[5];
    }
    return t2;
  }
  let t1;
  if ($[6] !== file.linesAdded || $[7] !== isSelected) {
    t1 = file.linesAdded > 0 && <Text color="diffAddedWord" bold={isSelected}>+{file.linesAdded}</Text>;
    $[6] = file.linesAdded;
    $[7] = isSelected;
    $[8] = t1;
  } else {
    t1 = $[8];
  }
// 增删数量之间那个空格只在**两者都大于 0** 时才插（`&& ' '`）。若只有增或只有减，中间那句是空字符串直接消失，不会留下一个孤零零的空格。这种「条件分隔符」在拼行内文本时很常见，比先拼再 trim 更干净。
  const t2 = file.linesAdded > 0 && file.linesRemoved > 0 && " ";
  let t3;
  if ($[9] !== file.linesRemoved || $[10] !== isSelected) {
    t3 = file.linesRemoved > 0 && <Text color="diffRemovedWord" bold={isSelected}>-{file.linesRemoved}</Text>;
    $[9] = file.linesRemoved;
    $[10] = isSelected;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  let t4;
  if ($[12] !== file.isTruncated || $[13] !== isSelected) {
// `(truncated)` 又是一个独立的小尾巴，说明这个文件的 diff 被截断过（大文件保护）。它是清单里唯一提示「你看到的不是全部」的地方——点进去看到的 diff 也是截断的，所以这个标记必须在列表层就出现。
    t4 = file.isTruncated && <Text dimColor={!isSelected}> (truncated)</Text>;
    $[12] = file.isTruncated;
    $[13] = isSelected;
    $[14] = t4;
  } else {
    t4 = $[14];
  }
  let t5;
  if ($[15] !== t1 || $[16] !== t2 || $[17] !== t3 || $[18] !== t4) {
    t5 = <Text>{t1}{t2}{t3}{t4}</Text>;
    $[15] = t1;
    $[16] = t2;
    $[17] = t3;
    $[18] = t4;
    $[19] = t5;
  } else {
    t5 = $[19];
  }
  return t5;
}
// 原文件此处有一行 18016 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。