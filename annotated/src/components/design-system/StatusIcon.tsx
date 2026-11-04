import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Text } from '../../ink.js';
// 六种状态类型：success/error/warning/info/pending/loading
type Status = 'success' | 'error' | 'warning' | 'info' | 'pending' | 'loading';
type Props = {
  /**
   * The status to display. Determines both the icon and color.
   *
   * - `success`: Green checkmark (✓)
   * - `error`: Red cross (✗)
   * - `warning`: Yellow warning symbol (⚠)
   * - `info`: Blue info symbol (ℹ)
   * - `pending`: Dimmed circle (○)
   * - `loading`: Dimmed ellipsis (…)
   */
  status: Status;
  /**
   * Include a trailing space after the icon. Useful when followed by text.
   * @default false
   */
  withSpace?: boolean;
};
// STATUS_CONFIG 集中映射：每种状态一对（icon，color），pending/loading 无色（undefined）走暗色
const STATUS_CONFIG: Record<Status, {
  icon: string;
  color: 'success' | 'error' | 'warning' | 'suggestion' | undefined;
}> = {
  success: {
    icon: figures.tick,
    color: 'success'
  },
  error: {
    icon: figures.cross,
    color: 'error'
  },
  warning: {
    icon: figures.warning,
    color: 'warning'
  },
  info: {
    icon: figures.info,
    color: 'suggestion'
// info 借用 suggestion 色：语义色系统里没有 info，用建议蓝代替
  },
  pending: {
    icon: figures.circle,
    color: undefined
  },
  loading: {
    icon: '…',
// loading 直接用字符 … 而非 figures 图标——figures 库没有省略号图标
    color: undefined
  }
};

// doc 注释带三个 @example：官方对设计系统组件的文档规范是给足用法示例
/**
 * Renders a status indicator icon with appropriate color.
 *
 * @example
 * // Success indicator
 * <StatusIcon status="success" />
 *
 * @example
 * // Error with trailing space for text
 * <Text><StatusIcon status="error" withSpace />Failed to connect</Text>
 *
 * @example
 * // Status line pattern
 * <Text>
 *   <StatusIcon status="pending" withSpace />
 *   Waiting for response
 * </Text>
 */
export function StatusIcon(t0) {
  const $ = _c(5);
  const {
    status,
    withSpace: t1
  } = t0;
  const withSpace = t1 === undefined ? false : t1;
// withSpace 默认值处理：编译器把解构默认值展开成 t1===undefined?false:t1，等价于参数默认 false
  const config = STATUS_CONFIG[status];
  const t2 = !config.color;
  const t3 = withSpace && " ";
// withSpace && 空格：假值时结果是 false，JSX 里 false 不渲染，省掉条件渲染分支
  let t4;
  if ($[0] !== config.color || $[1] !== config.icon || $[2] !== t2 || $[3] !== t3) {
    t4 = <Text color={config.color} dimColor={t2}>{config.icon}{t3}</Text>;
// dimColor={t2}：无色状态自动变暗，有颜色与变暗互斥
    $[0] = config.color;
    $[1] = config.icon;
    $[2] = t2;
    $[3] = t3;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  return t4;
}
// 原文件此处有一行 5388 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。