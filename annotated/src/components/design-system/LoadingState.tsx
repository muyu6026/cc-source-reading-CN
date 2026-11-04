import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { Spinner } from '../Spinner.js';
// LoadingState 的 props：message 必填，bold/dimColor 可选，subtitle 可选副标题
type LoadingStateProps = {
  /**
   * The loading message to display next to the spinner.
   */
  message: string;

  /**
   * Display the message in bold.
   * @default false
   */
  bold?: boolean;

  /**
   * Display the message in dimmed color.
   * @default false
   */
  dimColor?: boolean;

  /**
   * Optional subtitle displayed below the main message.
   */
  subtitle?: string;
};

// doc 注释带三个 @example——设计系统组件文档规范：基础用法/加粗/带副标题
/**
 * A spinner with loading message for async operations.
 *
 * @example
 * // Basic loading
 * <LoadingState message="Loading..." />
 *
 * @example
 * // Bold loading message
 * <LoadingState message="Loading sessions" bold />
 *
 * @example
 * // With subtitle
 * <LoadingState
 *   message="Loading sessions"
 *   bold
 *   subtitle="Fetching your Claude Code sessions..."
 * />
 */
// Spinner + 消息 + 可选副标题的异步加载组件
export function LoadingState(t0) {
  const $ = _c(10);
  const {
    message,
    bold: t1,
    dimColor: t2,
    subtitle
  } = t0;
  const bold = t1 === undefined ? false : t1;
// bold/dimColor 默认值展开：t1===undefined?false:t1，等价于解构默认参数 false
  const dimColor = t2 === undefined ? false : t2;
  let t3;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// Spinner 无 props，哨兵缓存一次永久复用
    t3 = <Spinner />;
    $[0] = t3;
  } else {
    t3 = $[0];
  }
  let t4;
  if ($[1] !== bold || $[2] !== dimColor || $[3] !== message) {
    t4 = <Box flexDirection="row">{t3}<Text bold={bold} dimColor={dimColor}>{" "}{message}</Text></Box>;
// 主行是 row 方向：Spinner 后接空格+消息，消息样式由 bold/dimColor 决定
    $[1] = bold;
    $[2] = dimColor;
    $[3] = message;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] !== subtitle) {
    t5 = subtitle && <Text dimColor={true}>{subtitle}</Text>;
// subtitle && Text：无副标题时结果为假不渲染，副标题固定 dim 色
    $[5] = subtitle;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== t4 || $[8] !== t5) {
    t6 = <Box flexDirection="column">{t4}{t5}</Box>;
// 外层 column：主行与副标题纵向排布
    $[7] = t4;
    $[8] = t5;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  return t6;
}
// 原文件此处有一行 4508 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。