import { c as _c } from "react/compiler-runtime";
import React, { createContext, useMemo, useSyncExternalStore } from 'react';
import { getTerminalFocused, getTerminalFocusState, subscribeTerminalFocus, type TerminalFocusState } from '../terminal-focus-state.js';
export type { TerminalFocusState };
export type TerminalFocusContextProps = {
  readonly isTerminalFocused: boolean;
  readonly terminalFocusState: TerminalFocusState;
};
const TerminalFocusContext = createContext<TerminalFocusContextProps>({
  isTerminalFocused: true,
  terminalFocusState: 'unknown'
});

// eslint-disable-next-line custom-rules/no-top-level-side-effects
TerminalFocusContext.displayName = 'TerminalFocusContext';

// Separate component so App.tsx doesn't re-render on focus changes.
// Children are a stable prop reference, so they don't re-render either —
// only components that consume the context will re-render.
// 【用 useSyncExternalStore，而不是 context + setState】
//
// 焦点状态活在模块级的 terminal-focus-state.ts 里（一个 Map/Set of
// 订阅者 + 一个值），不活在 React state 里。理由和 selection 那一套
// 一样：变化源在 React 之外（stdin 来的 CSI I / CSI O），而且变化频率
// 不可控（切换窗口可能一瞬间多次）。
//
// 用 useSyncExternalStore 的好处是「只有真正订阅的组件重渲染」——
// App 不会因为切窗口而整树重画（见 App.tsx:385 的批注）。
//
// 注意这里**订阅了两次同一个 store**，一次取 boolean、一次取三态
// （'unknown' | 'focused' | 'unfocused'）。两个 getSnapshot 是不同
// 函数、返回不同值，所以两条订阅互不干扰 —— 只是多了一次 store 访问。
export function TerminalFocusProvider(t0) {
  const $ = _c(6);
  const {
    children
  } = t0;
  const isTerminalFocused = useSyncExternalStore(subscribeTerminalFocus, getTerminalFocused);
  const terminalFocusState = useSyncExternalStore(subscribeTerminalFocus, getTerminalFocusState);
  let t1;
  if ($[0] !== isTerminalFocused || $[1] !== terminalFocusState) {
    t1 = {
      isTerminalFocused,
      terminalFocusState
    };
    $[0] = isTerminalFocused;
    $[1] = terminalFocusState;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const value = t1;
  let t2;
  if ($[3] !== children || $[4] !== value) {
    t2 = <TerminalFocusContext.Provider value={value}>{children}</TerminalFocusContext.Provider>;
    $[3] = children;
    $[4] = value;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}
export default TerminalFocusContext;
// 原文件此处有一行 4204 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。