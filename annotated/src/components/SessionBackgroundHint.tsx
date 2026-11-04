import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useDoublePress } from '../hooks/useDoublePress.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import { backgroundAll, hasForegroundTasks } from '../tasks/LocalShellTask/LocalShellTask.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { env } from '../utils/env.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
type Props = {
  onBackgroundSession: () => void;
  isLoading: boolean;
};

// 文件头块注释：ctrl+b 采用双击模式——第一次按下只显示提示，800 毫秒内第二次才真正把会话转后台；且仅在加载中且无前台任务时激活，因为 bash 与代理任务的前台/后台切换同样占用 ctrl+b，任务优先。
/**
 * Shows a hint when user presses Ctrl+B to background the current session.
 * Uses double-press pattern: first press shows hint, second press within 800ms backgrounds.
 *
 * Only activates when:
 * 1. isLoading is true (a query is in progress)
 * 2. No foreground tasks (bash/agent) are running (those take priority for Ctrl+B)
 */
// SessionBackgroundHint：_c(10) 五段缓存，大部分槽是函数与上下文对象，可见输出只有第 93 行的一行提示。
export function SessionBackgroundHint(t0) {
  const $ = _c(10);
  const {
    onBackgroundSession,
    isLoading
  } = t0;
  const setAppState = useSetAppState();
  const appStateStore = useAppStateStore();
  const [showSessionHint, setShowSessionHint] = useState(false);
// useDoublePress 把双击逻辑封装成 hook：第一次触发 setShowSessionHint 显示提示，第二次触发 onBackgroundSession。_temp 是空的第一击回调。
  const handleDoublePress = useDoublePress(setShowSessionHint, onBackgroundSession, _temp);
  let t1;
  if ($[0] !== appStateStore || $[1] !== handleDoublePress || $[2] !== isLoading || $[3] !== setAppState) {
// handleBackground 三层判定：环境变量禁用直接返回；有前台任务则 backgroundAll 全部转后台（首次使用时写全局配置标记，下次不再引导）；否则走会话级双击后台。
    t1 = () => {
      if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)) {
        return;
      }
      const state = appStateStore.getState();
      if (hasForegroundTasks(state)) {
        backgroundAll(() => appStateStore.getState(), setAppState);
        if (!getGlobalConfig().hasUsedBackgroundTask) {
          saveGlobalConfig(_temp2);
        }
      } else {
// isEnvTruthy 加字面量 false 恒为假——这是构建期把某个 feature 常量内联成 false 的痕迹：会话级后台功能在此构建里被裁掉，代码结构保留但分支永不执行。读反编译产物时见到字面量布尔判断，先怀疑 feature flag。
        if (isEnvTruthy("false") && isLoading) {
          handleDoublePress();
        }
      }
    };
    $[0] = appStateStore;
    $[1] = handleDoublePress;
    $[2] = isLoading;
    $[3] = setAppState;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const handleBackground = t1;
// hasForeground 用 useAppState 订阅前台任务状态：它同时驱动第 73 行的键位激活条件与 backgroundAll 分支——订阅而非挂载读取，任务启停会实时改变 ctrl+b 的语义。
  const hasForeground = useAppState(hasForegroundTasks);
  let t2;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = isEnvTruthy("false");
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const sessionBgEnabled = t2;
// 键位激活条件：有前台任务，或（会话后台开启且正在加载）。isLoading 为假时 ctrl+b 完全不响应——没有可后台的东西。
  const t3 = hasForeground || sessionBgEnabled && isLoading;
  let t4;
  if ($[6] !== t3) {
    t4 = {
      context: "Task",
      isActive: t3
    };
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  useKeybinding("task:background", handleBackground, t4);
  const baseShortcut = useShortcutDisplay("task:background", "Task", "ctrl+b");
// tmux 特判：tmux 的 ctrl+b 是前缀键，真实按键变成连按两次，提示文案相应改成 ctrl+b ctrl+b——快捷键提示必须还原用户手指的真实动作。
  const shortcut = env.terminal === "tmux" && baseShortcut === "ctrl+b" ? "ctrl+b ctrl+b" : baseShortcut;
// 不在加载中或提示未显示时渲染 null：提示只在「第一次按过、等第二次」的窗口期可见，800 毫秒超时后自动消失。
  if (!isLoading || !showSessionHint) {
    return null;
  }
  let t5;
  if ($[8] !== shortcut) {
    t5 = <Box paddingLeft={2}><Text dimColor={true}><KeyboardShortcutHint shortcut={shortcut} action="background" /></Text></Box>;
    $[8] = shortcut;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
function _temp2(c) {
  return c.hasUsedBackgroundTask ? c : {
    ...c,
    hasUsedBackgroundTask: true
  };
}
function _temp() {}
// 原文件此处有一行 9668 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。