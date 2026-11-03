import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { PastedContent } from '../../utils/config.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import type { OptionWithDescription } from './select.js';
import { SelectInputOption } from './select-input-option.js';
import { SelectOption } from './select-option.js';
import { useMultiSelectState } from './use-multi-select-state.js';
// SelectMultiProps：多选组件的全部属性（选项、提交按钮、导航回调等）。
export type SelectMultiProps<T> = {
  readonly isDisabled?: boolean;
  readonly visibleOptionCount?: number;
  readonly options: OptionWithDescription<T>[];
  readonly defaultValue?: T[];
  readonly onCancel: () => void;
  readonly onChange?: (values: T[]) => void;
  readonly onFocus?: (value: T) => void;
  readonly focusValue?: T;
  /**
   * Text for the submit button. When provided, a submit button is shown and
   * Enter toggles selection (submit only fires when the button is focused).
   * When omitted, Enter submits directly and Space toggles selection.
   */
  readonly submitButtonText?: string;
  /**
   * Callback when user submits. Receives the currently selected values.
   */
// submitButtonText：提供时显示提交按钮，Enter 切换勾选、仅按钮聚焦时才提交。
  readonly onSubmit?: (values: T[]) => void;
  /**
   * When true, hides the numeric indexes next to each option.
   */
  readonly hideIndexes?: boolean;
  /**
   * Callback when user presses down from the last item (submit button).
   * If provided, navigation will not wrap to the first item.
   */
  readonly onDownFromLastItem?: () => void;
  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  readonly onUpFromFirstItem?: () => void;
  /**
   * Focus the last option initially instead of the first.
   */
  readonly initialFocusLast?: boolean;
  /**
   * Callback to open external editor for editing input option values.
   * When provided, ctrl+g will trigger this callback in input options
   * with the current value and a setter function to update the internal state.
   */
  readonly onOpenEditor?: (currentValue: string, setValue: (value: string) => void) => void;
// onImagePaste / onOpenEditor：支持图片粘贴与外部编辑器编辑输入项。
  readonly onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) => void;
  readonly pastedContents?: Record<number, PastedContent>;
  readonly onRemoveImage?: (id: number) => void;
};
// SelectMulti：可多选的列表组件，支持勾选、提交按钮、外部编辑器与图片粘贴。
export function SelectMulti(t0) {
  const $ = _c(44);
  const {
    isDisabled: t1,
    visibleOptionCount: t2,
    options,
    defaultValue: t3,
    onCancel,
    onChange,
    onFocus,
    focusValue,
    submitButtonText,
    onSubmit,
    onDownFromLastItem,
    onUpFromFirstItem,
    initialFocusLast,
    onOpenEditor,
    hideIndexes: t4,
    onImagePaste,
    pastedContents,
    onRemoveImage
  } = t0;
// 默认不可见选项数与默认值：未提供时分别回退为 5 与空数组。
  const isDisabled = t1 === undefined ? false : t1;
  const visibleOptionCount = t2 === undefined ? 5 : t2;
  let t5;
  if ($[0] !== t3) {
    t5 = t3 === undefined ? [] : t3;
    $[0] = t3;
    $[1] = t5;
  } else {
    t5 = $[1];
  }
  const defaultValue = t5;
  const hideIndexes = t4 === undefined ? false : t4;
  let t6;
  if ($[2] !== defaultValue || $[3] !== focusValue || $[4] !== hideIndexes || $[5] !== initialFocusLast || $[6] !== isDisabled || $[7] !== onCancel || $[8] !== onChange || $[9] !== onDownFromLastItem || $[10] !== onFocus || $[11] !== onSubmit || $[12] !== onUpFromFirstItem || $[13] !== options || $[14] !== submitButtonText || $[15] !== visibleOptionCount) {
    t6 = {
      isDisabled,
      visibleOptionCount,
      options,
      defaultValue,
      onChange,
      onCancel,
      onFocus,
      focusValue,
      submitButtonText,
      onSubmit,
      onDownFromLastItem,
      onUpFromFirstItem,
      initialFocusLast,
      hideIndexes
    };
    $[2] = defaultValue;
    $[3] = focusValue;
    $[4] = hideIndexes;
    $[5] = initialFocusLast;
    $[6] = isDisabled;
    $[7] = onCancel;
    $[8] = onChange;
    $[9] = onDownFromLastItem;
    $[10] = onFocus;
    $[11] = onSubmit;
    $[12] = onUpFromFirstItem;
    $[13] = options;
    $[14] = submitButtonText;
    $[15] = visibleOptionCount;
    $[16] = t6;
  } else {
    t6 = $[16];
  }
// 用整理后的配置初始化多选状态机。
  const state = useMultiSelectState(t6);
  let T0;
  let T1;
  let t7;
  let t8;
  let t9;
  if ($[17] !== hideIndexes || $[18] !== isDisabled || $[19] !== onCancel || $[20] !== onImagePaste || $[21] !== onOpenEditor || $[22] !== onRemoveImage || $[23] !== options.length || $[24] !== pastedContents || $[25] !== state) {
    const maxIndexWidth = options.length.toString().length;
    T1 = Box;
    t9 = "column";
    T0 = Box;
    t7 = "column";
// 把可见选项映射成带勾选标记的行，输入型选项走专用渲染。
    t8 = state.visibleOptions.map((option, index) => {
      const isOptionFocused = !isDisabled && state.focusedValue === option.value && !state.isSubmitFocused;
      const isSelected = state.selectedValues.includes(option.value);
      const isFirstVisibleOption = option.index === state.visibleFromIndex;
      const isLastVisibleOption = option.index === state.visibleToIndex - 1;
      const areMoreOptionsBelow = state.visibleToIndex < options.length;
      const areMoreOptionsAbove = state.visibleFromIndex > 0;
      const i = state.visibleFromIndex + index + 1;
      if (option.type === "input") {
        const inputValue = state.inputValues.get(option.value) || "";
        return <Box key={String(option.value)} gap={1}><SelectInputOption option={option} isFocused={isOptionFocused} isSelected={false} shouldShowDownArrow={areMoreOptionsBelow && isLastVisibleOption} shouldShowUpArrow={areMoreOptionsAbove && isFirstVisibleOption} maxIndexWidth={maxIndexWidth} index={i} inputValue={inputValue} onInputChange={value => {
            state.updateInputValue(option.value, value);
          }} onSubmit={_temp} onExit={() => {
            onCancel();
// 普通选项行：序号、勾选框、标签，聚焦时高亮。
          }} layout="compact" onOpenEditor={onOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage}><Text color={isSelected ? "success" : undefined}>[{isSelected ? figures.tick : " "}]{" "}</Text></SelectInputOption></Box>;
      }
      return <Box key={String(option.value)} gap={1}><SelectOption isFocused={isOptionFocused} isSelected={false} shouldShowDownArrow={areMoreOptionsBelow && isLastVisibleOption} shouldShowUpArrow={areMoreOptionsAbove && isFirstVisibleOption} description={option.description}>{!hideIndexes && <Text dimColor={true}>{`${i}.`.padEnd(maxIndexWidth)}</Text>}<Text color={isSelected ? "success" : undefined}>[{isSelected ? figures.tick : " "}]</Text><Text color={isOptionFocused ? "suggestion" : undefined}>{option.label}</Text></SelectOption></Box>;
    });
    $[17] = hideIndexes;
    $[18] = isDisabled;
    $[19] = onCancel;
    $[20] = onImagePaste;
    $[21] = onOpenEditor;
    $[22] = onRemoveImage;
    $[23] = options.length;
    $[24] = pastedContents;
    $[25] = state;
    $[26] = T0;
    $[27] = T1;
    $[28] = t7;
    $[29] = t8;
    $[30] = t9;
  } else {
    T0 = $[26];
    T1 = $[27];
    t7 = $[28];
    t8 = $[29];
    t9 = $[30];
  }
// 组装：选项列表作为纵向容器，提交按钮按需附加在底部。
  let t10;
  if ($[31] !== T0 || $[32] !== t7 || $[33] !== t8) {
    t10 = <T0 flexDirection={t7}>{t8}</T0>;
    $[31] = T0;
    $[32] = t7;
    $[33] = t8;
    $[34] = t10;
  } else {
    t10 = $[34];
  }
  let t11;
  if ($[35] !== onSubmit || $[36] !== state.isSubmitFocused || $[37] !== submitButtonText) {
// 提交按钮：聚焦时显示指针，否则留空；仅在有文本且启用时渲染。
    t11 = submitButtonText && onSubmit && <Box marginTop={0} gap={1}>{state.isSubmitFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}<Box marginLeft={3}><Text color={state.isSubmitFocused ? "suggestion" : undefined} bold={true}>{submitButtonText}</Text></Box></Box>;
    $[35] = onSubmit;
    $[36] = state.isSubmitFocused;
    $[37] = submitButtonText;
    $[38] = t11;
  } else {
    t11 = $[38];
  }
  let t12;
// 最外层把标题与按钮/选项组合成最终纵向布局。
  if ($[39] !== T1 || $[40] !== t10 || $[41] !== t11 || $[42] !== t9) {
    t12 = <T1 flexDirection={t9}>{t10}{t11}</T1>;
    $[39] = T1;
    $[40] = t10;
    $[41] = t11;
    $[42] = t9;
    $[43] = t12;
  } else {
    t12 = $[43];
  }
  return t12;
}
function _temp() {}
// 原文件此处有一行 21796 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。