// 本文件是结构化 diff 的降级渲染器：没有语法高亮时，用词级对比把「改了哪几个词」直接标出来，而不是只标「哪几行变了」。管线四步——把带加减号前缀的行转成对象、把相邻的删行与加行配对、给配对逐词比较、按可用宽度手动折行后渲染；变化比例超过阈值或处于暗色模式时退回整行着色。
import { c as _c } from "react/compiler-runtime";
import { diffWordsWithSpace, type StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { useMemo } from 'react';
import type { ThemeName } from 'src/utils/theme.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, NoSelect, Text, useTheme, wrapText } from '../../ink.js';

// 文件头用一段完整示例讲清了整条流水线：原始函数名与属性名各改一处，词级对比会切成「公共片段、删除片段、新增片段、公共片段」四段，渲染时公共段正常、删除段深红底、新增段深绿底。读代码前先读这段，后面每个函数都对得上其中一步。
/*
 * StructuredDiffFallback Component: Word-Level Diff Highlighting Example
 *
 * This component shows diff changes with word-level highlighting. Here's a walkthrough:
 *
 * Example:
 * ```
 * // Original code
 * function oldName(param) {
 *   return param.oldProperty;
 * }
 *
 * // Changed code
 * function newName(param) {
 *   return param.newProperty;
 * }
 * ```
 *
 * Processing flow:
 * 1. Component receives a patch with lines including '+' and '-' prefixes
 * 2. Lines are transformed into objects with type (add/remove/nochange)
 * 3. Related add/remove lines are paired (e.g., oldName with newName)
 * 4. Word-level diffing identifies specific changed parts:
 *    [
 *      { value: 'function ', added: undefined, removed: undefined },  // Common
 *      { value: 'oldName', removed: true },                           // Removed
 *      { value: 'newName', added: true },                             // Added
 *      { value: '(param) {', added: undefined, removed: undefined }   // Common
 *    ]
 * 5. Renders with enhanced highlighting:
 *    - Common parts are shown normally
 *    - Removed words get a darker red background
 *    - Added words get a darker green background
 *
 * This produces a visually clear diff where users can see exactly which words
 * changed rather than just which lines were modified.
 */

// 行对象的内部形态：代码、变更类型、行号、原始代码（未去前缀），外加两个可选字段——是否参与词级对比、配对的另一半是谁。
// Define DiffLine interface to be used throughout the file
interface DiffLine {
  code: string;
  type: 'add' | 'remove' | 'nochange';
  i: number;
  originalCode: string;
  wordDiff?: boolean; // Flag for word-level diffing
  matchedLine?: DiffLine;
}

// 对外导出的行对象类型，与内部形态同构；导出是因为编号函数与测试都要用它。
// Line object type for internal functions
export interface LineObject {
  code: string;
  i: number;
  type: 'add' | 'remove' | 'nochange';
  originalCode: string;
  wordDiff?: boolean;
  matchedLine?: LineObject;
}

// Type for word-level diff parts
interface DiffPart {
  added?: boolean;
  removed?: boolean;
  value: string;
}
// Props：一个补丁片段、是否暗色、可用宽度。宽度由外层传入而不是自己测量，保证与其他渲染器对齐。
type Props = {
  patch: StructuredPatchHunk;
  dim: boolean;
  width: number;
};

// 变化比例阈值 0.4：词级差异超过四成时，逐词高亮反而比整行着色更难读，直接退回整行。
// Threshold for when we show a full-line diff instead of word-level diffing
const CHANGE_THRESHOLD = 0.4;
// 组件本体很薄：算一次格式化结果（带缓存），再逐行包一层容器。所有复杂度都在下面的纯函数里。
export function StructuredDiffFallback(t0) {
  const $ = _c(10);
  const {
    patch,
    dim,
    width
  } = t0;
  const [theme] = useTheme();
  let t1;
// 格式化入口：行数组、起始行号、宽度、暗色、主题一次传入，返回可直接渲染的节点数组。
  if ($[0] !== dim || $[1] !== patch.lines || $[2] !== patch.oldStart || $[3] !== theme || $[4] !== width) {
    t1 = formatDiff(patch.lines, patch.oldStart, width, dim, theme);
    $[0] = dim;
    $[1] = patch.lines;
    $[2] = patch.oldStart;
    $[3] = theme;
    $[4] = width;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const diff = t1;
  let t2;
  if ($[6] !== diff) {
    t2 = diff.map(_temp);
    $[6] = diff;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  let t3;
  if ($[8] !== t2) {
    t3 = <Box flexDirection="column" flexGrow={1}>{t2}</Box>;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  return t3;
}

// Transform lines to line objects with type information
function _temp(node, i) {
  return <Box key={i}>{node}</Box>;
}
// 第一步：把每行按首字符分类。加号是新增、减号是删除、其余是未改动；统一去掉首字符存进代码字段，原始代码另存一份——词级对比要用带前缀对称的原文。
export function transformLinesToObjects(lines: string[]): LineObject[] {
  return lines.map(code => {
    if (code.startsWith('+')) {
      return {
        code: code.slice(1),
        i: 0,
        type: 'add',
        originalCode: code.slice(1)
      };
    }
    if (code.startsWith('-')) {
      return {
        code: code.slice(1),
        i: 0,
        type: 'remove',
        originalCode: code.slice(1)
      };
    }
    return {
      code: code.slice(1),
      i: 0,
      type: 'nochange',
      originalCode: code.slice(1)
    };
  });
}

// 第二步：把「连续删行紧跟连续加行」的段落整体收集起来，准备配对。这是唯一能识别出「改写」而不是「删一段加一段」的地方。
// Group adjacent add/remove lines for word-level diffing
export function processAdjacentLines(lineObjects: LineObject[]): LineObject[] {
  const processedLines: LineObject[] = [];
  let i = 0;
  while (i < lineObjects.length) {
    const current = lineObjects[i];
    if (!current) {
      i++;
      continue;
    }

    // Find a sequence of remove followed by add (possible word-level diff candidates)
// 遇到删行就开始收集：先连续吃删行，再连续吃加行；两者都有才进入配对分支，只有删行就原样保留。
    if (current.type === 'remove') {
      const removeLines: LineObject[] = [current];
      let j = i + 1;

      // Collect consecutive remove lines
      while (j < lineObjects.length && lineObjects[j]?.type === 'remove') {
        const line = lineObjects[j];
        if (line) {
          removeLines.push(line);
        }
        j++;
      }

      // Check if there are add lines following the remove lines
      const addLines: LineObject[] = [];
      while (j < lineObjects.length && lineObjects[j]?.type === 'add') {
        const line = lineObjects[j];
        if (line) {
          addLines.push(line);
        }
        j++;
      }

      // If we have both remove and add lines, perform word-level diffing
// 配对：按较短一侧的数量逐对绑定，双向写 matchedLine 并打上词级标记。多出来的行保持未配对——未配对行走整行渲染，不会丢内容。
      if (removeLines.length > 0 && addLines.length > 0) {
        // For word diffing, we'll compare each pair of lines or the closest available match
        const pairCount = Math.min(removeLines.length, addLines.length);

        // Add paired lines with word diff info
        for (let k = 0; k < pairCount; k++) {
          const removeLine = removeLines[k];
          const addLine = addLines[k];
          if (removeLine && addLine) {
            removeLine.wordDiff = true;
            addLine.wordDiff = true;

            // Store the matched pair for later word diffing
            removeLine.matchedLine = addLine;
            addLine.matchedLine = removeLine;
          }
        }

        // Add all remove lines (both paired and unpaired)
        processedLines.push(...removeLines.filter(Boolean));

        // Then add all add lines (both paired and unpaired)
        processedLines.push(...addLines.filter(Boolean));
        i = j; // Skip all the lines we've processed
      } else {
        // No matching add lines, just add the current remove line
        processedLines.push(current);
        i++;
      }
    } else {
      // Not a remove line, just add it
      processedLines.push(current);
      i++;
    }
  }
  return processedLines;
}

// 逐词对比：用保留空白的词级 diff，而不是普通词级 diff——否则尖括号与花括号之间的空格会被吞掉，代码看起来黏在一起。
// Calculate word-level diffs between two text strings
export function calculateWordDiffs(oldText: string, newText: string): DiffPart[] {
  // Use diffWordsWithSpace instead of diffWords to preserve whitespace
  // This ensures spaces between tokens like > and { are preserved
  const result = diffWordsWithSpace(oldText, newText, {
    ignoreCase: false
  });
  return result;
}

// 词级渲染器：先确定「哪一行是旧、哪一行是新」（删行自己当旧、配对行当新，反之亦然），再算变化比例。
// Process word-level diffs with manual wrapping support
function generateWordDiffElements(item: DiffLine, width: number, maxWidth: number, dim: boolean, overrideTheme?: ThemeName): React.ReactNode[] | null {
  const {
    type,
    i,
    wordDiff,
    matchedLine,
    originalCode
  } = item;
  if (!wordDiff || !matchedLine) {
    return null; // This function only handles word-level diff rendering
  }
  const removedLineText = type === 'remove' ? originalCode : matchedLine.originalCode;
  const addedLineText = type === 'remove' ? matchedLine.originalCode : originalCode;
  const wordDiffs = calculateWordDiffs(removedLineText, addedLineText);

  // Check if we should use word-level diffing
// 比例计算：删除片段与新增片段的字符数之和除以两行总长；超过阈值或暗色模式就返回 null，让调用方退回整行渲染。
  const totalLength = removedLineText.length + addedLineText.length;
  const changedLength = wordDiffs.filter(part => part.added || part.removed).reduce((sum, part) => sum + part.value.length, 0);
  const changeRatio = changedLength / totalLength;
  if (changeRatio > CHANGE_THRESHOLD || dim) {
    return null; // Fall back to standard rendering for major changes
  }

// 可用内容宽度等于总宽减行号列、减 1 格间距、减前缀宽度，最少留 1 格——终端极窄时宁可挤也不崩。
  // Calculate available width for content
  const diffPrefix = type === 'add' ? '+' : '-';
  const diffPrefixWidth = diffPrefix.length;
  const availableContentWidth = Math.max(1, width - maxWidth - 1 - diffPrefixWidth);

// 手动折行：逐段判断这段在该行该不该显示（加行不显示删除段、删行不显示新增段），该显示的段落按剩余宽度切成多行，超宽就另起一行。这里不用自动折行，是为了让每段高亮背景连续、不被断行打断。
  // Manually wrap the word diff parts with better space efficiency
  const wrappedLines: {
    content: React.ReactNode[];
    contentWidth: number;
  }[] = [];
  let currentLine: React.ReactNode[] = [];
  let currentLineWidth = 0;
// 逐段分派：加行里显示「新增段（绿底）」与「非删除段」，删行里显示「删除段（红底）」与「非新增段」；两边都不显示对方的专属段。
  wordDiffs.forEach((part, partIndex) => {
    // Determine if this part should be shown for this line type
    let shouldShow = false;
    let partBgColor: 'diffAddedWord' | 'diffRemovedWord' | undefined;
    if (type === 'add') {
      if (part.added) {
        shouldShow = true;
        partBgColor = 'diffAddedWord';
      } else if (!part.removed) {
        shouldShow = true;
      }
    } else if (type === 'remove') {
      if (part.removed) {
        shouldShow = true;
        partBgColor = 'diffRemovedWord';
      } else if (!part.added) {
        shouldShow = true;
      }
    }
    if (!shouldShow) return;

// 段落内部还要再折一次：长段落按可用宽度切成多行，切出来的每行单独成节点，背景色跟着段落走。
    // Use wrapText to wrap this individual part if it's long
    const partWrapped = wrapText(part.value, availableContentWidth, 'wrap');
    const partLines = partWrapped.split('\n');
    partLines.forEach((partLine, lineIdx) => {
      if (!partLine) return;

      // Check if we need to start a new line
      if (lineIdx > 0 || currentLineWidth + stringWidth(partLine) > availableContentWidth) {
        if (currentLine.length > 0) {
          wrappedLines.push({
            content: [...currentLine],
            contentWidth: currentLineWidth
          });
          currentLine = [];
          currentLineWidth = 0;
        }
      }
      currentLine.push(<Text key={`part-${partIndex}-${lineIdx}`} backgroundColor={partBgColor}>
          {partLine}
        </Text>);
      currentLineWidth += stringWidth(partLine);
    });
  });
  if (currentLine.length > 0) {
    wrappedLines.push({
      content: currentLine,
      contentWidth: currentLineWidth
    });
  }

// 渲染折行结果：每行拼「行号列、前缀、内容、右侧填充」，填充到整个终端宽度让背景色连成一条实心带；行号只在首行出现，续行留空格。
  // Render each wrapped line as a separate Text element
  return wrappedLines.map(({
    content,
    contentWidth
  }, lineIndex) => {
    const key = `${type}-${i}-${lineIndex}`;
    const lineBgColor = type === 'add' ? dim ? 'diffAddedDimmed' : 'diffAdded' : dim ? 'diffRemovedDimmed' : 'diffRemoved';
    const lineNum = lineIndex === 0 ? i : undefined;
    const lineNumStr = (lineNum !== undefined ? lineNum.toString().padStart(maxWidth) : ' '.repeat(maxWidth)) + ' ';
    // Calculate padding to fill the entire terminal width
    const usedWidth = lineNumStr.length + diffPrefixWidth + contentWidth;
    const padding = Math.max(0, width - usedWidth);
    return <Box key={key} flexDirection="row">
        <NoSelect fromLeftEdge>
          <Text color={overrideTheme ? 'text' : undefined} backgroundColor={lineBgColor} dimColor={dim}>
            {lineNumStr}
            {diffPrefix}
          </Text>
        </NoSelect>
        <Text color={overrideTheme ? 'text' : undefined} backgroundColor={lineBgColor} dimColor={dim}>
          {content}
          {' '.repeat(padding)}
        </Text>
      </Box>;
  });
}
// 主格式化函数：四步流水线的编排者，宽度先做下限保护（至少 1、取整），避免窄终端算出负宽度。
function formatDiff(lines: string[], startingLineNumber: number, width: number, dim: boolean, overrideTheme?: ThemeName): React.ReactNode[] {
  // Ensure width is at least 1 to prevent rendering issues with very narrow terminals
  const safeWidth = Math.max(1, Math.floor(width));

// 步骤一：行转对象。
  // Step 1: Transform lines to line objects with type information
  const lineObjects = transformLinesToObjects(lines);

// 步骤二：相邻删加配对。
  // Step 2: Group adjacent add/remove lines for word-level diffing
  const processedLines = processAdjacentLines(lineObjects);

// 步骤三：编号。编号要处理「一段连续删行共用一个起始行号、内部递增后再退回」的规则，见文件末尾的编号函数。
  // Step 3: Number the diff lines
  const ls = numberDiffLines(processedLines, startingLineNumber);

// 最大行号宽度决定行号列宽，加 1 是给行号后的空格留位。
  // Find max line number width for alignment
  const maxLineNumber = Math.max(...ls.map(({
    i
  }) => i), 0);
  const maxWidth = Math.max(maxLineNumber.toString().length + 1, 0);

  // Step 4: Render formatting
// 步骤四：逐行渲染。有词级标记且配对成功的先试词级渲染，返回空就落到整行渲染——这个 null 约定让「能不能词级」的判断留在渲染器内部，编排层不必知道阈值。
  return ls.flatMap((item): React.ReactNode[] => {
    const {
      type,
      code,
      i,
      wordDiff,
      matchedLine
    } = item;

    // Handle word-level diffing for add/remove pairs
// 词级尝试：只有同时具备词级标记与配对行才走这条路。
    if (wordDiff && matchedLine) {
      const wordDiffElements = generateWordDiffElements(item, safeWidth, maxWidth, dim, overrideTheme);

      // word-diff might refuse (e.g. due to lines being substantially different) in which
      // case we'll fall through to normal renderin gbelow
      if (wordDiffElements !== null) {
        return wordDiffElements;
      }
    }

// 整行渲染：按行号列加 1 格加前缀 2 格算可用宽度，折行后逐段拼装；未改动行前缀是空格，新增是加号、删除是减号。
    // Standard rendering for lines without word diffing or as fallback
    // Calculate available width accounting for line number + space + diff prefix
    const diffPrefixWidth = 2; // "  " for unchanged, "+ " or "- " for changes
    const availableContentWidth = Math.max(1, safeWidth - maxWidth - 1 - diffPrefixWidth); // -1 for space after line number
    const wrappedText = wrapText(code, availableContentWidth, 'wrap');
    const wrappedLines = wrappedText.split('\n');
    return wrappedLines.map((line, lineIndex) => {
      const key = `${type}-${i}-${lineIndex}`;
      const lineNum = lineIndex === 0 ? i : undefined;
      const lineNumStr = (lineNum !== undefined ? lineNum.toString().padStart(maxWidth) : ' '.repeat(maxWidth)) + ' ';
      const sigil = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';
      // Calculate padding to fill the entire terminal width
      const contentWidth = lineNumStr.length + 1 + stringWidth(line); // lineNum + sigil + code
      const padding = Math.max(0, safeWidth - contentWidth);
      const bgColor = type === 'add' ? dim ? 'diffAddedDimmed' : 'diffAdded' : type === 'remove' ? dim ? 'diffRemovedDimmed' : 'diffRemoved' : undefined;

      // Gutter (line number + sigil) is wrapped in <NoSelect> so fullscreen
      // text selection yields clean code. bgColor carries across both boxes
      // so the visual continuity (solid red/green bar) is unchanged.
// 行号与符号包在不参与选择的内容里：全屏模式下做文本选择时只选到代码本体，不会把行号带进剪贴板；背景色跨两个盒子保持一致，红色或绿色的实心条看起来是连续的。
      return <Box key={key} flexDirection="row">
          <NoSelect fromLeftEdge>
            <Text color={overrideTheme ? 'text' : undefined} backgroundColor={bgColor} dimColor={dim || type === 'nochange'}>
              {lineNumStr}
              {sigil}
            </Text>
          </NoSelect>
          <Text color={overrideTheme ? 'text' : undefined} backgroundColor={bgColor} dimColor={dim}>
            {line}
            {' '.repeat(padding)}
          </Text>
        </Box>;
    });
  });
}
// 编号函数：用队列逐个取出，未改动与新增各自递增；遇到删除则先放入当前行号，再把紧随其后的连续删行依次递增，最后把计数退回——这样一整段删除共用「原本的行号区间」，与常见 diff 工具的显示习惯一致。
export function numberDiffLines(diff: LineObject[], startLine: number): DiffLine[] {
  let i = startLine;
  const result: DiffLine[] = [];
  const queue = [...diff];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const {
      code,
      type,
      originalCode,
      wordDiff,
      matchedLine
    } = current;
    const line = {
      code,
      type,
      i,
      originalCode,
      wordDiff,
      matchedLine
    };

    // Update counters based on change type
// 三类计数规则集中在这个 switch：未改动与新增都前进一行；删除是一段特殊处理（先记当前、再为同段后续行递增、再回退）。
    switch (type) {
      case 'nochange':
        i++;
        result.push(line);
        break;
      case 'add':
        i++;
        result.push(line);
        break;
      case 'remove':
        {
          result.push(line);
          let numRemoved = 0;
          while (queue[0]?.type === 'remove') {
            i++;
            const current = queue.shift()!;
            const {
              code,
              type,
              originalCode,
              wordDiff,
              matchedLine
            } = current;
            const line = {
              code,
              type,
              i,
              originalCode,
              wordDiff,
              matchedLine
            };
            result.push(line);
            numRemoved++;
          }
          i -= numRemoved;
          break;
        }
    }
  }
  return result;
}
// 原文件此处有一行 40892 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。