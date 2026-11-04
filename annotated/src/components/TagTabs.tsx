// 手写组件（非 React Compiler 产物），实现终端里的标签页栏，需要在固定宽度内排布多个标签并处理溢出。
import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { truncateToWidth } from '../utils/format.js';

// 这一组常量是「按实际渲染字符串宽度」反推出来的：标签两侧留白、非 All 标签的 `#` 前缀、左右溢出提示等，全部用字符串长度预计算，避免渲染时才发现宽度对不上。
// Constants for width calculations - derived from actual rendered strings
const ALL_TAB_LABEL = 'All';
const TAB_PADDING = 2; // Space before and after tab text: " {tab} "
const HASH_PREFIX_LENGTH = 1; // "#" prefix for non-All tabs
const LEFT_ARROW_PREFIX = '← ';
const RIGHT_HINT_WITH_COUNT_PREFIX = '→';
const RIGHT_HINT_SUFFIX = ' (tab to cycle)';
const RIGHT_HINT_NO_COUNT = '(tab to cycle)';
const MAX_OVERFLOW_DIGITS = 2; // Assume max 99 hidden tabs for width calculation

// LEFT_ARROW_WIDTH / RIGHT_HINT_WIDTH 等「二次计算宽度」：因为右端提示可能是「→NN (tab to cycle)」也可能只是「(tab to cycle)」，取两者较大者做最坏情况布局。
// Computed widths
const LEFT_ARROW_WIDTH = LEFT_ARROW_PREFIX.length + MAX_OVERFLOW_DIGITS + 1; // "← NN " with gap
const RIGHT_HINT_WIDTH_WITH_COUNT = RIGHT_HINT_WITH_COUNT_PREFIX.length + MAX_OVERFLOW_DIGITS + RIGHT_HINT_SUFFIX.length; // "→NN (tab to cycle)"
const RIGHT_HINT_WIDTH_NO_COUNT = RIGHT_HINT_NO_COUNT.length;
// Props：标签数组、当前选中下标、可用总宽度、是否展示「所有项目」入口。
type Props = {
  tabs: string[];
  selectedIndex: number;
  availableWidth: number;
  showAllProjects?: boolean;
};

/**
 * Calculate the display width of a tab
 */
// getTabWidth 计算单个标签的显示宽度：All 标签是固定字长加留白；其余标签前面带 `#` 前缀，超长时按 maxWidth 截断。
function getTabWidth(tab: string, maxWidth?: number): number {
  if (tab === ALL_TAB_LABEL) {
    return ALL_TAB_LABEL.length + TAB_PADDING;
  }
  // For non-All tabs: " #{tag} " but truncate tag if needed
  const tagWidth = stringWidth(tab);
  const effectiveTagWidth = maxWidth ? Math.min(tagWidth, maxWidth - TAB_PADDING - HASH_PREFIX_LENGTH) : tagWidth;
  return Math.max(0, effectiveTagWidth) + TAB_PADDING + HASH_PREFIX_LENGTH;
}

/**
 * Truncate a tag to fit within maxWidth, accounting for padding and hash prefix
 */
// truncateTag 在标签超宽时截短，但要先扣除「# 前缀 + 留白」的预算，再交给 `truncateToWidth` 处理。
function truncateTag(tag: string, maxWidth: number): string {
  // Available space for the tag text itself: maxWidth - " #" - " "
  const availableForTag = maxWidth - TAB_PADDING - HASH_PREFIX_LENGTH;
  if (stringWidth(tag) <= availableForTag) {
    return tag;
  }
  if (availableForTag <= 1) {
    return tag.charAt(0);
  }
  return truncateToWidth(tag, availableForTag);
}
// TagTabs 主体：先算出版面预算（resume 标签、最差右提示、两处间隔），再决定实际展示哪些标签。
export function TagTabs({
  tabs,
  selectedIndex,
  availableWidth,
  showAllProjects = false
}: Props): React.ReactNode {
  const resumeLabel = showAllProjects ? 'Resume (All Projects)' : 'Resume';
  const resumeLabelWidth = resumeLabel.length + 1; // +1 for gap

  // Calculate how much space we have for tabs (use worst-case hint width)
  const rightHintWidth = Math.max(RIGHT_HINT_WIDTH_WITH_COUNT, RIGHT_HINT_WIDTH_NO_COUNT);
  const maxTabsWidth = availableWidth - resumeLabelWidth - rightHintWidth - 2; // 2 for gaps

  // Clamp selectedIndex to valid range
// safeSelectedIndex 把选中下标夹在合法区间，防止外部传入越界值导致下面取窗口出错。
  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, tabs.length - 1));

  // Calculate width of each tab, with truncation for very long tags
// 单个标签最多占一半可用宽度，保证至少能同时看到两个标签。
  const maxSingleTabWidth = Math.max(20, Math.floor(maxTabsWidth / 2)); // At least show half the space for one tab
  const tabWidths = tabs.map(tab => getTabWidth(tab, maxSingleTabWidth));

  // Find a window of tabs that fits, centered around selectedIndex
  let startIndex = 0;
  let endIndex = tabs.length;

  // Calculate total width of all tabs
// 用 reduce 累加所有标签宽度（标签之间再 +1 作为间隔），判断是否放得下全部。
  const totalTabsWidth = tabWidths.reduce((sum, w, i) => sum + w + (i < tabWidths.length - 1 ? 1 : 0), 0); // +1 for gaps between tabs

// 放不下时，从选中标签出发向两侧扩张窗口，直到塞满有效宽度上限（还要扣掉左侧箭头占的位置）。
  if (totalTabsWidth > maxTabsWidth) {
    // Need to show a subset - account for left arrow when not at start
    const effectiveMaxWidth = maxTabsWidth - LEFT_ARROW_WIDTH;

    // Start with the selected tab
    let windowWidth = tabWidths[safeSelectedIndex] ?? 0;
    startIndex = safeSelectedIndex;
    endIndex = safeSelectedIndex + 1;

    // Expand window to include more tabs
    while (startIndex > 0 || endIndex < tabs.length) {
      const canExpandLeft = startIndex > 0;
      const canExpandRight = endIndex < tabs.length;
      if (canExpandLeft) {
        const leftWidth = (tabWidths[startIndex - 1] ?? 0) + 1; // +1 for gap
        if (windowWidth + leftWidth <= effectiveMaxWidth) {
          startIndex--;
          windowWidth += leftWidth;
          continue;
        }
      }
      if (canExpandRight) {
        const rightWidth = (tabWidths[endIndex] ?? 0) + 1; // +1 for gap
        if (windowWidth + rightWidth <= effectiveMaxWidth) {
          endIndex++;
          windowWidth += rightWidth;
          continue;
        }
      }
      break;
    }
  }
// 算出左、右各隐藏了多少个标签，以及当前可见的窗口切片。
  const hiddenLeft = startIndex;
  const hiddenRight = tabs.length - endIndex;
  const visibleTabs = tabs.slice(startIndex, endIndex);
  const visibleIndices = visibleTabs.map((_, i_0) => startIndex + i_0);
// 渲染：左侧 resume 标签 + 左溢出箭头 + 可见标签 + 右溢出提示，全部排进一个横向 `Box`。
  return <Box flexDirection="row" gap={1}>
      <Text color="suggestion">{resumeLabel}</Text>
      {hiddenLeft > 0 && <Text dimColor>
          {LEFT_ARROW_PREFIX}
          {hiddenLeft}
        </Text>}
      {visibleTabs.map((tab_0, i_1) => {
      const actualIndex = visibleIndices[i_1]!;
      const isSelected = actualIndex === safeSelectedIndex;
      const displayText = tab_0 === ALL_TAB_LABEL ? tab_0 : `#${truncateTag(tab_0, maxSingleTabWidth - TAB_PADDING)}`;
      return <Text key={tab_0} backgroundColor={isSelected ? 'suggestion' : undefined} color={isSelected ? 'inverseText' : undefined} bold={isSelected}>
            {' '}
            {displayText}{' '}
          </Text>;
    })}
      {hiddenRight > 0 ? <Text dimColor>
          {RIGHT_HINT_WITH_COUNT_PREFIX}
          {hiddenRight}
          {RIGHT_HINT_SUFFIX}
        </Text> : <Text dimColor>{RIGHT_HINT_NO_COUNT}</Text>}
    </Box>;
}
// 原文件此处有一行 15388 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。