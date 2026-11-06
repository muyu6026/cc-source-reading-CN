import { c as _c } from "react/compiler-runtime";
// 依赖：React Compiler 运行时、React 核心 hook、外部 store；voice 状态存在独立 store 里。
import React, { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { createStore, type Store } from '../state/store.js';
export type VoiceState = {
  voiceState: 'idle' | 'recording' | 'processing';
  voiceError: string | null;
  voiceInterimTranscript: string;
  voiceAudioLevels: number[];
  voiceWarmingUp: boolean;
};
// VoiceState 类型：idle、recording、processing 三态加错误、临时稿、音量、预热标志。
const DEFAULT_STATE: VoiceState = {
  voiceState: 'idle',
  voiceError: null,
  voiceInterimTranscript: '',
  voiceAudioLevels: [],
  voiceWarmingUp: false
};
// DEFAULT_STATE：把五字段初始化，预热关闭、音量空数组。
type VoiceStore = Store<VoiceState>;
const VoiceContext = createContext<VoiceStore | null>(null);
// VoiceContext：用 React Context 把 store 向下传，初始为 null。
type Props = {
  children: React.ReactNode;
};
// Props：组件只收 children。
export function VoiceProvider(t0) {
  const $ = _c(3);
  const {
    children
  } = t0;
  const [store] = useState(_temp);
  let t1;
  if ($[0] !== children || $[1] !== store) {
    t1 = <VoiceContext.Provider value={store}>{children}</VoiceContext.Provider>;
    $[0] = children;
    $[1] = store;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
// VoiceProvider：编译器产物，把 children 包进 Provider，store 用 useState 惰性创建。
function _temp() {
  return createStore(DEFAULT_STATE);
}
function useVoiceStore() {
  const store = useContext(VoiceContext);
  if (!store) {
    throw new Error("useVoiceState must be used within a VoiceProvider");
  }
  return store;
}
// useVoiceStore：取 store，没命中 Provider 就抛错提醒必须在 Provider 内使用。

/**
 * Subscribe to a slice of voice state. Only re-renders when the selected
 * value changes (compared via Object.is).
 */
export function useVoiceState(selector) {
  const $ = _c(3);
  const store = useVoiceStore();
  let t0;
  if ($[0] !== selector || $[1] !== store) {
    t0 = () => selector(store.getState());
    $[0] = selector;
    $[1] = store;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const get = t0;
  return useSyncExternalStore(store.subscribe, get, get);
}
// useVoiceState：订阅状态切片，靠 Object.is 比对只在选中值变化时重渲染。

/**
 * Get the voice state setter. Stable reference — never causes re-renders.
 * store.setState is synchronous: callers can read getVoiceState() immediately
 * after to observe the new value (VoiceKeybindingHandler relies on this).
 */
export function useSetVoiceState() {
  return useVoiceStore().setState;
}
// useSetVoiceState：返回 store.setState，引用稳定、不会触发重渲染。

/**
 * Get a synchronous reader for fresh state inside callbacks. Unlike
 * useVoiceState (which subscribes), this doesn't cause re-renders — use
 * inside event handlers that need to read state set earlier in the same tick.
 */
export function useGetVoiceState() {
  return useVoiceStore().getState;
}
// useGetVoiceState：返回 getState，供事件回调里同步读最新值（同一 tick 内可读到刚写的值）。
// 原文件此处有一行 6380 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。