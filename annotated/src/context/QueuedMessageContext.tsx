import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box } from '../ink.js';
// 引入 React 编译器运行时、React 与 ink 的 Box
type QueuedMessageContextValue = {
// 上下文值类型：是否排队中、是否首条、容器内边距宽度
  isQueued: boolean;
  isFirst: boolean;
  /** Width reduction for container padding (e.g., 4 for paddingX={2}) */
// paddingWidth 是容器横向内边距的收缩量（paddingX=2 时为 4）
  paddingWidth: number;
};
const QueuedMessageContext = React.createContext<QueuedMessageContextValue | undefined>(undefined);
// 创建排队消息上下文（初值 undefined）
export function useQueuedMessage() {
// useQueuedMessage：读取当前排队上下文
  return React.useContext(QueuedMessageContext);
}
const PADDING_X = 2;
type Props = {
  isFirst: boolean;
  useBriefLayout?: boolean;
  children: React.ReactNode;
};
export function QueuedMessageProvider(t0) {
// QueuedMessageProvider：按布局决定内边距并注入上下文
  const $ = _c(9);
  const {
    isFirst,
    useBriefLayout,
    children
  } = t0;
  const padding = useBriefLayout ? 0 : PADDING_X;
// Brief 布局下 padding 归零，否则用常量
  const t1 = padding * 2;
  let t2;
  if ($[0] !== isFirst || $[1] !== t1) {
    t2 = {
      isQueued: true,
      isFirst,
      paddingWidth: t1
    };
    $[0] = isFirst;
    $[1] = t1;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const value = t2;
// value 绑定（isQueued / isFirst / paddingWidth）
  let t3;
  if ($[3] !== children || $[4] !== padding) {
    t3 = <Box paddingX={padding}>{children}</Box>;
    $[3] = children;
    $[4] = padding;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
// t4：用 Provider 包裹带 padding 的子节点
  if ($[6] !== t3 || $[7] !== value) {
    t4 = <QueuedMessageContext.Provider value={value}>{t3}</QueuedMessageContext.Provider>;
    $[6] = t3;
    $[7] = value;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  return t4;
// 返回 Provider 包裹后的节点
}
// 原文件此处有一行 4140 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。