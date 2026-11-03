// 终端里的 Markdown 表格渲染。核心难题是**没有 CSS**：终端只有等宽网格，列宽必须自己算、折行必须自己切、宽字符必须自己量。整份文件就是一套手写布局算法——三步算列宽、按行折行、垂直居中，最后还有一个「实在放不下就改纵向 key-value」的降级。
import type { Token, Tokens } from 'marked';
import React from 'react';
import stripAnsi from 'strip-ansi';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { wrapAnsi } from '../ink/wrapAnsi.js';
import { Ansi, useTheme } from '../ink.js';
import type { CliHighlight } from '../utils/cliHighlight.js';
import { formatToken, padAligned } from '../utils/markdown.js';

/** Accounts for parent indentation (e.g. message dot prefix) and terminal
 *  resize races. Without enough margin the table overflows its layout box
 *  and Ink's clip truncates differently on alternating frames, causing an
 *  infinite flicker loop in scrollback. */
// SAFETY_MARGIN 上面那段注释是整份文件里最值得读的一句话：不留够余量，表格会超出父容器，Ink 的裁剪在**相邻两帧可能裁得不一样**，于是滚动区里出现无限闪烁。终端 UI 里「超出一点」不是视觉瑕疵，是致命 bug——所以宁可少用 4 列。
const SAFETY_MARGIN = 4;

/** Minimum column width to prevent degenerate layouts */
const MIN_COLUMN_WIDTH = 3;

/**
 * Maximum number of lines per row before switching to vertical format.
 * When wrapping would make rows taller than this, vertical (key-value)
 * format provides better readability.
 */
// `MAX_ROW_LINES = 4`：任何一行折行后超过 4 行，就整体改用纵向格式。这是一个**可读性阈值**而不是容量阈值——横向表格里某格占 5 行时，同一行的其他格大部分是空白，扫读反而比 key-value 更累。
const MAX_ROW_LINES = 4;

/** ANSI escape codes for text formatting */
const ANSI_BOLD_START = '\x1b[1m';
const ANSI_BOLD_END = '\x1b[22m';
type Props = {
  token: Tokens.Table;
  highlight: CliHighlight | null;
  /** Override terminal width (useful for testing) */
  forceWidth?: number;
};

/**
 * Wrap text to fit within a given width, returning array of lines.
 * ANSI-aware: preserves styling across line breaks.
 *
 * @param hard - If true, break words that exceed width (needed when columns
 *               are narrower than the longest word). Default false.
 */
// wrapText 是全文件唯一的折行入口，所有单元格都过它。两个参数值得注意：`trim: false` 表示不自动去空格（表格需要保留缩进语义），`hard` 表示允许在词中间断开（列宽比最长单词还窄时只能这么办）。
function wrapText(text: string, width: number, options?: {
  hard?: boolean;
}): string[] {
  if (width <= 0) return [text];
// 长度判断在最前面：`width <= 0` 直接原样返回。这防的是极端情况——终端列数算出负数时（比如 3 列各要 5 字符但终端只有 8 列），若继续交给 wrapAnsi 会得到空数组，后面 `lines[0]` 就是 undefined。
  // Strip trailing whitespace/newlines before wrapping.
  // formatToken() adds EOL to paragraphs and other token types,
  // which would otherwise create extra blank lines in table cells.
  const trimmedText = text.trimEnd();
// 先 `trimEnd()` 再折行。原因写在注释里：单元格内容来自 `formatToken()`，它会给段落类 token 末尾追加换行符；不先去掉就会在格子里多出一行空行，整个表格的行高被撑坏。
  const wrapped = wrapAnsi(trimmedText, width, {
    hard: options?.hard ?? false,
    trim: false,
    wordWrap: true
  });
  // Filter out empty lines that result from trailing newlines or
  // multiple consecutive newlines in the source content.
// 折完再过滤空行，且**至少返回一个空字符串**。这两条都是为了让「单元格行数」这个值有确定语义：过滤空行保证多行内容里的连续换行不会变成多行空白，兜底返回 `['']` 保证每个格子至少占一行，后面算垂直居中时不会除以零。
  const lines = wrapped.split('\n').filter(line => line.length > 0);
  // Ensure we always return at least one line (empty string for empty cells)
  return lines.length > 0 ? lines : [''];
}

/**
 * Renders a markdown table using Ink's Box layout.
 * Handles terminal width by:
 * 1. Calculating minimum column widths based on longest word
 * 2. Distributing available space proportionally
 * 3. Wrapping text within cells (no truncation)
 * 4. Properly aligning multi-line rows with borders
 */
// 组件本体没有 `_c(N)`——它是手写 memo 化的普通组件（这份文件整体没走 React Compiler）。所以它把辅助函数都定义在组件内部（formatCell / getMinWidth 等），靠闭包拿 theme 与 highlight；代价是每次渲染重建函数，收益是能直接读 props 而不用层层传参。
export function MarkdownTable({
  token,
  highlight,
  forceWidth
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const {
    columns: actualTerminalWidth
  } = useTerminalSize();
  const terminalWidth = forceWidth ?? actualTerminalWidth;

  // Format cell content to ANSI string
// `formatCell` 是「单元格 → ANSI 字符串」的唯一入口：把一组 token 逐个交给 `formatToken` 渲染再拼起来。传入的 `0, null, null` 分别是嵌套深度、父 token、列表上下文——表格单元格里不做嵌套缩进，所以深度恒为 0。
  function formatCell(tokens: Token[] | undefined): string {
    return tokens?.map(_ => formatToken(_, theme, 0, null, null, highlight)).join('') ?? '';
  }

  // Get plain text (stripped of ANSI codes)
  function getPlainText(tokens_0: Token[] | undefined): string {
    return stripAnsi(formatCell(tokens_0));
  }

  // Get the longest word width in a cell (minimum width to avoid breaking words)
// `getMinWidth` 取**最长单词的宽度**，这就是「不硬断词」的下限。注意对空内容返回 `MIN_COLUMN_WIDTH`（3）而不是 0：列宽为 0 会让边框重叠、表格在视觉上「碎掉」。
  function getMinWidth(tokens_1: Token[] | undefined): number {
    const text = getPlainText(tokens_1);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return MIN_COLUMN_WIDTH;
    return Math.max(...words.map(w_0 => stringWidth(w_0)), MIN_COLUMN_WIDTH);
  }

  // Get ideal width (full content without wrapping)
  function getIdealWidth(tokens_2: Token[] | undefined): number {
    return Math.max(stringWidth(getPlainText(tokens_2)), MIN_COLUMN_WIDTH);
  }

  // Calculate column widths
  // Step 1: Get minimum (longest word) and ideal (full content) widths
  const minWidths = token.header.map((header, colIndex) => {
    let maxMinWidth = getMinWidth(header.tokens);
    for (const row of token.rows) {
      maxMinWidth = Math.max(maxMinWidth, getMinWidth(row[colIndex]?.tokens));
    }
    return maxMinWidth;
  });
  const idealWidths = token.header.map((header_0, colIndex_0) => {
    let maxIdeal = getIdealWidth(header_0.tokens);
    for (const row_0 of token.rows) {
      maxIdeal = Math.max(maxIdeal, getIdealWidth(row_0[colIndex_0]?.tokens));
    }
    return maxIdeal;
  });

  // Step 2: Calculate available space
  // Border overhead: │ content │ content │ = 1 + (width + 3) per column
  const numCols = token.header.length;
// 边框开销算得很具体：`1 + numCols * 3`。拆开是「最左一条竖线」加上「每列 2 个内边距 + 1 条竖线」。这种把边框当算术题算的写法在终端布局里很常见，因为 Box 的 border 会真实占用列数，算错一列就溢出。
  const borderOverhead = 1 + numCols * 3; // │ + (2 padding + 1 border) per col
  // Account for SAFETY_MARGIN to avoid triggering the fallback safety check
  const availableWidth = Math.max(terminalWidth - borderOverhead - SAFETY_MARGIN, numCols * MIN_COLUMN_WIDTH);

  // Step 3: Calculate column widths that fit available space
  const totalMin = minWidths.reduce((sum, w_1) => sum + w_1, 0);
  const totalIdeal = idealWidths.reduce((sum_0, w_2) => sum_0 + w_2, 0);

  // Track whether columns are narrower than longest words (needs hard wrap)
  let needsHardWrap = false;
  let columnWidths: number[];
// 列宽分配是三档而不是两档，这是本文件的核心算法。①理想宽能放下 → 直接用理想宽，表格不会撑满整行、看起来自然；②最小宽能放下 → 每列先给最小宽，剩余空间按各列「溢出量」的比例分配；③最小宽都放不下 → 等比缩放并允许硬断词。三档的分界条件分别是 totalIdeal、totalMin 与可用宽的比较，所以这两个和必须提前算好。
  if (totalIdeal <= availableWidth) {
    // Everything fits - use ideal widths
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    // Need to shrink - give each column its min, distribute remaining space
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, i) => ideal - minWidths[i]!);
    const totalOverflow = overflows.reduce((sum_1, o) => sum_1 + o, 0);
// 比例分配用 `Math.floor(overflows[i] / totalOverflow * extraSpace)`，注意是**向下取整**：这样分配的总和只会少于可用宽，不会超。少掉的那几列变成右侧留白，比溢出安全。当 `totalOverflow === 0`（所有列都已达理想宽）时直接返回最小宽，避免除以零。
    columnWidths = minWidths.map((min, i_0) => {
      if (totalOverflow === 0) return min;
      const extra = Math.floor(overflows[i_0]! / totalOverflow * extraSpace);
      return min + extra;
    });
  } else {
    // Table wider than terminal at minimum widths
    // Shrink columns proportionally to fit, allowing word breaks
    needsHardWrap = true;
// 最窄档：等比缩放。`Math.max(..., MIN_COLUMN_WIDTH)` 是硬下限——即使算出来每列该分到 1 列，也保底给 3 列，宁可整表溢出（后面有兜底）也不能让列宽小到边框吞掉内容。同时置 `needsHardWrap = true`，后面所有折行都会允许断词。
    const scaleFactor = availableWidth / totalMin;
    columnWidths = minWidths.map(w_3 => Math.max(Math.floor(w_3 * scaleFactor), MIN_COLUMN_WIDTH));
  }

  // Step 4: Calculate max row lines to determine if vertical format is needed
  function calculateMaxRowLines(): number {
    let maxLines = 1;
    // Check header
    for (let i_1 = 0; i_1 < token.header.length; i_1++) {
      const content = formatCell(token.header[i_1]!.tokens);
      const wrapped = wrapText(content, columnWidths[i_1]!, {
        hard: needsHardWrap
      });
      maxLines = Math.max(maxLines, wrapped.length);
    }
    // Check rows
    for (const row_1 of token.rows) {
      for (let i_2 = 0; i_2 < row_1.length; i_2++) {
        const content_0 = formatCell(row_1[i_2]?.tokens);
        const wrapped_0 = wrapText(content_0, columnWidths[i_2]!, {
          hard: needsHardWrap
        });
        maxLines = Math.max(maxLines, wrapped_0.length);
      }
    }
    return maxLines;
  }

  // Use vertical format if wrapping would make rows too tall
  const maxRowLines = calculateMaxRowLines();
// 算完列宽才知道要不要转纵向，所以这里必须**真的把所有格子折一遍**并取最大行数——这是一次纯测量、不产生输出。看起来浪费，但它换来的是一个准确的判定：只在「确实会很高」时才换成 key-value，而不是靠列数或字符数猜。
  const useVerticalFormat = maxRowLines > MAX_ROW_LINES;

  // Render a single row with potential multi-line cells
  // Returns an array of strings, one per line of the row
  function renderRowLines(cells: Array<{
    tokens?: Token[];
  }>, isHeader: boolean): string[] {
    // Get wrapped lines for each cell (preserving ANSI formatting)
    const cellLines = cells.map((cell, colIndex_1) => {
      const formattedText = formatCell(cell.tokens);
      const width = columnWidths[colIndex_1]!;
      return wrapText(formattedText, width, {
        hard: needsHardWrap
      });
    });

    // Find max number of lines in this row
    const maxLines_0 = Math.max(...cellLines.map(lines => lines.length), 1);

    // Calculate vertical offset for each cell (to center vertically)
// 同一行里各格行数不同时**垂直居中**：偏移量取 `floor((maxLines - lines) / 2)`。向上取整会让内容整体偏下、与边框贴太近；向下取整留出的空隙在上方，视觉上更接近「居中」。
    const verticalOffsets = cellLines.map(lines_0 => Math.floor((maxLines_0 - lines_0.length) / 2));

    // Build each line of the row as a single string
    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines_0; lineIdx++) {
      let line = '│';
      for (let colIndex_2 = 0; colIndex_2 < cells.length; colIndex_2++) {
        const lines_1 = cellLines[colIndex_2]!;
        const offset = verticalOffsets[colIndex_2]!;
        const contentLineIdx = lineIdx - offset;
        const lineText = contentLineIdx >= 0 && contentLineIdx < lines_1.length ? lines_1[contentLineIdx]! : '';
        const width_0 = columnWidths[colIndex_2]!;
        // Headers always centered; data uses table alignment
// 对齐规则是「表头恒居中、数据看 token 的 align」。这是本文件唯一一处**故意不遵守 Markdown 语义**的地方：Markdown 里表头也受 `:---:` 控制，但终端窄表里表头居中明显更好看，所以覆盖掉。
        const align = isHeader ? 'center' : token.align?.[colIndex_2] ?? 'left';
        line += ' ' + padAligned(lineText, stringWidth(lineText), width_0, align) + ' │';
      }
      result.push(line);
    }
    return result;
  }

  // Render horizontal border as a single string
  function renderBorderLine(type: 'top' | 'middle' | 'bottom'): string {
    const [left, mid, cross, right] = {
      top: ['┌', '─', '┬', '┐'],
      middle: ['├', '─', '┼', '┤'],
      bottom: ['└', '─', '┴', '┘']
    }[type] as [string, string, string, string];
    let line_0 = left;
    columnWidths.forEach((width_1, colIndex_3) => {
      line_0 += mid.repeat(width_1 + 2);
      line_0 += colIndex_3 < columnWidths.length - 1 ? cross : right;
    });
    return line_0;
  }

  // Render vertical format (key-value pairs) for extra-narrow terminals
// 纵向格式：每条记录之间用一条横线分隔，字段按「**加粗标签**: 值」排列。这是给极窄终端（或宽表塞不下）准备的降级视图——信息一条不少，只是从二维网格变成一维列表。
  function renderVerticalFormat(): string {
    const lines_2: string[] = [];
    const headers = token.header.map(h => getPlainText(h.tokens));
    const separatorWidth = Math.min(terminalWidth - 1, 40);
    const separator = '─'.repeat(separatorWidth);
    // Small indent for wrapped lines (just 2 spaces)
    const wrapIndent = '  ';
    token.rows.forEach((row_2, rowIndex) => {
      if (rowIndex > 0) {
        lines_2.push(separator);
      }
      row_2.forEach((cell_0, colIndex_4) => {
        const label = headers[colIndex_4] || `Column ${colIndex_4 + 1}`;
        // Clean value: trim, remove extra internal whitespace/newlines
        const rawValue = formatCell(cell_0.tokens).trimEnd();
// 值先 `trimEnd()` 再把所有连续空白（含换行）压成单空格。纵向格式是一维流，原文里的换行若不压平，一条记录会被撑成好几行、与下一条的边界模糊。
        const value = rawValue.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

        // Wrap value to fit terminal, accounting for label on first line
        const firstLineWidth = terminalWidth - stringWidth(label) - 3;
        const subsequentLineWidth = terminalWidth - wrapIndent.length - 1;

        // Two-pass wrap: first line is narrower (label takes space),
        // continuation lines get the full width minus indent.
// **两遍折行**：第一遍按「首行要扣掉标签宽度」的窄宽折，第二遍把首行之后的剩余文本重新按「整行减缩进」的宽折。这么绕是因为首行左边有 `标签:` 占位、续行只有 2 空格缩进，两者可用宽不同；一次性折会浪费续行的空间或让首行溢出。
        const firstPassLines = wrapText(value, Math.max(firstLineWidth, 10));
        const firstLine = firstPassLines[0] || '';
        let wrappedValue: string[];
        if (firstPassLines.length <= 1 || subsequentLineWidth <= firstLineWidth) {
          wrappedValue = firstPassLines;
        } else {
          // Re-join remaining text and re-wrap to the wider continuation width
          const remainingText = firstPassLines.slice(1).map(l => l.trim()).join(' ');
          const rewrapped = wrapText(remainingText, subsequentLineWidth);
          wrappedValue = [firstLine, ...rewrapped];
        }

        // First line: bold label + value
        lines_2.push(`${ANSI_BOLD_START}${label}:${ANSI_BOLD_END} ${wrappedValue[0] || ''}`);

        // Subsequent lines with small indent (skip empty lines)
        for (let i_3 = 1; i_3 < wrappedValue.length; i_3++) {
          const line_1 = wrappedValue[i_3]!;
          if (!line_1.trim()) continue;
          lines_2.push(`${wrapIndent}${line_1}`);
        }
      });
    });
    return lines_2.join('\n');
  }

  // Choose format based on available width
// 纵向格式有**两个**入口：这里（折行后行数超标）和下面 315 行（拼完之后发现仍超宽）。前者是「预判会太高」，后者是「实测溢出」——后者是终端 resize 竞态的唯一兜底，两者都不能省。
  if (useVerticalFormat) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  // Build the complete horizontal table as an array of strings
  const tableLines: string[] = [];
  tableLines.push(renderBorderLine('top'));
  tableLines.push(...renderRowLines(token.header, true));
  tableLines.push(renderBorderLine('middle'));
  token.rows.forEach((row_3, rowIndex_0) => {
    tableLines.push(...renderRowLines(row_3, false));
    if (rowIndex_0 < token.rows.length - 1) {
      tableLines.push(renderBorderLine('middle'));
    }
  });
  tableLines.push(renderBorderLine('bottom'));

// 安全兜底：把所有行拼完，实测最宽的一行是否超过 `terminalWidth - SAFETY_MARGIN`，超了就退回纵向格式。注释点明这是为 resize 竞态准备的——列宽是按某一时刻的终端宽度算的，而真正渲染时宽度可能已经变了。
  // Safety check: verify no line exceeds terminal width.
  // This catches edge cases during terminal resize where calculations
  // were based on a different width than the current render target.
  const maxLineWidth = Math.max(...tableLines.map(line_2 => stringWidth(stripAnsi(line_2))));

  // If we're within SAFETY_MARGIN characters of the edge, use vertical format
  // to account for terminal resize race conditions.
  if (maxLineWidth > terminalWidth - SAFETY_MARGIN) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

// 最终整表放进**一个** `<Ansi>` 块而不是逐行 `<Text>`。原因是 Ink 会对每个 Text 单独做换行决策，逐行渲染时某一行若比容器宽一列，Ink 会在行中间再折一次、把表格撕开；单块 Ansi 里换行符由我们自己控制，Ink 不再插手。
  // Render as a single Ansi block to prevent Ink from wrapping mid-row
  return <Ansi>{tableLines.join('\n')}</Ansi>;
}
// 原文件此处有一行 34548 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。