import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRegisterOverlay } from '../context/overlayContext.js';
import { getTimestampedHistory, type TimestampedHistoryEntry } from '../history.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { wrapAnsi } from '../ink/wrapAnsi.js';
import { Box, Text } from '../ink.js';
import { logEvent } from '../services/analytics/index.js';
import type { HistoryEntry } from '../utils/config.js';
import { formatRelativeTimeAgo, truncateToWidth } from '../utils/format.js';
import { FuzzyPicker } from './design-system/FuzzyPicker.js';
type Props = {
  initialQuery?: string;
  onSelect: (entry: HistoryEntry) => void;
  onCancel: () => void;
};
// 预览区固定 6 行、年龄列定宽 8——两个常量先定死版面，列表行宽与预览宽度都从它们反推。
const PREVIEW_ROWS = 6;
const AGE_WIDTH = 8;
// Item 结构在加载时一次性算好四个展示字段：原文 display、预降序的 lower、首行 firstLine、右补空格到定宽的 age。查询是高频操作，把 toLowerCase 提前到加载期做一次。
type Item = {
  entry: TimestampedHistoryEntry;
  display: string;
  lower: string;
  firstLine: string;
  age: string;
};
export function HistorySearchDialog({
  initialQuery,
  onSelect,
  onCancel
}: Props): React.ReactNode {
// 注册覆盖层：历史搜索弹窗打开期间接管全局键位（如 ctrl+r），关闭时自动注销。
  useRegisterOverlay('history-search');
  const {
    columns
  } = useTerminalSize();
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState(initialQuery ?? '');
// 挂载异步加载：for await 流式读取历史迭代器，边读边装 Item。cancelled 标志配合清理函数——卸载时不只停止 setState，还调用 reader.return 提前终结迭代器，让底层文件句柄及时释放。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reader = getTimestampedHistory();
      const loaded: Item[] = [];
      for await (const entry of reader) {
        if (cancelled) {
          void reader.return(undefined);
          return;
        }
        const display = entry.display;
        const nl = display.indexOf('\n');
// 相对时间格式化后按 stringWidth（显示宽而非字符数）补空格到 8 列——CJK 时间词宽度不同，按字符数补会错位。
        const age = formatRelativeTimeAgo(new Date(entry.timestamp));
        loaded.push({
          entry,
          display,
          lower: display.toLowerCase(),
          firstLine: nl === -1 ? display : display.slice(0, nl),
          age: age + ' '.repeat(Math.max(0, AGE_WIDTH - stringWidth(age)))
        });
      }
      if (!cancelled) setItems(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
// 过滤 useMemo：空查询直接返回全量；否则分两桶——精确子串命中进 exact，未命中再测子序列进 fuzzy，exact.concat(fuzzy) 保证精确匹配永远排在模糊匹配前面。
  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const exact: Item[] = [];
    const fuzzy: Item[] = [];
    for (const item of items) {
      if (item.lower.includes(q)) {
        exact.push(item);
      } else if (isSubsequence(item.lower, q)) {
        fuzzy.push(item);
      }
    }
    return exact.concat(fuzzy);
  }, [items, query]);
// 布局三算：终端够 100 列才开右侧预览分栏；列表取一半宽，行宽再减年龄列；预览宽度保底 20。全部在渲染前算成数字传给 FuzzyPicker。
  const previewOnRight = columns >= 100;
  const listWidth = previewOnRight ? Math.floor((columns - 6) * 0.5) : columns - 6;
  const rowWidth = Math.max(20, listWidth - AGE_WIDTH - 1);
  const previewWidth = previewOnRight ? Math.max(20, columns - listWidth - 12) : Math.max(20, columns - 10);
// FuzzyPicker direction 为 up：历史搜索从输入行向上展开，与 ctrl+r 的方向语义一致。
  return <FuzzyPicker title="Search prompts" placeholder="Filter history…" initialQuery={initialQuery} items={filtered} getKey={item_0 => String(item_0.entry.timestamp)} onQueryChange={setQuery} onSelect={item_1 => {
    logEvent('tengu_history_picker_select', {
      result_count: filtered.length,
      query_length: query.length
    });
// 选中时先打点（结果数与查询长度，供搜索质量分析），再调 entry.resolve()——历史条目是惰性封装，选中此刻才把显示文本解析成完整 HistoryEntry 交给上层。
    void item_1.entry.resolve().then(onSelect);
// 空态文案三态：items 还在加载显示 Loading、有查询无结果显示无匹配、无历史显示空。用一个函数按状态切换而不是三个分支组件。
  }} onCancel={onCancel} emptyMessage={q_0 => items === null ? 'Loading…' : q_0 ? 'No matching prompts' : 'No history yet'} selectAction="use" direction="up" previewPosition={previewOnRight ? 'right' : 'bottom'} renderItem={(item_2, isFocused) => <Text>
          <Text dimColor>{item_2.age}</Text>
          <Text color={isFocused ? 'suggestion' : undefined}>
            {' '}
            {truncateToWidth(item_2.firstLine, rowWidth)}
          </Text>
// 预览渲染：wrapAnsi 硬折行后滤掉空行；超过 6 行就少显一行、把名额让给 plusN more lines 提示——预览宁缺一行也要让「还有更多」可见。容器高度固定 PREVIEW_ROWS 加 2（上下边框），抖动为零。
        </Text>} renderPreview={item_3 => {
    const wrapped = wrapAnsi(item_3.display, previewWidth, {
      hard: true
    }).split('\n').filter(l => l.trim() !== '');
    const overflow = wrapped.length > PREVIEW_ROWS;
    const shown = wrapped.slice(0, overflow ? PREVIEW_ROWS - 1 : PREVIEW_ROWS);
    const more = wrapped.length - shown.length;
    return <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={PREVIEW_ROWS + 2}>
            {shown.map((row, i) => <Text key={i} dimColor>
                {row}
              </Text>)}
            {more > 0 && <Text dimColor>{`… +${more} more lines`}</Text>}
          </Box>;
  }} />;
}
// isSubsequence 双指针：query 的字符按序能否都在 text 里找到。O(n) 且无回溯，模糊匹配只判「字符都在、顺序对」，不评分数——排序交给 exact 优先再加原有顺序。
function isSubsequence(text: string, query: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < query.length; i++) {
    if (text[i] === query[j]) j++;
  }
  return j === query.length;
}
// 原文件此处有一行 15384 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。