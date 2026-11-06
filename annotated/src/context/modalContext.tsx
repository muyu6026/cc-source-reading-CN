import { c as _c } from "react/compiler-runtime";
import { createContext, type RefObject, useContext } from 'react';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
// 引入滚动容器句柄类型，供模态内的滚动定位复用。

/**
 * Set by FullscreenLayout when rendering content in its `modal` slot —
 * the absolute-positioned bottom-anchored pane for slash-command dialogs.
 * Consumers use this to:
 *
 * - Suppress top-level framing — `Pane` skips its full-terminal-width
 *   `Divider` (FullscreenLayout already draws the ▔ divider).
 * - Size Select pagination to the available rows — the modal's inner
 *   area is smaller than the terminal (rows minus transcript peek minus
 *   divider), so components that cap their visible option count from
 *   `useTerminalSize().rows` would overflow without this context.
 * - Reset scroll on tab switch — Tabs keys its ScrollBox by
 *   `selectedTabIndex`, remounting on tab switch so scrollTop resets to 0
 *   without scrollTo() timing games.
 *
 * null = not inside the modal slot.
 */
type ModalCtx = {
// ModalCtx 描述模态槽注入的上下文：可用行列数与滚动句柄。
  rows: number;
  columns: number;
  scrollRef: RefObject<ScrollBoxHandle | null> | null;
};
export const ModalContext = createContext<ModalCtx | null>(null);
// 以 null 为默认值创建上下文，未进入模态槽时读取到 null。
export function useIsInsideModal() {
  return useContext(ModalContext) !== null;
}
// 判空封装：拿到非 null 即代表当前处于模态槽内部。

/**
 * Available content rows/columns when inside a Modal, else falls back to
 * the provided terminal size. Use instead of `useTerminalSize()` when a
 * component caps its visible content height — the modal's inner area is
 * smaller than the terminal.
 */
export function useModalOrTerminalSize(fallback) {
// 对外尺寸 Hook：处于模态内时取模态行列数，否则回退终端尺寸。
  const $ = _c(3);
  const ctx = useContext(ModalContext);
  let t0;
  if ($[0] !== ctx || $[1] !== fallback) {
    t0 = ctx ? {
      rows: ctx.rows,
      columns: ctx.columns
    } : fallback;
    $[0] = ctx;
    $[1] = fallback;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return t0;
}
// 依赖记忆槽：ctx 或 fallback 不变时复用上一次计算结果，避免重复构造。
export function useModalScrollRef() {
  return useContext(ModalContext)?.scrollRef ?? null;
}
// 暴露模态滚动句柄，缺失时回退为 null。
// 原文件此处有一行 4296 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。