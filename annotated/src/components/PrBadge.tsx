import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Link, Text } from '../ink.js';
import type { PrReviewState } from '../utils/ghPrStatus.js';
type Props = {
  number: number;
  url: string;
  reviewState?: PrReviewState;
  bold?: boolean;
};
// PR 徽章组件：渲染可点击的「PR #123」链接，reviewState 决定颜色语义
export function PrBadge(t0) {
  const $ = _c(21);
  const {
    number,
    url,
    reviewState,
    bold
  } = t0;
  let t1;
// getPrStatusColor 把审查状态映射成语义色，无状态返回 undefined
  if ($[0] !== reviewState) {
    t1 = getPrStatusColor(reviewState);
    $[0] = reviewState;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const statusColor = t1;
  const t2 = !statusColor && !bold;
// dimColor 条件：无状态色且非加粗时用暗色——普通未审 PR 不抢眼，有状态才着色
  let t3;
  if ($[2] !== bold || $[3] !== number || $[4] !== statusColor || $[5] !== t2) {
    t3 = <Text color={statusColor} dimColor={t2} bold={bold}>#{number}</Text>;
// label 是无下划线版本，专门用作 Link 的 fallback——不支持超链接的终端里显示纯文本
    $[2] = bold;
    $[3] = number;
    $[4] = statusColor;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const label = t3;
// 第二个 #number 段带 underline：Link 内容用下划线提示可点击，PR 前缀始终暗色
  const t4 = !bold;
  let t5;
  if ($[7] !== t4) {
    t5 = <Text dimColor={t4}>PR</Text>;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  const t6 = !statusColor && !bold;
  let t7;
  if ($[9] !== bold || $[10] !== number || $[11] !== statusColor || $[12] !== t6) {
    t7 = <Text color={statusColor} dimColor={t6} underline={true} bold={bold}>#{number}</Text>;
    $[9] = bold;
    $[10] = number;
    $[11] = statusColor;
    $[12] = t6;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  let t8;
  if ($[14] !== label || $[15] !== t7 || $[16] !== url) {
    t8 = <Link url={url} fallback={label}>{t7}</Link>;
// fallback={label}：ink 的 Link 在终端不支持 OSC 8 超链接时回退显示 label
    $[14] = label;
    $[15] = t7;
    $[16] = url;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  let t9;
  if ($[18] !== t5 || $[19] !== t8) {
    t9 = <Text>{t5}{" "}{t8}</Text>;
// 组装：PR 前缀 + 空格 + Link（内含下划线版 #number）
    $[18] = t5;
    $[19] = t8;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  return t9;
}
// 状态→颜色映射：approved=success（绿）/changes_requested=error（红）/pending=warning（黄）/merged=merged（紫），无状态走暗色
function getPrStatusColor(state?: PrReviewState): 'success' | 'error' | 'warning' | 'merged' | undefined {
  switch (state) {
    case 'approved':
      return 'success';
    case 'changes_requested':
      return 'error';
    case 'pending':
      return 'warning';
    case 'merged':
      return 'merged';
    default:
// default 分支返回 undefined 而非某个具体颜色：让无状态的 PR 保持中性外观
      return undefined;
  }
}
// 原文件此处有一行 5532 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。