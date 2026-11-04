// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
// 引入退出键绑定钩子 `useExitOnCtrlCDWithKeybindings`，Dialog 的 Esc/Ctrl-C/D 行为依赖它。
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { Theme } from '../../utils/theme.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from './Byline.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { Pane } from './Pane.js';
// DialogProps：标题、副标题、子内容、取消回调，以及颜色、是否隐藏输入提示/边框等开关。
type DialogProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onCancel: () => void;
  color?: keyof Theme;
  hideInputGuide?: boolean;
  hideBorder?: boolean;
// `inputGuide` 是一个接收 `exitState` 的自定义渲染函数，用于显示「再按一次退出」之类的动态提示。
  /** Custom input guide content. Receives exitState for Ctrl+C/D pending display. */
  inputGuide?: (exitState: ExitState) => React.ReactNode;
// 一段较长的块注释，解释 `isCancelActive`：在嵌入文本框编辑时设为 false，让 Esc/Ctrl-C/D 落到文本框而非被 Dialog 吞掉。
  /**
   * Controls whether Dialog's built-in confirm:no (Esc/n) and app:exit/interrupt
   * (Ctrl-C/D) keybindings are active. Set to `false` while an embedded text
   * field is being edited so those keys reach the field instead of being
   * consumed by Dialog. TextInput has its own ctrl+c/d handlers (cancel on
   * press, delete-forward on ctrl+d with text). Defaults to `true`.
   */
  isCancelActive?: boolean;
};
// Dialog 是几乎所有弹窗复用的底层容器，负责标题、边框、输入提示与取消键。
export function Dialog(t0) {
// `_c(27)` 申请 27 个记忆槽位，Dialog 内部要记忆的片段较多（标题、副标题、底部提示、最终 Pane）。
  const $ = _c(27);
  const {
    title,
    subtitle,
    children,
    onCancel,
    color: t1,
    hideInputGuide,
    hideBorder,
    inputGuide,
    isCancelActive: t2
  } = t0;
// 颜色缺省为 `permission`，即 Dialog 默认走「权限」主题色；`isCancelActive` 缺省为 true。
  const color = t1 === undefined ? "permission" : t1;
  const isCancelActive = t2 === undefined ? true : t2;
// 调用退出键绑定钩子，拿到 `exitState`（含 keyName 与 pending 状态）。
  const exitState = useExitOnCtrlCDWithKeybindings(undefined, undefined, isCancelActive);
  let t3;
  if ($[0] !== isCancelActive) {
    t3 = {
      context: "Confirmation",
      isActive: isCancelActive
    };
    $[0] = isCancelActive;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
// 把 Esc/n（`confirm:no`）绑定到 `onCancel`，并带 `Confirmation` 上下文，避免误触其他场景的取消键。
  useKeybinding("confirm:no", onCancel, t3);
  let t4;
// 记忆底部输入提示：pending 时显示「再按 keyName 退出」，否则显示 Enter 确认 / Esc 取消的说明。
  if ($[2] !== exitState.keyName || $[3] !== exitState.pending) {
    t4 = exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline>;
    $[2] = exitState.keyName;
    $[3] = exitState.pending;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const defaultInputGuide = t4;
  let t5;
  if ($[5] !== color || $[6] !== title) {
    t5 = <Text bold={true} color={color}>{title}</Text>;
    $[5] = color;
    $[6] = title;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== subtitle) {
    t6 = subtitle && <Text dimColor={true}>{subtitle}</Text>;
    $[8] = subtitle;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== t5 || $[11] !== t6) {
    t7 = <Box flexDirection="column">{t5}{t6}</Box>;
    $[10] = t5;
    $[11] = t6;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] !== children || $[14] !== t7) {
    t8 = <Box flexDirection="column" gap={1}>{t7}{children}</Box>;
    $[13] = children;
    $[14] = t7;
    $[15] = t8;
  } else {
    t8 = $[15];
  }
  let t9;
// 记忆底部输入提示框：若传了 `inputGuide` 就调用它（注入 exitState），否则用默认的 `defaultInputGuide`。
  if ($[16] !== defaultInputGuide || $[17] !== exitState || $[18] !== hideInputGuide || $[19] !== inputGuide) {
    t9 = !hideInputGuide && <Box marginTop={1}><Text dimColor={true} italic={true}>{inputGuide ? inputGuide(exitState) : defaultInputGuide}</Text></Box>;
    $[16] = defaultInputGuide;
    $[17] = exitState;
    $[18] = hideInputGuide;
    $[19] = inputGuide;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  let t10;
  if ($[21] !== t8 || $[22] !== t9) {
    t10 = <>{t8}{t9}</>;
    $[21] = t8;
    $[22] = t9;
    $[23] = t10;
  } else {
    t10 = $[23];
  }
  const content = t10;
// 若要求隐藏边框，直接返回裸内容，不再套 `Pane` 外框。
  if (hideBorder) {
    return content;
  }
// 否则用 `Pane` 包一层带颜色的外框，得到最终渲染结果 `t11`。
  let t11;
  if ($[24] !== color || $[25] !== content) {
    t11 = <Pane color={color}>{content}</Pane>;
    $[24] = color;
    $[25] = content;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  return t11;
}
// 原文件此处有一行 10044 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。