import { c as _c } from "react/compiler-runtime";
// 导入 React 编译器运行时的 `_c` 缓存辅助，编译器据此缓存稳定的中间值。
import { feature } from 'bun:bundle';
import React, { useContext, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { MailboxProvider } from '../context/mailbox.js';
import { useSettingsChange } from '../hooks/useSettingsChange.js';
import { logForDebugging } from '../utils/debug.js';
import { createDisabledBypassPermissionsContext, isBypassPermissionsModeDisabled } from '../utils/permissions/permissionSetup.js';
import { applySettingsChange } from '../utils/settings/applySettingsChange.js';
import type { SettingSource } from '../utils/settings/constants.js';
import { createStore } from './store.js';

// DCE: voice context is ant-only. External builds get a passthrough.
// 语音上下文是 ant 专属：外部构建走透传组件（直接返回 children），靠死代码消除剔除。
/* eslint-disable @typescript-eslint/no-require-imports */
const VoiceProvider: (props: {
  children: React.ReactNode;
}) => React.ReactNode = feature('VOICE_MODE') ? require('../context/voice.js').VoiceProvider : ({
  children
}) => children;

/* eslint-enable @typescript-eslint/no-require-imports */
import { type AppState, type AppStateStore, getDefaultAppState } from './AppStateStore.js';

// TODO: Remove these re-exports once all callers import directly from
// ./AppStateStore.js. Kept for back-compat during migration so .ts callers
// can incrementally move off the .tsx import and stop pulling React.
export { type AppState, type AppStateStore, type CompletionBoundary, getDefaultAppState, IDLE_SPECULATION_STATE, type SpeculationResult, type SpeculationState } from './AppStateStore.js';
// 从 `./AppStateStore.js` 重新导出若干类型与工厂，供迁移期兼容；最终调用方应直接引用 store 文件。
export const AppStoreContext = React.createContext<AppStateStore | null>(null);
type Props = {
  children: React.ReactNode;
  initialState?: AppState;
  onChangeAppState?: (args: {
    newState: AppState;
    oldState: AppState;
  }) => void;
};
const HasAppStateContext = React.createContext<boolean>(false);
// `AppStateProvider`：用外部 store 包裹子组件，并在挂载时同步远程设置、订阅设置变更。
export function AppStateProvider(t0) {
  const $ = _c(13);
  const {
    children,
    initialState,
    onChangeAppState
  } = t0;
  const hasAppStateContext = useContext(HasAppStateContext);
  if (hasAppStateContext) {
    throw new Error("AppStateProvider can not be nested within another AppStateProvider");
  }
  let t1;
  if ($[0] !== initialState || $[1] !== onChangeAppState) {
    t1 = () => createStore(initialState ?? getDefaultAppState(), onChangeAppState);
// 用初始状态（或默认状态）创建 store；惰性初始化，仅在依赖变化时才重建工厂函数。
    $[0] = initialState;
    $[1] = onChangeAppState;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const [store] = useState(t1);
  let t2;
  if ($[3] !== store) {
    t2 = () => {
      const {
        toolPermissionContext
      } = store.getState();
      if (toolPermissionContext.isBypassPermissionsModeAvailable && isBypassPermissionsModeDisabled()) {
        logForDebugging("Disabling bypass permissions mode on mount (remote settings loaded before mount)");
        store.setState(_temp);
      }
    };
    $[3] = store;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = [];
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  useEffect(t2, t3);
// `useEffect` 执行挂载副作用：若远程设置先于挂载加载，则在此关闭绕过权限模式。
  let t4;
  if ($[6] !== store.setState) {
    t4 = source => applySettingsChange(source, store.setState);
    $[6] = store.setState;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const onSettingsChange = useEffectEvent(t4);
// 把设置变更订阅器封装成 `useEffectEvent`，供 `useSettingsChange` 调用。
  useSettingsChange(onSettingsChange);
  let t5;
  if ($[8] !== children) {
    t5 = <MailboxProvider><VoiceProvider>{children}</VoiceProvider></MailboxProvider>;
    $[8] = children;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== store || $[11] !== t5) {
    t6 = <HasAppStateContext.Provider value={true}><AppStoreContext.Provider value={store}>{t5}</AppStoreContext.Provider></HasAppStateContext.Provider>;
    $[10] = store;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  return t6;
}
function _temp(prev) {
  return {
    ...prev,
    toolPermissionContext: createDisabledBypassPermissionsContext(prev.toolPermissionContext)
  };
}
// `useAppStore`：取出 store；若在 Provider 之外调用则抛错。
function useAppStore(): AppStateStore {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new ReferenceError('useAppState/useSetAppState cannot be called outside of an <AppStateProvider />');
  }
  return store;
}

/**
 * Subscribe to a slice of AppState. Only re-renders when the selected value
 * changes (compared via Object.is).
 *
 * For multiple independent fields, call the hook multiple times:
 * ```
 * const verbose = useAppState(s => s.verbose)
 * const model = useAppState(s => s.mainLoopModel)
 * ```
 *
 * Do NOT return new objects from the selector -- Object.is will always see
 * them as changed. Instead, select an existing sub-object reference:
 * ```
 * const { text, promptId } = useAppState(s => s.promptSuggestion) // good
 * ```
 */
// `useAppState`：订阅状态的一个切片，仅当选中值变化时（按 `Object.is` 比较）才重渲染。
export function useAppState(selector) {
  const $ = _c(3);
  const store = useAppStore();
  let t0;
  if ($[0] !== selector || $[1] !== store) {
    t0 = () => {
      const state = store.getState();
      const selected = selector(state);
      if (false && state === selected) {
        throw new Error(`Your selector in \`useAppState(${selector.toString()})\` returned the original state, which is not allowed. You must instead return a property for optimised rendering.`);
      }
      return selected;
    };
    $[0] = selector;
    $[1] = store;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const get = t0;
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * Get the setAppState updater without subscribing to any state.
 * Returns a stable reference that never changes -- components using only
 * this hook will never re-render from state changes.
 */
// `useSetAppState`：只取更新函数而不订阅任何状态，纯更新型组件不会因此重渲染。
export function useSetAppState() {
  return useAppStore().setState;
}

/**
 * Get the store directly (for passing getState/setState to non-React code).
 */
export function useAppStateStore() {
  return useAppStore();
}
const NOOP_SUBSCRIBE = () => () => {};

/**
 * Safe version of useAppState that returns undefined if called outside of AppStateProvider.
 * Useful for components that may be rendered in contexts where AppStateProvider isn't available.
 */
// `useAppStateMaybeOutsideOfProvider`：安全版，Provider 之外调用返回 undefined 而非抛错。
export function useAppStateMaybeOutsideOfProvider(selector) {
  const $ = _c(3);
  const store = useContext(AppStoreContext);
  let t0;
  if ($[0] !== selector || $[1] !== store) {
    t0 = () => store ? selector(store.getState()) : undefined;
    $[0] = selector;
    $[1] = store;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return useSyncExternalStore(store ? store.subscribe : NOOP_SUBSCRIBE, t0);
}
// 原文件此处有一行 16932 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。