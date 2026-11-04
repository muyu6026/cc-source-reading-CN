import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useContext } from 'react';
import { Box, NoSelect, Text } from '../ink.js';
import { Ratchet } from './design-system/Ratchet.js';
type Props = {
  children: React.ReactNode;
  height?: number;
};
// MessageResponse：给响应内容加行首的 ⎿ 前缀，并保证同一响应块内不重复加
export function MessageResponse(t0) {
  const $ = _c(8);
  const {
    children,
    height
  } = t0;
  const isMessageResponse = useContext(MessageResponseContext);
// 读上下文判断自己是否已在另一个 MessageResponse 里：是则直接返回 children，避免层层嵌套 ⎿
  if (isMessageResponse) {
    return children;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <NoSelect fromLeftEdge={true} flexShrink={0}><Text dimColor={true}>{"  "}⎿  </Text></NoSelect>;
// 前缀包在 NoSelect 里：鼠标选中复制时不会被带上；flexShrink 为 0 保证不被压缩
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== children) {
    t2 = <Box flexShrink={1} flexGrow={1}>{children}</Box>;
// 内容区 flexShrink 1 加 flexGrow 1：占满剩余宽度，长行可以换行
    $[1] = children;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== height || $[4] !== t2) {
    t3 = <MessageResponseProvider><Box flexDirection="row" height={height} overflowY="hidden">{t1}{t2}</Box></MessageResponseProvider>;
// Provider 包住整个响应块：内部再出现的 MessageResponse 会读到 true
    $[3] = height;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const content = t3;
  if (height !== undefined) {
// 给了 height 就直接返回：固定高度的场景不需要棘轮，高度由外部控制
    return content;
  }
  let t4;
  if ($[6] !== content) {
    t4 = <Ratchet lock="offscreen">{content}</Ratchet>;
// 没给 height 时套 Ratchet 且 lock 为 offscreen：滚动出屏才锁高，流式追加时不抖动
    $[6] = content;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  return t4;
}

// This is a context that is used to determine if the message response
// is rendered as a descendant of another MessageResponse. We use it
// to avoid rendering nested ⎿ characters.
const MessageResponseContext = React.createContext(false);
// MessageResponseContext 默认 false：最外层永远会画 ⎿
function MessageResponseProvider(t0) {
  const $ = _c(2);
  const {
    children
  } = t0;
  let t1;
  if ($[0] !== children) {
    t1 = <MessageResponseContext.Provider value={true}>{children}</MessageResponseContext.Provider>;
// Provider 组件只负责把 value 置 true，children 原样透传
    $[0] = children;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
// 原文件此处有一行 4976 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。