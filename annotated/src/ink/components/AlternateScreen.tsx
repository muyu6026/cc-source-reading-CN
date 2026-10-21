import { c as _c } from "react/compiler-runtime";
import React, { type PropsWithChildren, useContext, useInsertionEffect } from 'react';
import instances from '../instances.js';
import { DISABLE_MOUSE_TRACKING, ENABLE_MOUSE_TRACKING, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN } from '../termio/dec.js';
import { TerminalWriteContext } from '../useTerminalNotification.js';
import Box from './Box.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';
type Props = PropsWithChildren<{
  /** Enable SGR mouse tracking (wheel + click/drag). Default true. */
  mouseTracking?: boolean;
}>;

/**
 * Run children in the terminal's alternate screen buffer, constrained to
 * the viewport height. While mounted:
 *
 * - Enters the alt screen (DEC 1049), clears it, homes the cursor
 * - Constrains its own height to the terminal row count, so overflow must
 *   be handled via `overflow: scroll` / flexbox (no native scrollback)
 * - Optionally enables SGR mouse tracking (wheel + click/drag) — events
 *   surface as `ParsedKey` (wheel) and update the Ink instance's
 *   selection state (click/drag)
 *
 * On unmount, disables mouse tracking and exits the alt screen, restoring
 * the main screen's content. Safe for use in ctrl-o transcript overlays
 * and similar temporary fullscreen views — the main screen is preserved.
 *
 * Notifies the Ink instance via `setAltScreenActive()` so the renderer
 * keeps the cursor inside the viewport (preventing the cursor-restore LF
 * from scrolling content) and so signal-exit cleanup can exit the alt
 * screen if the component's own unmount doesn't run.
 */
// 这个组件的核心不是「进全屏」，而是**进出必须成对、且顺序固定**。
//
// 进：ENTER_ALT_SCREEN + 清屏 + 光标归位 + （可选）鼠标追踪
// 出：关鼠标追踪 + EXIT_ALT_SCREEN
//
// 顺序为什么不能换：如果先退全屏再关鼠标追踪，那一小段时间里鼠标
// 事件仍然会发，但屏幕已经是主屏了 —— 坐标对不上，可能出现
// 「退出全屏的瞬间触发了主屏上某个点击」。
//
// 另外注意 `ink?.setAltScreenActive(...)`：这个组件不只是写序列，
// 它还要**告诉渲染器**现在是全屏。渲染器的行为差别很大 ——
// 全屏时光标要留在视口内（否则帧末的光标归位会触发滚动），
// 而且清理路径也不同（signal-exit 也要能退出全屏）。
export function AlternateScreen(t0) {
  const $ = _c(7);
  const {
    children,
    mouseTracking: t1
  } = t0;
  const mouseTracking = t1 === undefined ? true : t1;
  const size = useContext(TerminalSizeContext);
  const writeRaw = useContext(TerminalWriteContext);
  let t2;
  let t3;
  if ($[0] !== mouseTracking || $[1] !== writeRaw) {
    t2 = () => {
      const ink = instances.get(process.stdout);
      if (!writeRaw) {
        return;
      }
      writeRaw(ENTER_ALT_SCREEN + "\x1B[2J\x1B[H" + (mouseTracking ? ENABLE_MOUSE_TRACKING : ""));
// 进场序列是三段拼起来的，中间的 `"\u001B[2J\u001B[H"` 是清屏 + 归位。
//
// 为什么必须清屏：alt screen 的内容是上一个程序留下的（通常是 shell），
// 不清的话第一帧渲染前会闪一下旧内容。
//
// 为什么必须归位：进入 alt screen 后光标位置是未定义的（不同终端
// 不同），不归位的话第一帧可能从屏幕中间开始画。
      ink?.setAltScreenActive(true, mouseTracking);
      return () => {
        ink?.setAltScreenActive(false);
        ink?.clearTextSelection();
        writeRaw((mouseTracking ? DISABLE_MOUSE_TRACKING : "") + EXIT_ALT_SCREEN);
// 【cleanup 的三步顺序】
//
//   1. setAltScreenActive(false)  先让渲染器知道「不再全屏」
//   2. clearTextSelection()       清掉选区（否则退出后还可能触发复制）
//   3. 写关鼠标 + 退全屏
//
// 第 1 步和第 3 步的顺序是关键：如果先写 EXIT_ALT_SCREEN，渲染器在
// 那之后、setAltScreenActive(false) 之前若正好渲染一帧，它会按
// 「全屏模式」的规则把光标限制在视口内 —— 而视口已经不存在了。
//
// 反过来（先告诉渲染器）是安全的：最坏情况是渲染器按主屏规则多画
// 一帧到 alt screen 上，而那个屏幕马上就要被丢弃。
      };
    };
    t3 = [writeRaw, mouseTracking];
    $[0] = mouseTracking;
    $[1] = writeRaw;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  useInsertionEffect(t2, t3);
// ⚠️ `useInsertionEffect`，不是 `useLayoutEffect`。
//
// 三个 effect 的时序：render → **insertion**（mutation 阶段）
// → layout（DOM 已更新）→ passive（useEffect）。
//
// 选 insertion 的理由：全屏切换必须在**任何布局测量之前**发生。
// 用 layout 的话，同一棵树里其他组件的 layout effect 可能先跑
// （React 按子→父的顺序跑 layout effect，但兄弟之间按挂载顺序），
// 那时 rows 还是旧值、alt screen 还没进 —— 于是第一帧按主屏高度算，
// 渲染完再跳一次。
//
// 代价（insertion effect 的限制）：不能在里面读布局、不能 setState。
// 这里两件事都没做，只写序列和调 setAltScreenActive，正好合适。
  const t4 = size?.rows ?? 24;
// `?? 24` 是硬兜底：TerminalSizeContext 的默认值是 null（见
// TerminalSizeContext.tsx），而全屏必须有一个确定高度 ——
// 拿不到真实行数时宁可假设 24 行（VT100 的经典尺寸），也不要
// 让 height 变成 undefined（yoga 会当成 auto，于是全屏失效）。
  let t5;
  if ($[4] !== children || $[5] !== t4) {
    t5 = <Box flexDirection="column" height={t4} width="100%" flexShrink={0}>{children}</Box>;
    $[4] = children;
    $[5] = t4;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  return t5;
}
// 原文件此处有一行 7508 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。