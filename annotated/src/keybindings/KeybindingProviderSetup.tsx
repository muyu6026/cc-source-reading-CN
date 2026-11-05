// 编译器产物：下面的槽位数组与临时判断都是自动生成的，读的时候只看业务分支
import { c as _c } from "react/compiler-runtime";
/**
 * Setup utilities for integrating KeybindingProvider into the app.
 *
 * This file provides the bindings and a composed provider that can be
 * added to the app's component tree. It loads both default bindings and
 * user-defined bindings from ~/.claude/keybindings.json, with hot-reload
 * support when the file changes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNotifications } from '../context/notifications.js';
import type { InputEvent } from '../ink/events/input-event.js';
// ChordInterceptor intentionally uses useInput to intercept all keystrokes before
// other handlers process them - this is required for chord sequence support
// eslint-disable-next-line custom-rules/prefer-use-keybindings
import { type Key, useInput } from '../ink.js';
import { count } from '../utils/array.js';
import { logForDebugging } from '../utils/debug.js';
import { plural } from '../utils/stringUtils.js';
import { KeybindingProvider } from './KeybindingContext.js';
import { initializeKeybindingWatcher, type KeybindingsLoadResult, loadKeybindingsSyncWithWarnings, subscribeToKeybindingChanges } from './loadUserBindings.js';
import { resolveKeyWithChordState } from './resolver.js';
import type { KeybindingContextName, ParsedBinding, ParsedKeystroke } from './types.js';
import type { KeybindingWarning } from './validate.js';

// 组合键的等待窗口：超时未完成就整段作废，避免第一个键被无限期扣住
/**
 * Timeout for chord sequences in milliseconds.
 * If the user doesn't complete the chord within this time, it's cancelled.
 */
const CHORD_TIMEOUT_MS = 1000;
type Props = {
  children: React.ReactNode;
};

/**
 * Keybinding provider with default + user bindings and hot-reload support.
 *
 * Usage: Wrap your app with this provider to enable keybinding support.
 *
 * ```tsx
 * <AppStateProvider>
 *   <KeybindingSetup>
 *     <REPL ... />
 *   </KeybindingSetup>
 * </AppStateProvider>
 * ```
 *
 * Features:
 * - Loads default bindings from code
 * - Merges with user bindings from ~/.claude/keybindings.json
 * - Watches for file changes and reloads automatically (hot-reload)
 * - User bindings override defaults (later entries win)
 * - Chord support with automatic timeout
 */
/**
 * Display keybinding warnings to the user via notifications.
 * Shows a brief message pointing to /doctor for details.
 */
// 警告转通知：只在数量或来源变化时重建回调，其余渲染直接命中缓存槽
function useKeybindingWarnings(warnings, isReload) {
  const $ = _c(9);
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  let t0;
// 槽位比较就是依赖数组：三个输入都没变时复用上次的回调，这是编译器的等价重写
  if ($[0] !== addNotification || $[1] !== removeNotification || $[2] !== warnings) {
    t0 = () => {
// 没有警告要主动撤掉旧通知：否则改好配置后那条提示会一直挂在界面上
      if (warnings.length === 0) {
        removeNotification("keybinding-config-warning");
        return;
      }
      const errorCount = count(warnings, _temp);
      const warnCount = count(warnings, _temp2);
      let message;
// 两类问题同时存在时合并成一句，用户一次就知道总数
      if (errorCount > 0 && warnCount > 0) {
        message = `Found ${errorCount} keybinding ${plural(errorCount, "error")} and ${warnCount} ${plural(warnCount, "warning")}`;
      } else {
        if (errorCount > 0) {
          message = `Found ${errorCount} keybinding ${plural(errorCount, "error")}`;
        } else {
          message = `Found ${warnCount} keybinding ${plural(warnCount, "warning")}`;
        }
      }
// 末尾固定指向诊断命令：通知栏放不下细节，把展开入口给出来就够了
      message = message + " \xB7 /doctor for details";
      addNotification({
        key: "keybinding-config-warning",
        text: message,
// 有错误就用错误色与最高优先级：警告可以被后续消息顶掉，错误不行
        color: errorCount > 0 ? "error" : "warning",
        priority: errorCount > 0 ? "immediate" : "high",
// 一分钟足够读完，又不至于长期占位
        timeoutMs: 60000
      });
    };
    $[0] = addNotification;
    $[1] = removeNotification;
    $[2] = warnings;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  let t1;
  if ($[4] !== addNotification || $[5] !== isReload || $[6] !== removeNotification || $[7] !== warnings) {
    t1 = [warnings, isReload, addNotification, removeNotification];
    $[4] = addNotification;
    $[5] = isReload;
    $[6] = removeNotification;
    $[7] = warnings;
    $[8] = t1;
  } else {
    t1 = $[8];
  }
// 依赖数组在编译后变成这个四元组，顺序与闭包里读到的变量一一对应
  useEffect(t0, t1);
}
function _temp2(w_0) {
  return w_0.severity === "warning";
}
function _temp(w) {
  return w.severity === "error";
}
// 总装配：同步读一次配置拿到初值，再挂监听做热重载，最后把状态发给 Provider 与拦截器
export function KeybindingSetup({
  children
}: Props): React.ReactNode {
  // Load bindings synchronously for initial render
  const [{
    bindings,
    warnings
  }, setLoadResult] = useState<KeybindingsLoadResult>(() => {
// 首帧必须同步读到绑定：异步加载会让第一次按键落到空表上
    const result = loadKeybindingsSyncWithWarnings();
    logForDebugging(`[keybindings] KeybindingSetup initialized with ${result.bindings.length} bindings, ${result.warnings.length} warnings`);
    return result;
  });

  // Track if this is a reload (not initial load)
// 区分首载与重载只为通知文案：重载时才需要提醒用户配置变了
  const [isReload, setIsReload] = useState(false);

  // Display warnings via notifications
  useKeybindingWarnings(warnings, isReload);

  // Chord state management - use ref for immediate access, state for re-renders
  // The ref is used by resolve() to get the current value without waiting for re-render
  // The state is used to trigger re-renders when needed (e.g., for UI updates)
// 待完成组合键同时存 ref 与 state：前者给同步解析用，后者只为触发界面更新
  const pendingChordRef = useRef<ParsedKeystroke[] | null>(null);
  const [pendingChord, setPendingChordState] = useState<ParsedKeystroke[] | null>(null);
  const chordTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handler registry for action callbacks (used by ChordInterceptor to invoke handlers)
// 处理器注册表按动作名聚合：同一个动作可能在多个上下文里注册，触发时再挑上下文
  const handlerRegistryRef = useRef(new Map<string, Set<{
    action: string;
    context: KeybindingContextName;
    handler: () => void;
  }>>());

  // Active context tracking for keybinding priority resolution
  // Using a ref instead of state for synchronous updates - input handlers need
  // to see the current value immediately, not after a React render cycle.
// 激活上下文用 ref：输入回调需要立刻看到最新值，等一次渲染就已经晚了
  const activeContextsRef = useRef<Set<KeybindingContextName>>(new Set());
  const registerActiveContext = useCallback((context: KeybindingContextName) => {
    activeContextsRef.current.add(context);
  }, []);
  const unregisterActiveContext = useCallback((context_0: KeybindingContextName) => {
    activeContextsRef.current.delete(context_0);
  }, []);

  // Clear chord timeout when component unmounts or chord changes
// 清超时单独抽出：取消组合键与组件卸载两处都要调，重复写容易漏
  const clearChordTimeout = useCallback(() => {
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current);
      chordTimeoutRef.current = null;
    }
  }, []);

  // Wrapper for setPendingChord that manages timeout and syncs ref+state
// 设置待完成组合键是三件事：清旧计时、按需起新计时、同步 ref 与 state
  const setPendingChord = useCallback((pending: ParsedKeystroke[] | null) => {
    clearChordTimeout();
    if (pending !== null) {
      // Set timeout to cancel chord if not completed
// 计时器把两个句柄当参数传进去而不是闭包捕获：编译后的回调可能被复用，闭包会读到旧引用
      chordTimeoutRef.current = setTimeout((pendingChordRef_0, setPendingChordState_0) => {
        logForDebugging('[keybindings] Chord timeout - cancelling');
        pendingChordRef_0.current = null;
        setPendingChordState_0(null);
      }, CHORD_TIMEOUT_MS, pendingChordRef, setPendingChordState);
    }

    // Update ref immediately for synchronous access in resolve()
// 先写 ref 再写 state：解析函数在下一次渲染之前就可能被调用
    pendingChordRef.current = pending;
    // Update state to trigger re-renders for UI updates
    setPendingChordState(pending);
  }, [clearChordTimeout]);
// 挂载时做两件事：启动文件监听（幂等）与订阅变更
  useEffect(() => {
    // Initialize file watcher (idempotent - only runs once)
    void initializeKeybindingWatcher();

    // Subscribe to changes
// 订阅回调一定是重载：首载走的是上面那个同步初始化，不经过这里
    const unsubscribe = subscribeToKeybindingChanges(result_0 => {
      // Any callback invocation is a reload since initial load happens
      // synchronously in useState, not via this subscription
      setIsReload(true);
      setLoadResult(result_0);
      logForDebugging(`[keybindings] Reloaded: ${result_0.bindings.length} bindings, ${result_0.warnings.length} warnings`);
    });
// 卸载时退订并清计时器：残留的计时器会在组件消失后改已卸载的状态
    return () => {
      unsubscribe();
      clearChordTimeout();
    };
  }, [clearChordTimeout]);
// Provider 收的是 ref 的当前值而不是 ref 本身：下游只读快照，写入仍由这里控制
  return <KeybindingProvider bindings={bindings} pendingChordRef={pendingChordRef} pendingChord={pendingChord} setPendingChord={setPendingChord} activeContexts={activeContextsRef.current} registerActiveContext={registerActiveContext} unregisterActiveContext={unregisterActiveContext} handlerRegistryRef={handlerRegistryRef}>
      <ChordInterceptor bindings={bindings} pendingChordRef={pendingChordRef} setPendingChord={setPendingChord} activeContexts={activeContextsRef.current} handlerRegistryRef={handlerRegistryRef} />
      {children}
    </KeybindingProvider>;
}

/**
 * Global chord interceptor that registers useInput FIRST (before children).
 *
 * This component intercepts keystrokes that are part of chord sequences and
 * stops propagation before other handlers (like PromptInput) can see them.
 *
 * Without this, the second key of a chord (e.g., 'r' in "ctrl+c r") would be
 * captured by PromptInput and added to the input field before the keybinding
 * system could recognize it as completing a chord.
 */
type HandlerRegistration = {
  action: string;
  context: KeybindingContextName;
  handler: () => void;
};
// 拦截器必须是子树的第一个节点：它要比输入框更早注册，才能抢到组合键的第二个键
function ChordInterceptor(t0) {
  const $ = _c(6);
  const {
    bindings,
    pendingChordRef,
    setPendingChord,
    activeContexts,
    handlerRegistryRef
  } = t0;
  let t1;
  if ($[0] !== activeContexts || $[1] !== bindings || $[2] !== handlerRegistryRef || $[3] !== pendingChordRef || $[4] !== setPendingChord) {
// 滚轮事件在没有待完成组合键时直接放行：它不属于组合键序列，拦下来会让列表无法滚动
    t1 = (input, key, event) => {
      if ((key.wheelUp || key.wheelDown) && pendingChordRef.current === null) {
        return;
      }
      const registry = handlerRegistryRef.current;
      const handlerContexts = new Set();
      if (registry) {
        for (const handlers of registry.values()) {
          for (const registration of handlers) {
            handlerContexts.add(registration.context);
          }
        }
      }
// 候选上下文按优先级排：已注册处理器的上下文在前，当前激活的居中，全局兜底最后
      const contexts = [...handlerContexts, ...activeContexts, "Global"];
// 先记下进入解析前是否已在组合键中：单键命中与组合键收尾的处理完全不同
      const wasInChord = pendingChordRef.current !== null;
      const result = resolveKeyWithChordState(input, key, contexts, bindings, pendingChordRef.current);
      bb23: switch (result.type) {
// 组合键的第一个键：记下待完成状态并立刻截断事件，后面的处理器看不到它
        case "chord_started":
          {
            setPendingChord(result.pending);
            event.stopImmediatePropagation();
            break bb23;
          }
// 命中：先清待完成状态，再看这次是不是组合键的收尾
        case "match":
          {
            setPendingChord(null);
// 只有原本在组合键中才由这里调用处理器：单键命中交给常规的按键绑定层，两边都调会执行两次
            if (wasInChord) {
              const contextsSet = new Set(contexts);
              if (registry) {
                const handlers_0 = registry.get(result.action);
                if (handlers_0 && handlers_0.size > 0) {
                  for (const registration_0 of handlers_0) {
                    if (contextsSet.has(registration_0.context)) {
                      registration_0.handler();
                      event.stopImmediatePropagation();
                      break;
                    }
                  }
                }
              }
            }
            break bb23;
          }
// 组合键被取消（按了不匹配的键）：清状态并吃掉这个键，避免它同时被当成普通输入
        case "chord_cancelled":
          {
            setPendingChord(null);
            event.stopImmediatePropagation();
            break bb23;
          }
// 未绑定的组合键收尾同样要吃掉：用户已经表达了组合意图，不该落进输入框
        case "unbound":
          {
            setPendingChord(null);
            event.stopImmediatePropagation();
            break bb23;
          }
        case "none":
      }
    };
    $[0] = activeContexts;
    $[1] = bindings;
    $[2] = handlerRegistryRef;
    $[3] = pendingChordRef;
    $[4] = setPendingChord;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  const handleInput = t1;
// 这里刻意用底层输入钩子而不是按键绑定钩子：它要能看到所有按键，包括已被别人认领的
  useInput(handleInput);
  return null;
}
// 原文件此处有一行 30068 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。