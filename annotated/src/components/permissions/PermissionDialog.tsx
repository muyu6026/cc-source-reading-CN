import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';
// 权限对话框外壳：圆角上边框、标题行（可带右侧附加内容）、内容区
type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  titleColor?: keyof Theme;
  innerPaddingX?: number;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
};
// PermissionDialog 被几十个权限请求复用，本文件只定义骨架
export function PermissionDialog(t0) {
  const $ = _c(15);
  const {
    title,
    subtitle,
    color: t1,
    titleColor,
    innerPaddingX: t2,
    workerBadge,
    titleRight,
    children
  } = t0;
  const color = t1 === undefined ? "permission" : t1;
// 默认边框色 permission：权限类弹窗统一主题色
  const innerPaddingX = t2 === undefined ? 1 : t2;
// innerPaddingX 默认 1：内容区左右各留一格
  let t3;
  if ($[0] !== subtitle || $[1] !== title || $[2] !== titleColor || $[3] !== workerBadge) {
    t3 = <PermissionRequestTitle title={title} subtitle={subtitle} color={titleColor} workerBadge={workerBadge} />;
// 标题交给 PermissionRequestTitle：标题、副标题、标题色、worker 徽章都在那里渲染
    $[0] = subtitle;
    $[1] = title;
    $[2] = titleColor;
    $[3] = workerBadge;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t3 || $[6] !== titleRight) {
    t4 = <Box paddingX={1} flexDirection="column"><Box justifyContent="space-between">{t3}{titleRight}</Box></Box>;
// 标题行 justify space-between：titleRight 被推到最右
    $[5] = t3;
    $[6] = titleRight;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== children || $[9] !== innerPaddingX) {
    t5 = <Box flexDirection="column" paddingX={innerPaddingX}>{children}</Box>;
// 内容区单独一层 Box：paddingX 可被调用方覆盖（例如需要贴边的表格）
    $[8] = children;
    $[9] = innerPaddingX;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== color || $[12] !== t4 || $[13] !== t5) {
    t6 = <Box flexDirection="column" borderStyle="round" borderColor={color} borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>{t4}{t5}</Box>;
// 只保留上边框（左 右 底全为 false）：视觉上是一条顶部横线加圆角而不是完整卡片；marginTop 1 与上方内容留白
    $[11] = color;
    $[12] = t4;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
// 原文件此处有一行 5288 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。