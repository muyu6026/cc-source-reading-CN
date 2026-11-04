import { c as _c } from "react/compiler-runtime";
import React, { Children, isValidElement } from 'react';
import { Text } from '../../ink.js';
// Props 只有 children：需要串联的若干项
type Props = {
  /** The items to join with a middot separator */
  children: React.ReactNode;
};

// doc 注释解释命名来源（出版业的 byline 署名行），并强调自动过滤 null/undefined/false，分隔符只出现在有效元素之间
/**
 * Joins children with a middot separator (" · ") for inline metadata display.
 *
 * Named after the publishing term "byline" - the line of metadata typically
 * shown below a title (e.g., "John Doe · 5 min read · Mar 12").
 *
 * Automatically filters out null/undefined/false children and only renders
 * separators between valid elements.
 *
 * @example
 * // Basic usage: "Enter to confirm · Esc to cancel"
 * <Text dimColor>
 *   <Byline>
 *     <KeyboardShortcutHint shortcut="Enter" action="confirm" />
 *     <KeyboardShortcutHint shortcut="Esc" action="cancel" />
 *   </Byline>
 * </Text>
 *
 * @example
 * // With conditional children: "Esc to cancel" (only one item shown)
 * <Text dimColor>
 *   <Byline>
 *     {showEnter && <KeyboardShortcutHint shortcut="Enter" action="confirm" />}
 *     <KeyboardShortcutHint shortcut="Esc" action="cancel" />
 *   </Byline>
 * </Text>
 *
 */
export function Byline(t0) {
  const $ = _c(5);
  const {
    children
  } = t0;
  let t1;
  let t2;
  if ($[0] !== children) {
    t2 = Symbol.for("react.early_return_sentinel");
// early_return_sentinel：编译器把提前 return 重写成哨兵值加 break bb0，配合后面的 t2 判断
    bb0: {
      const validChildren = Children.toArray(children);
// Children.toArray 会滤掉 null/undefined/布尔：这正是「条件子元素只剩一项时不出现多余分隔符」的实现基础
      if (validChildren.length === 0) {
// 没有有效子元素时整体返回 null，调用方不必自己判空
        t2 = null;
        break bb0;
      }
      t1 = validChildren.map(_temp);
// map 出带分隔符的片段序列
    }
    $[0] = children;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
// 哨兵比对成立说明走了提前 return，直接返回 null
    return t2;
  }
  let t3;
  if ($[3] !== t1) {
    t3 = <>{t1}</>;
    $[3] = t1;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
function _temp(child, index) {
  return <React.Fragment key={isValidElement(child) ? child.key ?? index : index}>{index > 0 && <Text dimColor={true}> · </Text>}{child}</React.Fragment>;
// _temp 负责加分隔符：index 大于 0 才加中间点，key 优先用子元素自带的 key 否则用下标
}
// 原文件此处有一行 4484 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。