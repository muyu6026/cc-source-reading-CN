// 编译器产物：四个 context 分两组，数据与写入函数各一对
import { c as _c } from "react/compiler-runtime";
// 这段说明是理解整个文件的前提：底部插槽的裁剪是必要的，浮层因此也被裁掉，另开一条通道绕过去
/**
 * Portal for content that floats above the prompt so it escapes
 * FullscreenLayout's bottom-slot `overflowY:hidden` clip.
 *
 * The clip is load-bearing (CC-668: tall pastes squash the ScrollBox
 * without it), but floating overlays use `position:absolute
 * bottom="100%"` to float above the prompt — and Ink's clip stack
 * intersects ALL descendants, so they were clipped to ~1 row.
 *
 * Two channels:
 * - `useSetPromptOverlay` — slash-command suggestion data (structured,
 *   written by PromptInputFooter)
 * - `useSetPromptOverlayDialog` — arbitrary dialog node (e.g.
 *   AutoModeOptInDialog, written by PromptInput)
 *
 * FullscreenLayout reads both and renders them outside the clipped slot.
 *
 * Split into data/setter context pairs so writers never re-render on
 * their own writes — the setter contexts are stable.
 */
// 拆成四份是为了让写入方不在自己写入时重渲染：写函数引用稳定，只有数据引用会变
import React, { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js';
export type PromptOverlayData = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
};
// 写函数允许传空：清空与注销共用同一个入口
type Setter<T> = (d: T | null) => void;
// 数据与写函数各成一个 context：读数据的组件与写数据的组件本来就不是同一批
const DataContext = createContext<PromptOverlayData | null>(null);
const SetContext = createContext<Setter<PromptOverlayData> | null>(null);
const DialogContext = createContext<ReactNode>(null);
const SetDialogContext = createContext<Setter<ReactNode> | null>(null);
// 提供者是两层嵌套：外层只挂对话框，内层挂建议数据与两个写函数
export function PromptOverlayProvider(t0) {
  const $ = _c(6);
  const {
    children
  } = t0;
// 两份状态放在同一组件里：共用一个提供者，但通过不同 context 下发
  const [data, setData] = useState(null);
  const [dialog, setDialog] = useState(null);
  let t1;
// 第一层只依赖对话框与子节点：建议数据变化时这一层不必重建
  if ($[0] !== children || $[1] !== dialog) {
    t1 = <DialogContext.Provider value={dialog}>{children}</DialogContext.Provider>;
    $[0] = children;
    $[1] = dialog;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
// 第二层把写函数也包进来：写函数引用稳定，所以缓存键里只有数据与上一层结果
  if ($[3] !== data || $[4] !== t1) {
    t2 = <SetContext.Provider value={setData}><SetDialogContext.Provider value={setDialog}><DataContext.Provider value={data}>{t1}</DataContext.Provider></SetDialogContext.Provider></SetContext.Provider>;
    $[3] = data;
    $[4] = t1;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}
// 读取侧只暴露值：写函数不从这里出去，避免任何组件顺手拿到 setter
export function usePromptOverlay() {
  return useContext(DataContext);
}
export function usePromptOverlayDialog() {
  return useContext(DialogContext);
}

/**
 * Register suggestion data for the floating overlay. Clears on unmount.
 * No-op outside the provider (non-fullscreen renders inline instead).
 */
// 在提供者之外调用是空操作：非全屏渲染时建议是内联显示的，不需要浮层
export function useSetPromptOverlay(data) {
  const $ = _c(4);
  const set = useContext(SetContext);
  let t0;
  let t1;
  if ($[0] !== data || $[1] !== set) {
    t0 = () => {
// 没有写函数就直接返回：空操作的实现，也省掉一次无意义的登记
      if (!set) {
        return;
      }
// 登记后返回清理函数：卸载时清空，避免浮层残留在屏幕上
      set(data);
      return () => set(null);
    };
    t1 = [set, data];
    $[0] = data;
    $[1] = set;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  useEffect(t0, t1);
}

/**
 * Register a dialog node to float above the prompt. Clears on unmount.
 * No-op outside the provider (non-fullscreen renders inline instead).
 */
// 对话框那一路结构完全对称：只是换了一对 context
export function useSetPromptOverlayDialog(node) {
  const $ = _c(4);
  const set = useContext(SetDialogContext);
  let t0;
  let t1;
  if ($[0] !== node || $[1] !== set) {
    t0 = () => {
      if (!set) {
        return;
      }
      set(node);
      return () => set(null);
    };
    t1 = [set, node];
    $[0] = node;
    $[1] = set;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  useEffect(t0, t1);
}
// 原文件此处有一行 8536 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。