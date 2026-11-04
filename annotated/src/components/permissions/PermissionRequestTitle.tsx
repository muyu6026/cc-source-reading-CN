import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';
type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  workerBadge?: WorkerBadgeProps;
};
// 权限请求标题栏：把标题、副标题与来源徽章（worker）拼成一行或一列文字。
export function PermissionRequestTitle(t0) {
  const $ = _c(13);
  const {
    title,
    subtitle,
    color: t1,
    workerBadge
  } = t0;
  const color = t1 === undefined ? "permission" : t1;
// 颜色默认取 `permission` 主题色，可被传入值覆盖。
  let t2;
  if ($[0] !== color || $[1] !== title) {
    t2 = <Text bold={true} color={color}>{title}</Text>;
    $[0] = color;
    $[1] = title;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== workerBadge) {
    t3 = workerBadge && <Text dimColor={true}>{"\xB7 "}@{workerBadge.name}</Text>;
    $[3] = workerBadge;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t2 || $[6] !== t3) {
    t4 = <Box flexDirection="row" gap={1}>{t2}{t3}</Box>;
    $[5] = t2;
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== subtitle) {
    t5 = subtitle != null && (typeof subtitle === "string" ? <Text dimColor={true} wrap="truncate-start">{subtitle}</Text> : subtitle);
    $[8] = subtitle;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== t4 || $[11] !== t5) {
    t6 = <Box flexDirection="column">{t4}{t5}</Box>;
    $[10] = t4;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  return t6;
}
// 最终把「标题 + 徽章」横排、再与副标题竖排组合输出。
// 原文件此处有一行 4236 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。