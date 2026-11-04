import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useTerminalViewport } from '../../ink/hooks/use-terminal-viewport.js';
import { Box, type DOMElement, measureElement } from '../../ink.js';
type Props = {
  children: React.ReactNode;
  lock?: 'always' | 'offscreen';
};
// Ratchet：只增不减的高度棘轮——内容长到多高就锁住多高，避免流式输出时整屏布局抖动
export function Ratchet(t0) {
  const $ = _c(10);
  const {
    children,
    lock: t1
  } = t0;
  const lock = t1 === undefined ? "always" : t1;
// lock 默认 always；offscreen 表示只在滚出视口时才锁
  const [viewportRef, t2] = useTerminalViewport();
// useTerminalViewport 同时给出 ref 与 isVisible
  const {
    isVisible
  } = t2;
  const {
    rows
  } = useTerminalSize();
  const innerRef = useRef(null);
// innerRef 用来量内容真实高度；maxHeight 用 ref 存历史最大值（不触发渲染）
  const maxHeight = useRef(0);
  const [minHeight, setMinHeight] = useState(0);
  let t3;
  if ($[0] !== viewportRef) {
    t3 = el => {
// outerRef 把 viewport 的 ref 回调包一层：编译器对 useCallback 的缓存展开
      viewportRef(el);
    };
    $[0] = viewportRef;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  const outerRef = t3;
  const engaged = lock === "always" || !isVisible;
// engaged：always 恒真；offscreen 时只在内容不可见时生效
  let t4;
  if ($[2] !== rows) {
    t4 = () => {
      if (!innerRef.current) {
        return;
      }
      const {
        height
      } = measureElement(innerRef.current);
// measureElement 量真实高度，只有比历史最大值更大才更新状态
      if (height > maxHeight.current) {
        maxHeight.current = Math.min(height, rows);
// Math.min(height, rows)：棘轮上限不超过一屏，防止内容把终端顶穿
        setMinHeight(maxHeight.current);
      }
    };
    $[2] = rows;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  useLayoutEffect(t4);
  const t5 = engaged ? minHeight : undefined;
// minHeight 只在 engaged 时生效，否则给 undefined 让高度自然塌缩
  let t6;
  if ($[4] !== children) {
    t6 = <Box ref={innerRef} flexDirection="column">{children}</Box>;
    $[4] = children;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
  if ($[6] !== outerRef || $[7] !== t5 || $[8] !== t6) {
    t7 = <Box minHeight={t5} ref={outerRef}>{t6}</Box>;
// 外层 Box 用 minHeight 撑住，内层 Box 承载真实内容——撑高的是外壳，内容照旧
    $[6] = outerRef;
    $[7] = t5;
    $[8] = t6;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  return t7;
}
// 原文件此处有一行 5260 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。