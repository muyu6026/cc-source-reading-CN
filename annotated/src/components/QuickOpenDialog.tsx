// 快速打开对话框（ctrl+shift+p）：模糊搜文件 + 语法高亮预览，基于通用 FuzzyPicker 组件组装。
import { c as _c } from "react/compiler-runtime";
import * as path from 'path';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRegisterOverlay } from '../context/overlayContext.js';
import { generateFileSuggestions } from '../hooks/fileSuggestions.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Text } from '../ink.js';
import { logEvent } from '../services/analytics/index.js';
import { getCwd } from '../utils/cwd.js';
import { openFileInExternalEditor } from '../utils/editor.js';
import { truncatePathMiddle, truncateToWidth } from '../utils/format.js';
import { highlightMatch } from '../utils/highlightMatch.js';
import { readFileInRange } from '../utils/readFileInRange.js';
import { FuzzyPicker } from './design-system/FuzzyPicker.js';
import { LoadingState } from './design-system/LoadingState.js';
type Props = {
  onDone: () => void;
  onInsert: (text: string) => void;
};
// 两个布局常量：候选列表可见行数 8、预览行数 20。可见行数还会随终端高度再收缩。
const VISIBLE_RESULTS = 8;
const PREVIEW_LINES = 20;

/**
 * Quick Open dialog (ctrl+shift+p / cmd+shift+p).
 * Fuzzy file finder with a syntax-highlighted preview of the focused file.
 */
// 组件有 35 个记忆槽位，是回调密集型组件：每个传给 FuzzyPicker 的回调都被编译器单独缓存，避免列表每次渲染都重建。
export function QuickOpenDialog(t0) {
  const $ = _c(35);
  const {
    onDone,
    onInsert
  } = t0;
// 注册为 overlay：让全局按键路由知道当前有对话框悬浮，避免底层输入框同时吃按键。
  useRegisterOverlay("quick-open");
  const {
    columns,
    rows
  } = useTerminalSize();
// 可见行数自适应：终端至少留 14 行给标题、输入框、预览等固定开销，但保底 4 行——矮终端下列表变短而不是消失。
  const visibleResults = Math.min(VISIBLE_RESULTS, Math.max(4, rows - 14));
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const [results, setResults] = useState(t1);
  const [query, setQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState(undefined);
  const [preview, setPreview] = useState(null);
// 查询代际号：每次输入变化自增，用来丢弃过期搜索的异步结果（竞态防护），卸载时也会自增一次让所有在途请求失效。
  const queryGenRef = useRef(0);
  let t2;
  let t3;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
// 卸载回调：把代际号再 +1。之后 resolve 的搜索结果会因代际不匹配被丢弃，不会 setState 到已卸载组件上。
    t2 = () => () => {
      queryGenRef.current = queryGenRef.current + 1;
      return void queryGenRef.current;
    };
    t3 = [];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
// 布局分档：终端宽 ≥120 列时预览放右侧、否则放下方。放右侧时预览行数也收窄为候选行数减一，两栏高度对齐。
  const previewOnRight = columns >= 120;
  const effectivePreviewLines = previewOnRight ? VISIBLE_RESULTS - 1 : PREVIEW_LINES;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
// 查询回调：先自增代际号再发搜索，then 里用闭包里的 gen 与当前代际比对——期间有新输入或组件卸载都直接丢弃结果。
    t4 = q => {
      setQuery(q);
      const gen = queryGenRef.current = queryGenRef.current + 1;
      if (!q.trim()) {
        setResults([]);
        return;
      }
      generateFileSuggestions(q, true).then(items => {
        if (gen !== queryGenRef.current) {
          return;
        }
// 结果整形链在文件底部 _temp 系列函数：只留 file- 开头的建议、取显示文本、滤掉目录、把路径分隔符统一成正斜杠。
        const paths = items.filter(_temp).map(_temp2).filter(_temp3).map(_temp4);
        setResults(paths);
      });
    };
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const handleQueryChange = t4;
  let t5;
  let t6;
  if ($[4] !== effectivePreviewLines || $[5] !== focusedPath) {
// 预览加载 effect：用 AbortController 取消上一次未完成的文件读取；文件读取失败也走同一 setState，只是内容换成占位文案。
    t5 = () => {
      if (!focusedPath) {
        setPreview(null);
        return;
      }
      const controller = new AbortController();
      const absolute = path.resolve(getCwd(), focusedPath);
      readFileInRange(absolute, 0, effectivePreviewLines, undefined, controller.signal).then(r => {
        if (controller.signal.aborted) {
          return;
        }
        setPreview({
          path: focusedPath,
          content: r.content
        });
// catch 分支同样先检查 aborted——取消既可能是新预览顶掉旧的，也可能是组件卸载，两种情况都不能再写状态。
      }).catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setPreview({
          path: focusedPath,
          content: "(preview unavailable)"
        });
      });
      return () => controller.abort();
    };
    t6 = [focusedPath, effectivePreviewLines];
    $[4] = effectivePreviewLines;
    $[5] = focusedPath;
    $[6] = t5;
    $[7] = t6;
  } else {
    t5 = $[6];
    t6 = $[7];
  }
  useEffect(t5, t6);
// 列宽手算：右侧布局时路径列拿 40% 宽度（至少 20 列），剩余给预览；下方布局时路径几乎独占整行。
  const maxPathWidth = previewOnRight ? Math.max(20, Math.floor((columns - 10) * 0.4)) : Math.max(20, columns - 8);
  const previewWidth = previewOnRight ? Math.max(40, columns - maxPathWidth - 14) : columns - 6;
  let t7;
  if ($[8] !== onDone || $[9] !== results.length) {
    t7 = p_1 => {
      const opened = openFileInExternalEditor(path.resolve(getCwd(), p_1));
      logEvent("tengu_quick_open_select", {
        result_count: results.length,
        opened_editor: opened
      });
      onDone();
    };
    $[8] = onDone;
    $[9] = results.length;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  const handleOpen = t7;
  let t8;
  if ($[11] !== onDone || $[12] !== onInsert || $[13] !== results.length) {
// 插入回调：mention 模式在路径前加 @（把文件引入对话上下文），普通模式只插入路径。两者都以空格结尾方便续写。
    t8 = (p_2, mention) => {
      onInsert(mention ? `@${p_2} ` : `${p_2} `);
      logEvent("tengu_quick_open_insert", {
        result_count: results.length,
        mention
      });
      onDone();
    };
    $[11] = onDone;
    $[12] = onInsert;
    $[13] = results.length;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  const handleInsert = t8;
  const t9 = previewOnRight ? "right" : "bottom";
  let t10;
  if ($[15] !== handleInsert) {
    t10 = {
      action: "mention",
      handler: p_4 => handleInsert(p_4, true)
    };
    $[15] = handleInsert;
    $[16] = t10;
  } else {
    t10 = $[16];
  }
  let t11;
  if ($[17] !== handleInsert) {
    t11 = {
      action: "insert path",
      handler: p_5 => handleInsert(p_5, false)
    };
    $[17] = handleInsert;
    $[18] = t11;
  } else {
    t11 = $[18];
  }
  let t12;
// 渲染行：聚焦时高亮，路径按 maxPathWidth 从中间截断（保留文件名两端，截掉中段目录）。
  if ($[19] !== maxPathWidth) {
    t12 = (p_6, isFocused) => <Text color={isFocused ? "suggestion" : undefined}>{truncatePathMiddle(p_6, maxPathWidth)}</Text>;
    $[19] = maxPathWidth;
    $[20] = t12;
  } else {
    t12 = $[20];
  }
  let t13;
  if ($[21] !== preview || $[22] !== previewWidth || $[23] !== query) {
// 预览渲染：标题若与聚焦路径不一致说明预览还是上一次的（加载中），追加「· loading…」提示；正文逐行截宽并高亮查询词。
    t13 = p_7 => preview ? <><Text dimColor={true}>{truncatePathMiddle(p_7, previewWidth)}{preview.path !== p_7 ? " \xB7 loading\u2026" : ""}</Text>{preview.content.split("\n").map((line, i_1) => <Text key={i_1}>{highlightMatch(truncateToWidth(line, previewWidth), query)}</Text>)}</> : <LoadingState message={"Loading preview\u2026"} dimColor={true} />;
    $[21] = preview;
    $[22] = previewWidth;
    $[23] = query;
    $[24] = t13;
  } else {
    t13 = $[24];
  }
  let t14;
  if ($[25] !== handleOpen || $[26] !== onDone || $[27] !== results || $[28] !== t10 || $[29] !== t11 || $[30] !== t12 || $[31] !== t13 || $[32] !== t9 || $[33] !== visibleResults) {
    t14 = <FuzzyPicker title="Quick Open" placeholder={"Type to search files\u2026"} items={results} getKey={_temp5} visibleCount={visibleResults} direction="up" previewPosition={t9} onQueryChange={handleQueryChange} onFocus={setFocusedPath} onSelect={handleOpen} onTab={t10} onShiftTab={t11} onCancel={onDone} emptyMessage={_temp6} selectAction="open in editor" renderItem={t12} renderPreview={t13} />;
    $[25] = handleOpen;
    $[26] = onDone;
    $[27] = results;
    $[28] = t10;
    $[29] = t11;
    $[30] = t12;
    $[31] = t13;
    $[32] = t9;
    $[33] = visibleResults;
    $[34] = t14;
  } else {
    t14 = $[34];
  }
  return t14;
}
// 空态文案按有无查询区分：有查询显示「无匹配文件」，无查询显示「输入以搜索」。
function _temp6(q_0) {
  return q_0 ? "No matching files" : "Start typing to search\u2026";
}
function _temp5(p_3) {
  return p_3;
}
// 以下 _temp 系列是编译器从 JSX 内联回调抽出的模块级函数，避免每次渲染重建闭包。
function _temp4(p_0) {
  return p_0.split(path.sep).join("/");
}
function _temp3(p) {
  return !p.endsWith(path.sep);
}
function _temp2(i_0) {
  return i_0.displayText;
}
function _temp(i) {
  return i.id.startsWith("file-");
}
// 原文件此处有一行 21228 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。