import { c as _c } from "react/compiler-runtime";
import React, { createContext, isValidElement, type ReactNode, useContext } from 'react';
import { Box } from '../../ink.js';
import { OrderedListItem, OrderedListItemContext } from './OrderedListItem.js';
// OrderedListContext 默认 marker 为空串：根列表的父标记是空
const OrderedListContext = createContext({
  marker: ''
});
type OrderedListProps = {
  children: ReactNode;
};
// OrderedList 组件：给每个子项算编号标记，支持嵌套（父标记拼在子标记前）
function OrderedListComponent(t0) {
  const $ = _c(9);
  const {
    children
  } = t0;
  const {
    marker: parentMarker
  } = useContext(OrderedListContext);
  let numberOfItems = 0;
  for (const child of React.Children.toArray(children)) {
// 先数一遍真正的 OrderedListItem 子元素：文本或其它组件不计入编号
    if (!isValidElement(child) || child.type !== OrderedListItem) {
      continue;
    }
    numberOfItems++;
  }
  const maxMarkerWidth = String(numberOfItems).length;
// maxMarkerWidth 取总数的位数：编号用 padStart 对齐，十项时 1 要变 01 才能对齐
  let t1;
  if ($[0] !== children || $[1] !== maxMarkerWidth || $[2] !== parentMarker) {
    let t2;
    if ($[4] !== maxMarkerWidth || $[5] !== parentMarker) {
      t2 = (child_0, index) => {
        if (!isValidElement(child_0) || child_0.type !== OrderedListItem) {
          return child_0;
        }
        const paddedMarker = `${String(index + 1).padStart(maxMarkerWidth)}.`;
// paddedMarker 是补零后的编号加点
        const marker = `${parentMarker}${paddedMarker}`;
// marker 把父标记拼在前面：嵌套列表就成了层级编号
        return <OrderedListContext.Provider value={{
// 同时提供两个 Context：列表层给下一级用，Item 层给自身用——一个值两处消费
          marker
        }}><OrderedListItemContext.Provider value={{
            marker
          }}>{child_0}</OrderedListItemContext.Provider></OrderedListContext.Provider>;
      };
      $[4] = maxMarkerWidth;
      $[5] = parentMarker;
      $[6] = t2;
    } else {
      t2 = $[6];
    }
    t1 = React.Children.map(children, t2);
// 用 Children.map 而非普通 map：只遍历直接子元素，非列表项原样返回
    $[0] = children;
    $[1] = maxMarkerWidth;
    $[2] = parentMarker;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[7] !== t1) {
    t2 = <Box flexDirection="column">{t1}</Box>;
    $[7] = t1;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  return t2;
}

// eslint 注释豁免顶层副作用：给组件挂静态属性算副作用，但这是 React 生态的惯用写法
// eslint-disable-next-line custom-rules/no-top-level-side-effects
OrderedListComponent.Item = OrderedListItem;
// Item 挂到组件上，导出的是改名后的 OrderedListComponent：这样 OrderedList.Item 可用，组件本身仍叫 OrderedList
export const OrderedList = OrderedListComponent;
// 原文件此处有一行 5244 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。