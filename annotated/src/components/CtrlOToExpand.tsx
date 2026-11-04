import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import React, { useContext } from 'react';
import { Text } from '../ink.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { InVirtualListContext } from './messageActions.js';

// Context to track if we're inside a sub agent
// Similar to MessageResponseContext, this helps us avoid showing
// too many "(ctrl+o to expand)" hints in sub agent output
// 英文注释对应的中文：用 Context 标记是否处于子 agent 内部，避免在子 agent 输出里塞太多「ctrl+o 展开」提示。
const SubAgentContext = React.createContext(false);
// 创建子 agent 上下文，默认关闭（非子 agent 环境）。
// 提供者组件：把 children 包进 SubAgentContext.Provider 并置为 true。
export function SubAgentProvider(t0) {
  const $ = _c(2);
  const {
    children
  } = t0;
  let t1;
  if ($[0] !== children) {
    t1 = <SubAgentContext.Provider value={true}>{children}</SubAgentContext.Provider>;
    $[0] = children;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
// 内联提示组件：不在子 agent 且不在虚拟列表内时，展示「ctrl+o 展开」提示。
export function CtrlOToExpand() {
  const $ = _c(2);
  const isInSubAgent = useContext(SubAgentContext);
  const inVirtualList = useContext(InVirtualListContext);
  const expandShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  if (isInSubAgent || inVirtualList) {
    return null;
  }
  let t0;
  if ($[0] !== expandShortcut) {
    t0 = <Text dimColor={true}><KeyboardShortcutHint shortcut={expandShortcut} action="expand" parens={true} /></Text>;
    $[0] = expandShortcut;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
// 纯文本版：返回带快捷键的「(ctrl+o 展开)」灰色字符串，供非 React 场景使用。
export function ctrlOToExpand(): string {
  const shortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  return chalk.dim(`(${shortcut} to expand)`);
}
// 原文件此处有一行 4364 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。