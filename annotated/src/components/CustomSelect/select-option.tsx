import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { ListItem } from '../design-system/ListItem.js';
// 复用设计系统的 `ListItem` 渲染单个下拉选项，调用方只需传入焦点、选中、上下箭头等状态。
export type SelectOptionProps = {
  /**
   * Determines if option is focused.
   */
  readonly isFocused: boolean;

  /**
   * Determines if option is selected.
   */
  readonly isSelected: boolean;

  /**
   * Option label.
   */
  readonly children: ReactNode;

  /**
   * Optional description to display below the label.
   */
  readonly description?: string;

  /**
   * Determines if the down arrow should be shown.
   */
  readonly shouldShowDownArrow?: boolean;

  /**
   * Determines if the up arrow should be shown.
   */
  readonly shouldShowUpArrow?: boolean;

  /**
   * Whether ListItem should declare the terminal cursor position.
   * Set false when a child declares its own cursor (e.g. BaseTextInput).
   */
  readonly declareCursor?: boolean;
};
// `SelectOption` 把解构出的各状态直接交给 `ListItem`，统一呈现聚焦、选中、滚动箭头等视觉。
export function SelectOption(t0) {
  const $ = _c(8);
  const {
    isFocused,
    isSelected,
    children,
    description,
    shouldShowDownArrow,
    shouldShowUpArrow,
    declareCursor
  } = t0;
  let t1;
  if ($[0] !== children || $[1] !== declareCursor || $[2] !== description || $[3] !== isFocused || $[4] !== isSelected || $[5] !== shouldShowDownArrow || $[6] !== shouldShowUpArrow) {
    t1 = <ListItem isFocused={isFocused} isSelected={isSelected} description={description} showScrollDown={shouldShowDownArrow} showScrollUp={shouldShowUpArrow} styled={false} declareCursor={declareCursor}>{children}</ListItem>;
    $[0] = children;
    $[1] = declareCursor;
    $[2] = description;
    $[3] = isFocused;
    $[4] = isSelected;
    $[5] = shouldShowDownArrow;
    $[6] = shouldShowUpArrow;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  return t1;
}
// 组件利用 React 编译器的记忆缓存 `_c` 做依赖比对，仅当相关 prop 变化时才重建 JSX。
// 原文件此处有一行 4012 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。