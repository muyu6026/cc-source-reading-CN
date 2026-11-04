// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
// `renderPlaceholder` 负责处理占位符的显示时机（有内容时隐藏占位符）。
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
// `usePasteHandler` 区分「粘贴」与「普通输入」，粘贴时跳过逐字符输入逻辑。
import { usePasteHandler } from '../hooks/usePasteHandler.js';
// `useDeclaredCursor` 声明一个光标引用，供底层终端按声明位置绘制光标。
import { useDeclaredCursor } from '../ink/hooks/use-declared-cursor.js';
import { Ansi, Box, Text, useInput } from '../ink.js';
import type { BaseInputState, BaseTextInputProps } from '../types/textInputTypes.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
// `HighlightedInput` 是带高亮的输入渲染（当有匹配高亮时走这一支）。
import { HighlightedInput } from './PromptInput/ShimmeredInput.js';
type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState;
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
};

/**
 * A base component for text inputs that handles rendering and basic input
 */
// BaseTextInput 是所有文本输入的底层渲染组件：处理光标、占位符、粘贴、高亮，但不持有输入状态机（状态在 `inputState` 里）。
export function BaseTextInput(t0) {
// `_c(14)` 申请 14 个记忆槽位。
  const $ = _c(14);
  const {
    inputState,
    children,
    terminalFocus,
    invert,
    hidePlaceholderText,
    ...props
  } = t0;
// 从 `inputState` 取出渲染所需字段：onInput、已渲染值、光标行列。
  const {
    onInput,
    renderedValue,
    cursorLine,
    cursorColumn
  } = inputState;
// `t1` 标记「光标是否应当激活」：必须同时聚焦、要求显示光标、且终端本身有焦点。
  const t1 = Boolean(props.focus && props.showCursor && terminalFocus);
  let t2;
// 记忆传给 `useDeclaredCursor` 的光标对象 `{line, column, active}`。
  if ($[0] !== cursorColumn || $[1] !== cursorLine || $[2] !== t1) {
    t2 = {
      line: cursorLine,
      column: cursorColumn,
      active: t1
    };
    $[0] = cursorColumn;
    $[1] = cursorLine;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
// 用粘贴处理器包装 onInput：粘贴且按回车时跳过，否则走正常 onInput。
  const cursorRef = useDeclaredCursor(t2);
  const {
    wrappedOnInput,
    isPasting: t3
  } = usePasteHandler({
    onPaste: props.onPaste,
    onInput: (input, key) => {
      if (isPasting && key.return) {
        return;
      }
      onInput(input, key);
    },
    onImagePaste: props.onImagePaste
  });
  const isPasting = t3;
  const {
    onIsPastingChange
  } = props;
// `useEffect` 在 `isPasting` 变化时通知上层 `onIsPastingChange`。
  React.useEffect(() => {
    if (onIsPastingChange) {
      onIsPastingChange(isPasting);
    }
  }, [isPasting, onIsPastingChange]);
  const {
    showPlaceholder,
    renderedPlaceholder
  } = renderPlaceholder({
    placeholder: props.placeholder,
    value: props.value,
    showCursor: props.showCursor,
    focus: props.focus,
    terminalFocus,
    invert,
    hidePlaceholderText
  });
// `useInput(wrappedOnInput, {isActive:focus})` 真正把键盘输入接进来，仅当本组件获得焦点时生效。
  useInput(wrappedOnInput, {
    isActive: props.focus
  });
// `commandWithoutArgs` 判断当前是不是「无参命令」：不含空格、或以空格结尾，决定要不要显示参数提示。
  const commandWithoutArgs = props.value && props.value.trim().indexOf(" ") === -1 || props.value && props.value.endsWith(" ");
  const showArgumentHint = Boolean(props.argumentHint && props.value && commandWithoutArgs && props.value.startsWith("/"));
  const cursorFiltered = props.showCursor && props.highlights ? props.highlights.filter(h => h.dimColor || props.cursorOffset < h.start || props.cursorOffset >= h.end) : props.highlights;
  const {
    viewportCharOffset,
    viewportCharEnd
  } = inputState;
// `filteredHighlights` 按视口偏移把高亮区间换算成当前可见行的相对坐标，避免高亮错位。
  const filteredHighlights = cursorFiltered && viewportCharOffset > 0 ? cursorFiltered.filter(h_0 => h_0.end > viewportCharOffset && h_0.start < viewportCharEnd).map(h_1 => ({
    ...h_1,
    start: Math.max(0, h_1.start - viewportCharOffset),
    end: h_1.end - viewportCharOffset
  })) : cursorFiltered;
  const hasHighlights = filteredHighlights && filteredHighlights.length > 0;
// 若有高亮就走 `HighlightedInput` 分支；否则用 `T0`/`T1` 别名包裹普通 `Text`/`Box` 渲染。
  if (hasHighlights) {
    return <Box ref={cursorRef}><HighlightedInput text={renderedValue} highlights={filteredHighlights} />{showArgumentHint && <Text dimColor={true}>{props.value?.endsWith(" ") ? "" : " "}{props.argumentHint}</Text>}{children}</Box>;
  }
  const T0 = Box;
  const T1 = Text;
  const t4 = "truncate-end";
  const t5 = showPlaceholder && props.placeholderElement ? props.placeholderElement : showPlaceholder && renderedPlaceholder ? <Ansi>{renderedPlaceholder}</Ansi> : <Ansi>{renderedValue}</Ansi>;
  const t6 = showArgumentHint && <Text dimColor={true}>{props.value?.endsWith(" ") ? "" : " "}{props.argumentHint}</Text>;
  let t7;
  if ($[4] !== T1 || $[5] !== children || $[6] !== props || $[7] !== t5 || $[8] !== t6) {
    t7 = <T1 wrap={t4} dimColor={props.dimColor}>{t5}{t6}{children}</T1>;
    $[4] = T1;
    $[5] = children;
    $[6] = props;
    $[7] = t5;
    $[8] = t6;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
  if ($[10] !== T0 || $[11] !== cursorRef || $[12] !== t7) {
    t8 = <T0 ref={cursorRef}>{t7}</T0>;
    $[10] = T0;
    $[11] = cursorRef;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
// 原文件此处有一行 14904 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。