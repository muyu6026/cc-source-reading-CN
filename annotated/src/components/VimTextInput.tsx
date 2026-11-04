// 从 `react/compiler-runtime` 引入编译器运行时。本文件是 React Compiler 的产物，下面的 `_c` 与 `$` 都是它注入的缓存机制，不是手写的 React 代码。
import { c as _c } from "react/compiler-runtime";
// chalk 用于彩色终端输出，这里专门配合 `invert` 反色选项，把光标所在的文字反显。
import chalk from 'chalk';
import React from 'react';
import { useClipboardImageHint } from '../hooks/useClipboardImageHint.js';
// 复用上层的 `useVimInput` 与 `useClipboardImageHint`，本组件只是把输入状态「包一层」做渲染，不持有输入逻辑。
import { useVimInput } from '../hooks/useVimInput.js';
import { Box, color, useTerminalFocus, useTheme } from '../ink.js';
import type { VimTextInputProps } from '../types/textInputTypes.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { BaseTextInput } from './BaseTextInput.js';
export type Props = VimTextInputProps & {
  highlights?: TextHighlight[];
};
// VimTextInput 是带 Vim 键位模式的文本输入框。它负责上色、反色、把 props 整理成一份稳定引用后传给子组件 `BaseTextInput`。
export default function VimTextInput(props) {
// `_c(38)` 申请 38 个编译器记忆槽位 `$`。React Compiler 把每个需要记忆的值（颜色、props 包、回调、渲染结果）按固定下标放进 `$` 数组，靠下标比对依赖是否变化。
  const $ = _c(38);
  const [theme] = useTheme();
  const isTerminalFocused = useTerminalFocus();
  useClipboardImageHint(isTerminalFocused, !!props.onImagePaste);
// React Compiler 把从 props 取出的每个字段单独命名成 `t0`、`t1`……这种带编号的临时变量是编译产物，对应原代码里的 `props.value`、`props.onChange` 等。
  const t0 = props.value;
  const t1 = props.onChange;
  const t2 = props.onSubmit;
  const t3 = props.onExit;
  const t4 = props.onExitMessage;
  const t5 = props.onHistoryReset;
  const t6 = props.onHistoryUp;
  const t7 = props.onHistoryDown;
  const t8 = props.onClearInput;
  const t9 = props.focus;
  const t10 = props.mask;
  const t11 = props.multiline;
  const t12 = props.showCursor ? " " : "";
  const t13 = props.highlightPastedText;
  const t14 = isTerminalFocused ? chalk.inverse : _temp;
// `t15` 计算当前主题色：终端聚焦时用 chalk 反色，否则用透传占位函数 `_temp`。
  let t15;
  if ($[0] !== theme) {
    t15 = color("text", theme);
    $[0] = theme;
    $[1] = t15;
  } else {
    t15 = $[1];
  }
  let t16;
// 本段是整份文件最关键的一处：React Compiler 把「props 对象」的记忆依赖**拍平**成一个超长条件。只要 27 个 props 字段之一变了，就重建对象并刷新 `$[2]..$[28]`；否则直接复用上次的结果 `$[28]`，不重建。
  if ($[2] !== props.columns || $[3] !== props.cursorOffset || $[4] !== props.disableCursorMovementForUpDownKeys || $[5] !== props.disableEscapeDoublePress || $[6] !== props.focus || $[7] !== props.highlightPastedText || $[8] !== props.inputFilter || $[9] !== props.mask || $[10] !== props.maxVisibleLines || $[11] !== props.multiline || $[12] !== props.onChange || $[13] !== props.onChangeCursorOffset || $[14] !== props.onClearInput || $[15] !== props.onExit || $[16] !== props.onExitMessage || $[17] !== props.onHistoryDown || $[18] !== props.onHistoryReset || $[19] !== props.onHistoryUp || $[20] !== props.onImagePaste || $[21] !== props.onModeChange || $[22] !== props.onSubmit || $[23] !== props.onUndo || $[24] !== props.value || $[25] !== t12 || $[26] !== t14 || $[27] !== t15) {
    t16 = {
      value: t0,
      onChange: t1,
      onSubmit: t2,
      onExit: t3,
      onExitMessage: t4,
      onHistoryReset: t5,
      onHistoryUp: t6,
      onHistoryDown: t7,
      onClearInput: t8,
      focus: t9,
      mask: t10,
      multiline: t11,
      cursorChar: t12,
      highlightPastedText: t13,
      invert: t14,
      themeText: t15,
      columns: props.columns,
      maxVisibleLines: props.maxVisibleLines,
      onImagePaste: props.onImagePaste,
      disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
      disableEscapeDoublePress: props.disableEscapeDoublePress,
      externalOffset: props.cursorOffset,
      onOffsetChange: props.onChangeCursorOffset,
      inputFilter: props.inputFilter,
      onModeChange: props.onModeChange,
      onUndo: props.onUndo
    };
    $[2] = props.columns;
    $[3] = props.cursorOffset;
    $[4] = props.disableCursorMovementForUpDownKeys;
    $[5] = props.disableEscapeDoublePress;
    $[6] = props.focus;
    $[7] = props.highlightPastedText;
    $[8] = props.inputFilter;
    $[9] = props.mask;
    $[10] = props.maxVisibleLines;
    $[11] = props.multiline;
    $[12] = props.onChange;
    $[13] = props.onChangeCursorOffset;
    $[14] = props.onClearInput;
    $[15] = props.onExit;
    $[16] = props.onExitMessage;
    $[17] = props.onHistoryDown;
    $[18] = props.onHistoryReset;
    $[19] = props.onHistoryUp;
    $[20] = props.onImagePaste;
    $[21] = props.onModeChange;
    $[22] = props.onSubmit;
    $[23] = props.onUndo;
    $[24] = props.value;
    $[25] = t12;
    $[26] = t14;
    $[27] = t15;
    $[28] = t16;
  } else {
    t16 = $[28];
  }
// 把整理好的稳定 props 包交给 `useVimInput`，由它持有真正的输入状态机（光标、历史、模式切换）。
  const vimInputState = useVimInput(t16);
// 从输入状态里取出当前模式 `mode` 与切模式函数 `setMode`。
  const {
    mode,
    setMode
  } = vimInputState;
// 记忆一个副作用：当 props 要求的初始模式与当前模式不一致时，挂载或更新时把模式重置回 `initialMode`。
  let t17;
  let t18;
  if ($[29] !== mode || $[30] !== props.initialMode || $[31] !== setMode) {
    t17 = () => {
      if (props.initialMode && props.initialMode !== mode) {
        setMode(props.initialMode);
      }
    };
    t18 = [props.initialMode, mode, setMode];
    $[29] = mode;
    $[30] = props.initialMode;
    $[31] = setMode;
    $[32] = t17;
    $[33] = t18;
  } else {
    t17 = $[32];
    t18 = $[33];
  }
// `React.useEffect` 的真正调用点，依赖数组是 `[initialMode, mode, setMode]`——只有这三者变化才重跑重置逻辑。
  React.useEffect(t17, t18);
// 最终把子组件 `BaseTextInput` 包进一个纵向 `Box`，并透传高亮、聚焦、mode 等状态。
  let t19;
  if ($[34] !== isTerminalFocused || $[35] !== props || $[36] !== vimInputState) {
    t19 = <Box flexDirection="column"><BaseTextInput inputState={vimInputState} terminalFocus={isTerminalFocused} highlights={props.highlights} {...props} /></Box>;
    $[34] = isTerminalFocused;
    $[35] = props;
    $[36] = vimInputState;
    $[37] = t19;
  } else {
    t19 = $[37];
  }
// 返回记忆好的渲染结果 `t19`，避免在 props 未变时重复创建 JSX。
  return t19;
}
// `_temp` 是编译器的透传占位：当不需要反色时直接原样返回文字，等价于 `text => text`。
function _temp(text) {
  return text;
}
// 原文件此处有一行 11304 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。