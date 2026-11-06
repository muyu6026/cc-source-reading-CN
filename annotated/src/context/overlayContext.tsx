// 编译器产物：`_c` 是槽位缓存，`t1`/`t2` 这类临时变量与 `$[n]` 比较条件都是自动生成的，读的时候只关心哪几个槽位参与比较
import { c as _c } from "react/compiler-runtime";
/**
 * Overlay tracking for Escape key coordination.
 *
 * This solves the problem of escape key handling when overlays (like Select with onCancel)
 * are open. The CancelRequestHandler needs to know when an overlay is active so it doesn't
 * cancel requests when the user just wants to dismiss the overlay.
 *
 * Usage:
 * 1. Call useRegisterOverlay() in any overlay component to automatically register it
 * 2. Call useIsOverlayActive() to check if any overlay is currently active
 *
 * The hook automatically registers on mount and unregisters on unmount,
 * so no manual cleanup or state management is needed.
 */
// 三个 Hook 围绕同一张全局浮层集合：注册、查全部、查模态。之所以拆成后两个，是因为输入框只关心模态
import { useContext, useEffect, useLayoutEffect } from 'react';
import instances from '../ink/instances.js';
import { AppStoreContext, useAppState } from '../state/AppState.js';

// Non-modal overlays that shouldn't disable TextInput focus
// 只把自动补全列为非模态：它挂在输入框上，若也算模态，用户打字时输入框会失焦
const NON_MODAL_OVERLAYS = new Set(['autocomplete']);

/**
 * Hook to register a component as an active overlay.
 * Automatically registers on mount and unregisters on unmount.
 *
 * @param id - Unique identifier for this overlay (e.g., 'select', 'multi-select')
 * @param enabled - Whether to register (default: true). Use this to conditionally register
 *                  based on component props, e.g., only register when onCancel is provided.
 *
 * @example
 * // Conditional registration based on whether cancel is supported
 * function useSelectInput({ state }) {
 *   useRegisterOverlay('select', !!state.onCancel)
 *   // ...
 * }
 */
// 第二个参数缺省为真：多数浮层无条件注册，只有「支持取消」的那类才按条件注册
export function useRegisterOverlay(id, t0) {
  const $ = _c(8);
  const enabled = t0 === undefined ? true : t0;
  const store = useContext(AppStoreContext);
  const setAppState = store?.setState;
  let t1;
  let t2;
// 槽位比较条件就是依赖数组：id、enabled、setAppState 三者任一变化才重建副作用
  if ($[0] !== enabled || $[1] !== id || $[2] !== setAppState) {
    t1 = () => {
      if (!enabled || !setAppState) {
        return;
      }
// 先查再加：已有同 id 就返回原状态，避免重复注册引发无限重渲染
      setAppState(prev => {
        if (prev.activeOverlays.has(id)) {
          return prev;
        }
// 集合必须复制：原地添加会让外层看到同一引用而不重渲染，浮层就永远关不掉
        const next = new Set(prev.activeOverlays);
        next.add(id);
        return {
          ...prev,
          activeOverlays: next
        };
      });
// 返回的这个函数就是清理函数：卸载时把自己从集合里删掉，不需要额外的状态管理
      return () => {
        setAppState(prev_0 => {
          if (!prev_0.activeOverlays.has(id)) {
            return prev_0;
          }
          const next_0 = new Set(prev_0.activeOverlays);
          next_0.delete(id);
          return {
            ...prev_0,
            activeOverlays: next_0
          };
        });
      };
    };
    t2 = [id, enabled, setAppState];
    $[0] = enabled;
    $[1] = id;
    $[2] = setAppState;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  useEffect(t1, t2);
  let t3;
  let t4;
// 注册用普通副作用，刷新帧却用布局副作用：后者要在绘制之前跑完，否则会看到一帧旧画面
  if ($[5] !== enabled) {
    t3 = () => {
      if (!enabled) {
        return;
      }
// `_temp` 是编译器把内联箭头提成的模块级函数，作用是让 Ink 丢掉上一帧缓存
      return _temp;
    };
    t4 = [enabled];
    $[5] = enabled;
    $[6] = t3;
    $[7] = t4;
  } else {
    t3 = $[6];
    t4 = $[7];
  }
  useLayoutEffect(t3, t4);
}

/**
 * Hook to check if any overlay is currently active.
 * This is reactive - the component will re-render when the overlay state changes.
 *
 * @returns true if any overlay is currently active
 *
 * @example
 * function CancelRequestHandler() {
 *   const isOverlayActive = useIsOverlayActive()
 *   const isActive = !isOverlayActive && canCancelRunningTask
 *   useKeybinding('chat:cancel', handleCancel, { isActive })
 * }
 */
function _temp() {
  return instances.get(process.stdout)?.invalidatePrevFrame();
}
// 查询侧只暴露布尔：这个 Hook 会让整个聊天界面在浮层开关时重渲染，所以不把集合本身泄出去
export function useIsOverlayActive() {
  return useAppState(_temp2);
}

/**
 * Hook to check if any modal overlay is currently active.
 * Modal overlays are overlays that should capture all input (like Select dialogs).
 * Non-modal overlays (like autocomplete) don't disable TextInput focus.
 *
 * @returns true if any modal overlay is currently active
 *
 * @example
 * // Use for TextInput focus - allows typing during autocomplete
 * focus: !isSearchingHistory && !isModalOverlayActive
 */
function _temp2(s) {
  return s.activeOverlays.size > 0;
}
// 模态查询要遍历集合：只要有一个不在非模态名单里就算模态
export function useIsModalOverlayActive() {
  return useAppState(_temp3);
}
function _temp3(s) {
  for (const id of s.activeOverlays) {
    if (!NON_MODAL_OVERLAYS.has(id)) {
      return true;
    }
  }
  return false;
}
// 原文件此处有一行 9840 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。