import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import { getViewedTeammateTask } from '../state/selectors.js';
import { toInkColor } from '../utils/ink.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';

/**
 * Header shown when viewing a teammate's transcript.
 * Displays teammate name (colored), task description, and exit hint.
 */
// 查看某个队友转录时的页头：名字着色、任务描述、退出提示
export function TeammateViewHeader() {
  const $ = _c(14);
  const viewedTeammate = useAppState(_temp);
// useAppState 只取 viewedTeammate 切片：选择器粒度细，其它状态变化不触发本组件重渲染
  if (!viewedTeammate) {
// 没有在查看任何队友时返回 null
    return null;
  }
  let t0;
  if ($[0] !== viewedTeammate.identity.color) {
    t0 = toInkColor(viewedTeammate.identity.color);
// toInkColor 把 agent 的颜色名转成 ink 可用的颜色值
    $[0] = viewedTeammate.identity.color;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const nameColor = t0;
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text>Viewing </Text>;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== nameColor || $[4] !== viewedTeammate.identity.agentName) {
    t2 = <Text color={nameColor} bold={true}>@{viewedTeammate.identity.agentName}</Text>;
// @名字加粗着色：一眼看出当前看的是谁
    $[3] = nameColor;
    $[4] = viewedTeammate.identity.agentName;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true}>{" \xB7 "}<KeyboardShortcutHint shortcut="esc" action="return" /></Text>;
// 中间点分隔加 esc to return 提示：退出路径随手可查
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t2) {
    t4 = <Box>{t1}{t2}{t3}</Box>;
    $[7] = t2;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== viewedTeammate.prompt) {
    t5 = <Text dimColor={true}>{viewedTeammate.prompt}</Text>;
// 第二行暗色显示该队友收到的原始 prompt
    $[9] = viewedTeammate.prompt;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== t4 || $[12] !== t5) {
    t6 = <OffscreenFreeze><Box flexDirection="column" marginBottom={1}>{t4}{t5}</Box></OffscreenFreeze>;
// OffscreenFreeze 包裹：滚出屏幕后冻结重渲染，省掉不可见区域的更新开销
    $[11] = t4;
    $[12] = t5;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  return t6;
}
function _temp(s) {
  return getViewedTeammateTask(s);
}
// 原文件此处有一行 5220 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。