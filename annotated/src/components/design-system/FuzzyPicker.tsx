// 模糊搜索选择器（fuzzy picker）。@ 提及、斜杠命令、历史检索、文件跳转等等全都复用它：调用方负责**过滤**（每次输入变化回调 `onQueryChange`，把新列表传回来），组件只负责渲染、导航、按键。这种「过滤权在上层」的分工是刻意的——不同场景的匹配算法差别极大（路径前缀、模糊、frecency），组件不该背这个锅。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { clamp } from '../../ink/layout/geometry.js';
import { Box, Text, useTerminalFocus } from '../../ink.js';
import { SearchBox } from '../SearchBox.js';
import { Byline } from './Byline.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { ListItem } from './ListItem.js';
import { Pane } from './Pane.js';
// `PickerAction` 是「一个带提示文案的动作」：`action` 只用于帮助行（例如 mention → Tab to mention），`handler` 才是真正的回调。把两者绑在一起传，避免调用方分别传标签与回调导致两边对不上。
type PickerAction<T> = {
  /** Hint label shown in the byline, e.g. "mention" → "Tab to mention". */
  action: string;
  handler: (item: T) => void;
};
// Props 里有三个「形态开关」：previewPosition（预览在右还是在下）、direction（列表往上长还是往下长）、visibleCount。它们不是样式选项，而是**宿主不同**导致的：命令面板希望预览在右（稳定不跳），历史检索希望列表往上长（像 atuin），@ 提及希望预览在下。
type Props<T> = {
  title: string;
  placeholder?: string;
  initialQuery?: string;
  items: readonly T[];
  getKey: (item: T) => string;
// 注释点明 previewPosition 为 right 的代价与收益：收益是帮助行位置稳定（不会因为预览出现/消失而上下弹），代价是需要足够宽度。所以它有默认值 bottom——窄场景默认不占横向空间。
  /** Keep to one line — preview handles overflow. */
  renderItem: (item: T, isFocused: boolean) => React.ReactNode;
  renderPreview?: (item: T) => React.ReactNode;
  /** 'right' keeps hints stable (no bounce), but needs width. */
  previewPosition?: 'bottom' | 'right';
  visibleCount?: number;
  /**
   * 'up' puts items[0] at the bottom next to the input (atuin-style). Arrows
   * always match screen direction — ↑ walks visually up regardless.
   */
  direction?: 'down' | 'up';
  /** Caller owns filtering: re-filter on each call and pass new items. */
  onQueryChange: (query: string) => void;
  /** Enter key. Primary action. */
  onSelect: (item: T) => void;
  /**
   * Tab key. If provided, Tab no longer aliases Enter — it gets its own
   * handler and hint. Shift+Tab falls through to this if onShiftTab is unset.
   */
  onTab?: PickerAction<T>;
  /** Shift+Tab key. Gets its own hint. */
  onShiftTab?: PickerAction<T>;
  /**
   * Fires when the focused item changes (via arrows or when items reset).
   * Useful for async preview loading — keeps I/O out of renderPreview.
   */
  onFocus?: (item: T | undefined) => void;
  onCancel: () => void;
  /** Shown when items is empty. Caller bakes loading/searching state into this. */
  emptyMessage?: string | ((query: string) => string);
  /**
   * Status line below the list, e.g. "500+ matches" or "42 matches…".
   * Caller decides when to show it — pass undefined to hide.
   */
  matchLabel?: string;
  selectAction?: string;
  extraHints?: React.ReactNode;
};
// `DEFAULT_VISIBLE = 8` 是「一次能看几项」。这个数不是随便定的：终端常规高度 24 行，减去下面会讲的 CHROME_ROWS（10）再加提示行，8 项正好让界面整体不进滚动。
const DEFAULT_VISIBLE = 8;
// Pane (paddingTop + Divider) + title + 3 gaps + SearchBox (rounded border = 3
// rows) + hints. matchLabel adds +1 when present, accounted for separately.
// `CHROME_ROWS = 10` 是手算的固定开销明细（Pane 上边距 + 分隔线 + 标题 + 3 个间隙 + 搜索框圆角边框 3 行 + 帮助行）。终端布局没有自动测量，这类常量必须把每一项写进注释，否则以后改一个 margin 就会在某种高度下溢出。
const CHROME_ROWS = 10;
const MIN_VISIBLE = 2;
export function FuzzyPicker<T>({
  title,
  placeholder = 'Type to search…',
  initialQuery,
  items,
  getKey,
  renderItem,
  renderPreview,
  previewPosition = 'bottom',
  visibleCount: requestedVisible = DEFAULT_VISIBLE,
  direction = 'down',
  onQueryChange,
  onSelect,
  onTab,
  onShiftTab,
  onFocus,
  onCancel,
  emptyMessage = 'No results',
  matchLabel,
  selectAction = 'select',
  extraHints
}: Props<T>): React.ReactNode {
  const isTerminalFocused = useTerminalFocus();
  const {
    rows,
    columns
  } = useTerminalSize();
// 焦点索引是组件唯一的状态。注意它**不存选中值**——选中即回调、随即关闭，没有「已选但未确认」这回事。这也是 picker 与权限弹窗的本质区别：picker 是即选即走，弹窗要等用户明确确认。
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Cap visibleCount so the picker never exceeds the terminal height. When it
  // overflows, each re-render (arrow key, ctrl+p) mis-positions the cursor-up
  // by the overflow amount and a previously-drawn line flashes blank.
// `visibleCount` 被钳在 `[MIN_VISIBLE, rows - CHROME_ROWS]` 之间。注释解释了不钳的后果：界面高度一旦超过终端，每次重渲染（按一次方向键）时光标上移的行数就会算错，于是**上一次画的那一行会闪成空白**。这是终端 UI 特有的坑——DOM 里溢出只是滚动，终端里溢出是重绘错位。
  const visibleCount = Math.max(MIN_VISIBLE, Math.min(requestedVisible, rows - CHROME_ROWS - (matchLabel ? 1 : 0)));

  // Full hint row with onTab+onShiftTab is ~100 chars and wraps inconsistently
  // below that. Compact mode drops shift+tab and shortens labels.
// `compact = columns < 120`。作用只有一个：帮助行太长会折行，折行后左对齐看起来像两行错位的文字。所以窄终端下砍掉 shift+tab 提示、把动作词缩成一个单词（navigate → nav）。
  const compact = columns < 120;
  const step = (delta: 1 | -1) => {
    setFocusedIndex(i => clamp(i + delta, 0, items.length - 1));
  };

  // onKeyDown fires after useSearchInput's useInput, so onExit must be a
  // no-op — return/downArrow are handled by handleKeyDown below. onCancel
  // still covers escape/ctrl+c/ctrl+d. Backspace-on-empty is disabled so
  // a held backspace doesn't eject the user from the dialog.
// `onExit: () => {}` 是这里最容易看错的一处：useSearchInput 内部把回车与下方向键当作「退出输入」处理，而本组件要在自己的 onKeyDown 里接管这两个键。所以传一个空函数把它的退出行为废掉，同时保留 onCancel（Esc / ctrl+c / ctrl+d 仍然要走取消）。
  const {
    query,
    cursorOffset
  } = useSearchInput({
    isActive: true,
    onExit: () => {},
    onCancel,
    initialQuery,
// `backspaceExitsOnEmpty: false` 同样是防误触：默认行为是「空输入时按退格就退出对话框」，但用户按住退格清空搜索词时手指还没抬，紧接着的那一下就会把整个面板关掉。
    backspaceExitsOnEmpty: false
  });
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'up' || e.ctrl && e.key === 'p') {
      e.preventDefault();
      e.stopImmediatePropagation();
      step(direction === 'up' ? 1 : -1);
      return;
    }
    if (e.key === 'down' || e.ctrl && e.key === 'n') {
      e.preventDefault();
      e.stopImmediatePropagation();
      step(direction === 'up' ? -1 : 1);
      return;
    }
    if (e.key === 'return') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const selected = items[focusedIndex];
      if (selected) onSelect(selected);
      return;
    }
// Tab 的语义是**双动作**：给了 onTab 就变成独立动作（并在帮助行显示提示），没给就退化成回车（等价于选中）。Shift+Tab 同理，且优先用 onShiftTab，没配则回落到 onTab。这让同一个组件既能当「选择器」用、也能当「选择器 + 提及」用。
    if (e.key === 'tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const selected = items[focusedIndex];
      if (!selected) return;
      const tabAction = e.shift ? onShiftTab ?? onTab : onTab;
      if (tabAction) {
        tabAction.handler(selected);
      } else {
        onSelect(selected);
      }
    }
  };
// 查询变化时把焦点重置到第 0 项，并且**每次都调 onQueryChange**（包括首次挂载），这样上层不必自己初始化一次列表。依赖数组只写 query 是故意的——onQueryChange 每次渲染都是新引用，写进去会变成「每次渲染都重新过滤」。
  useEffect(() => {
    onQueryChange(query);
    setFocusedIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    setFocusedIndex(i => clamp(i, 0, items.length - 1));
  }, [items.length]);
  const focused = items[focusedIndex];
  useEffect(() => {
    onFocus?.(focused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
// 用 `clamp(focusedIndex - visibleCount + 1, 0, items.length - visibleCount)` 算窗口起点：光标永远落在**窗口底部**（除非已经到顶）。这跟常见列表相反——常规做法是把光标放中间保持上下文。这里选择贴底，是因为搜索场景下用户从最新/最相关的一项开始往下看，贴底能让「已看过的」留在上方视野里。
  const windowStart = clamp(focusedIndex - visibleCount + 1, 0, items.length - visibleCount);
  const visible = items.slice(windowStart, windowStart + visibleCount);
  const emptyText = typeof emptyMessage === 'function' ? emptyMessage(query) : emptyMessage;
  const searchBox = <SearchBox query={query} cursorOffset={cursorOffset} placeholder={placeholder} isFocused isTerminalFocused={isTerminalFocused} />;
  const listBlock = <List visible={visible} windowStart={windowStart} visibleCount={visibleCount} total={items.length} focusedIndex={focusedIndex} direction={direction} getKey={getKey} renderItem={renderItem} emptyText={emptyText} />;
  const preview = renderPreview && focused ? <Box flexDirection="column" flexGrow={1}>
        {renderPreview(focused)}
      </Box> : null;

  // Structure must not depend on preview truthiness — when focused goes
  // undefined (e.g. delete clears matches), switching row→fragment would
  // change both layout AND gap count, bouncing the searchBox below.
// `listGroup` 这一段上方那段注释是全文件最值得记的一条设计约束：**结构不能依赖 preview 是否存在**。如果按「有预览就渲染 row、没预览就渲染 fragment」来写，那么当 focused 变成 undefined（比如删字删到没有匹配）时，布局从 row 退回 fragment、gap 数量也跟着变，搜索框会突然往下弹一下。所以这里恒用 Box，没有预览时用一个空的 `flexGrow={1}` 占位。
  const listGroup = renderPreview && previewPosition === 'right' ? <Box flexDirection="row" gap={2} height={visibleCount + (matchLabel ? 1 : 0)}>
        <Box flexDirection="column" flexShrink={0}>
          {listBlock}
          {matchLabel && <Text dimColor>{matchLabel}</Text>}
        </Box>
        {preview ?? <Box flexGrow={1} />}
      </Box> :
  // Box (not fragment) so the outer gap={1} doesn't insert a blank line
  // between list/matchLabel/preview — that read as extra space above the
  // prompt in direction='up'.
  <Box flexDirection="column">
        {listBlock}
        {matchLabel && <Text dimColor>{matchLabel}</Text>}
        {preview}
      </Box>;
// `inputAbove = direction !== 'up'`：搜索框在列表上方还是下方，只由 direction 决定。往下长时光标在下方、输入框在上方；往上长时（atuin 风格）输入框在底部、列表往上堆。
  const inputAbove = direction !== 'up';
  return <Pane color="permission">
      <Box flexDirection="column" gap={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
        <Text bold color="permission">
          {title}
        </Text>
        {inputAbove && searchBox}
        {listGroup}
        {!inputAbove && searchBox}
        <Text dimColor>
          <Byline>
// 帮助行按 compact 切换文案：窄屏下 ↑/↓ 的说明从 navigate 缩成 nav，回车动作只取第一个单词（例如 select file → select）。`firstWord` 就是为这一处准备的小工具。
            <KeyboardShortcutHint shortcut="↑/↓" action={compact ? 'nav' : 'navigate'} />
            <KeyboardShortcutHint shortcut="Enter" action={compact ? firstWord(selectAction) : selectAction} />
            {onTab && <KeyboardShortcutHint shortcut="Tab" action={onTab.action} />}
            {onShiftTab && !compact && <KeyboardShortcutHint shortcut="shift+tab" action={onShiftTab.action} />}
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            {extraHints}
          </Byline>
        </Text>
      </Box>
    </Pane>;
}
type ListProps<T> = Pick<Props<T>, 'visibleCount' | 'direction' | 'getKey' | 'renderItem'> & {
  visible: readonly T[];
  windowStart: number;
  total: number;
  focusedIndex: number;
  emptyText: string;
};
function List(t0) {
  const $ = _c(27);
  const {
    visible,
    windowStart,
    visibleCount,
    total,
    focusedIndex,
    direction,
    getKey,
    renderItem,
    emptyText
  } = t0;
// 空列表分支仍然渲染 `height={visibleCount}` 的空盒。这就是「空态不塌陷」：如果没有这个固定高度，无结果时整个面板会缩成两行、搜索框跟着往上跳，用户会以为自己误触了什么。
  if (visible.length === 0) {
    let t1;
    if ($[0] !== emptyText) {
      t1 = <Text dimColor={true}>{emptyText}</Text>;
      $[0] = emptyText;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[2] !== t1 || $[3] !== visibleCount) {
      t2 = <Box height={visibleCount} flexShrink={0}>{t1}</Box>;
      $[2] = t1;
      $[3] = visibleCount;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  let t1;
  if ($[5] !== direction || $[6] !== focusedIndex || $[7] !== getKey || $[8] !== renderItem || $[9] !== total || $[10] !== visible || $[11] !== visibleCount || $[12] !== windowStart) {
    let t2;
    if ($[14] !== direction || $[15] !== focusedIndex || $[16] !== getKey || $[17] !== renderItem || $[18] !== total || $[19] !== visible.length || $[20] !== visibleCount || $[21] !== windowStart) {
      t2 = (item, i) => {
        const actualIndex = windowStart + i;
        const isFocused = actualIndex === focusedIndex;
        const atLowEdge = i === 0 && windowStart > 0;
        const atHighEdge = i === visible.length - 1 && windowStart + visibleCount < total;
// `showScrollUp` / `showScrollDown` 的取值随 direction **翻转**：往上长时，索引 0 在屏幕底部，所以「上方还有更多」对应的是窗口末尾那一项。这一段三目链是两个布尔同时决定，读的时候先把 direction 当成坐标翻转开关。
        return <ListItem key={getKey(item)} isFocused={isFocused} showScrollUp={direction === "up" ? atHighEdge : atLowEdge} showScrollDown={direction === "up" ? atLowEdge : atHighEdge} styled={false}>{renderItem(item, isFocused)}</ListItem>;
      };
      $[14] = direction;
      $[15] = focusedIndex;
      $[16] = getKey;
      $[17] = renderItem;
      $[18] = total;
      $[19] = visible.length;
      $[20] = visibleCount;
      $[21] = windowStart;
      $[22] = t2;
    } else {
      t2 = $[22];
    }
    t1 = visible.map(t2);
    $[5] = direction;
    $[6] = focusedIndex;
    $[7] = getKey;
    $[8] = renderItem;
    $[9] = total;
    $[10] = visible;
    $[11] = visibleCount;
    $[12] = windowStart;
    $[13] = t1;
  } else {
    t1 = $[13];
  }
  const rows = t1;
// 往上长时用 `flexDirection=「column-reverse」` 而不是把数组 reverse 一遍。渲染顺序反转会让 key 与索引错位、动画与焦点高亮全部跟着翻；布局方向反转只是视觉翻转，索引语义保持不变。箭头键也在 handleKeyDown 里按 direction 反向映射，所以「↑ 永远是视觉上往上」这条约束不需要调用方操心。
  const t2 = direction === "up" ? "column-reverse" : "column";
  let t3;
  if ($[23] !== rows || $[24] !== t2 || $[25] !== visibleCount) {
    t3 = <Box height={visibleCount} flexShrink={0} flexDirection={t2}>{rows}</Box>;
    $[23] = rows;
    $[24] = t2;
    $[25] = visibleCount;
    $[26] = t3;
  } else {
    t3 = $[26];
  }
  return t3;
}
function firstWord(s: string): string {
  const i = s.indexOf(' ');
  return i === -1 ? s : s.slice(0, i);
}
// 原文件此处有一行 29704 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。