// React Compiler 运行时，提供 `$` 记忆化缓存数组（编译产物标志）。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Box, Text, type TextProps } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getRunningTeammatesSorted } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import { formatNumber } from '../../utils/format.js';
// 引入 figures 图标、React、终端尺寸、应用状态与队友任务相关组件。
import { TeammateSpinnerLine } from './TeammateSpinnerLine.js';
import { TEAMMATE_SELECT_HINT } from './teammateSelectHint.js';
// Props：选中索引、是否处于选择模式、是否全部空闲，以及 leader（主控）的活动动词、token 数、空闲态文案。
type Props = {
  selectedIndex?: number;
  isInSelectionMode?: boolean;
  allIdle?: boolean;
  /** Leader's active verb (when leader is actively processing) */
  leaderVerb?: string;
  /** Leader's token count (when leader is actively processing) */
  leaderTokenCount?: number;
  /** Leader's idle status text (when leader is idle, e.g. "✻ Idle for 3s") */
  leaderIdleText?: string;
};
// TeammateSpinnerTree：在输入栏旁渲染「主控 + 各队友」的旋转状态树。无运行中的队友时返回 null（由 early_return_sentinel 提前返回）。
export function TeammateSpinnerTree(t0) {
  const $ = _c(61);
  const {
    selectedIndex,
    isInSelectionMode,
    allIdle,
    leaderVerb,
    leaderTokenCount,
    leaderIdleText
  } = t0;
  const tasks = useAppState(_temp);
  const viewingAgentTaskId = useAppState(_temp2);
  const showTeammateMessagePreview = useAppState(_temp3);
  let T0;
  let isHideSelected;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
  if ($[0] !== allIdle || $[1] !== isInSelectionMode || $[2] !== leaderIdleText || $[3] !== leaderTokenCount || $[4] !== leaderVerb || $[5] !== selectedIndex || $[6] !== showTeammateMessagePreview || $[7] !== tasks || $[8] !== viewingAgentTaskId) {
    t5 = Symbol.for("react.early_return_sentinel");
    bb0: {
// 计算可见队友并按开始时间排序；判断主控是否被前台化或选中、是否高亮，以及是否要隐藏「hide」行（选择模式下聚焦末项时）。
      const teammateTasks = getRunningTeammatesSorted(tasks);
      if (teammateTasks.length === 0) {
        t5 = null;
        break bb0;
      }
// 主控行是否前台化：viewingAgentTaskId 为 undefined 表示主控在前台；是否被选中等状态决定前缀与高亮。
      const isLeaderForegrounded = viewingAgentTaskId === undefined;
      const isLeaderSelected = isInSelectionMode && selectedIndex === -1;
      const isLeaderHighlighted = isLeaderForegrounded || isLeaderSelected;
      isHideSelected = isInSelectionMode === true && selectedIndex === teammateTasks.length;
      T0 = Box;
      t1 = "column";
      t2 = 1;
      const t6 = isLeaderSelected ? "suggestion" : undefined;
      const t7 = isLeaderSelected ? figures.pointer : " ";
      let t8;
      if ($[16] !== isLeaderHighlighted || $[17] !== t6 || $[18] !== t7) {
        t8 = <Text color={t6} bold={isLeaderHighlighted}>{t7}</Text>;
        $[16] = isLeaderHighlighted;
        $[17] = t6;
        $[18] = t7;
        $[19] = t8;
      } else {
        t8 = $[19];
      }
      const t9 = !isLeaderHighlighted;
// 绘制主控行的连接线与名称：高亮时用不同圆角线（├─ 或 ┌─），非高亮用普通角；名称取 team-lead，颜色随是否选中变化。
      const t10 = isLeaderHighlighted ? "\u2552\u2550" : "\u250C\u2500";
      let t11;
      if ($[20] !== isLeaderHighlighted || $[21] !== t10 || $[22] !== t9) {
        t11 = <Text dimColor={t9} bold={isLeaderHighlighted}>{t10}{" "}</Text>;
        $[20] = isLeaderHighlighted;
        $[21] = t10;
        $[22] = t9;
        $[23] = t11;
      } else {
        t11 = $[23];
      }
      const t12 = isLeaderSelected ? "suggestion" : "cyan_FOR_SUBAGENTS_ONLY";
      let t13;
      if ($[24] !== isLeaderHighlighted || $[25] !== t12) {
        t13 = <Text bold={isLeaderHighlighted} color={t12}>team-lead</Text>;
        $[24] = isLeaderHighlighted;
        $[25] = t12;
        $[26] = t13;
      } else {
        t13 = $[26];
      }
      let t14;
      if ($[27] !== isLeaderForegrounded || $[28] !== leaderVerb) {
        t14 = !isLeaderForegrounded && leaderVerb && <Text dimColor={true}>: {leaderVerb}…</Text>;
        $[27] = isLeaderForegrounded;
        $[28] = leaderVerb;
        $[29] = t14;
      } else {
        t14 = $[29];
      }
      let t15;
      if ($[30] !== isLeaderForegrounded || $[31] !== leaderIdleText || $[32] !== leaderVerb) {
        t15 = !isLeaderForegrounded && !leaderVerb && leaderIdleText && <Text dimColor={true}>: {leaderIdleText}</Text>;
        $[30] = isLeaderForegrounded;
        $[31] = leaderIdleText;
        $[32] = leaderVerb;
        $[33] = t15;
      } else {
        t15 = $[33];
      }
      let t16;
      if ($[34] !== isLeaderHighlighted || $[35] !== leaderTokenCount) {
        t16 = leaderTokenCount !== undefined && leaderTokenCount > 0 && <Text dimColor={!isLeaderHighlighted}>{" "}· {formatNumber(leaderTokenCount)} tokens</Text>;
        $[34] = isLeaderHighlighted;
        $[35] = leaderTokenCount;
        $[36] = t16;
      } else {
        t16 = $[36];
      }
      let t17;
      if ($[37] !== isLeaderHighlighted) {
        t17 = isLeaderHighlighted && <Text dimColor={true}> · {TEAMMATE_SELECT_HINT}</Text>;
        $[37] = isLeaderHighlighted;
        $[38] = t17;
      } else {
        t17 = $[38];
      }
      let t18;
      if ($[39] !== isLeaderForegrounded || $[40] !== isLeaderSelected) {
        t18 = isLeaderSelected && !isLeaderForegrounded && <Text dimColor={true}> · enter to view</Text>;
        $[39] = isLeaderForegrounded;
        $[40] = isLeaderSelected;
        $[41] = t18;
      } else {
        t18 = $[41];
      }
      if ($[42] !== t11 || $[43] !== t13 || $[44] !== t14 || $[45] !== t15 || $[46] !== t16 || $[47] !== t17 || $[48] !== t18 || $[49] !== t8) {
        t3 = <Box paddingLeft={3}>{t8}{t11}{t13}{t14}{t15}{t16}{t17}{t18}</Box>;
        $[42] = t11;
        $[43] = t13;
        $[44] = t14;
        $[45] = t15;
        $[46] = t16;
        $[47] = t17;
        $[48] = t18;
        $[49] = t8;
        $[50] = t3;
      } else {
        t3 = $[50];
      }
// 把每个队友映射成 TeammateSpinnerLine：传入是否最后一项、是否选中、是否前台化、是否全部空闲、是否显示消息预览。
      t4 = teammateTasks.map((teammate, index) => <TeammateSpinnerLine key={teammate.id} teammate={teammate} isLast={!isInSelectionMode && index === teammateTasks.length - 1} isSelected={isInSelectionMode && selectedIndex === index} isForegrounded={viewingAgentTaskId === teammate.id} allIdle={allIdle} showPreview={showTeammateMessagePreview} />);
    }
    $[0] = allIdle;
    $[1] = isInSelectionMode;
    $[2] = leaderIdleText;
    $[3] = leaderTokenCount;
    $[4] = leaderVerb;
    $[5] = selectedIndex;
    $[6] = showTeammateMessagePreview;
    $[7] = tasks;
    $[8] = viewingAgentTaskId;
    $[9] = T0;
    $[10] = isHideSelected;
    $[11] = t1;
    $[12] = t2;
    $[13] = t3;
    $[14] = t4;
    $[15] = t5;
  } else {
    T0 = $[9];
    isHideSelected = $[10];
    t1 = $[11];
    t2 = $[12];
    t3 = $[13];
    t4 = $[14];
    t5 = $[15];
  }
// early_return_sentinel：若前面已决定提前返回（如 null），直接返回；否则继续渲染「hide」行与外层 Box。
  if (t5 !== Symbol.for("react.early_return_sentinel")) {
    return t5;
  }
  let t6;
  if ($[51] !== isHideSelected || $[52] !== isInSelectionMode) {
    t6 = isInSelectionMode && <HideRow isSelected={isHideSelected} />;
    $[51] = isHideSelected;
    $[52] = isInSelectionMode;
    $[53] = t6;
  } else {
    t6 = $[53];
  }
  let t7;
  if ($[54] !== T0 || $[55] !== t1 || $[56] !== t2 || $[57] !== t3 || $[58] !== t4 || $[59] !== t6) {
    t7 = <T0 flexDirection={t1} marginTop={t2}>{t3}{t4}{t6}</T0>;
    $[54] = T0;
    $[55] = t1;
    $[56] = t2;
    $[57] = t3;
    $[58] = t4;
    $[59] = t6;
    $[60] = t7;
  } else {
    t7 = $[60];
  }
  return t7;
}
function _temp3(s_1) {
  return s_1.showTeammateMessagePreview;
}
function _temp2(s_0) {
  return s_0.viewingAgentTaskId;
}
function _temp(s) {
  return s.tasks;
}
// HideRow：选择模式下的「hide」折叠行，显示圆角线与 hide 字样，选中时提示 enter 折叠。
function HideRow(t0) {
  const $ = _c(18);
  const {
    isSelected
  } = t0;
  const t1 = isSelected ? "suggestion" : undefined;
  const t2 = isSelected ? figures.pointer : " ";
  let t3;
  if ($[0] !== isSelected || $[1] !== t1 || $[2] !== t2) {
    t3 = <Text color={t1} bold={isSelected}>{t2}</Text>;
    $[0] = isSelected;
    $[1] = t1;
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const t4 = !isSelected;
  const t5 = isSelected ? "\u2558\u2550" : "\u2514\u2500";
  let t6;
  if ($[4] !== isSelected || $[5] !== t4 || $[6] !== t5) {
    t6 = <Text dimColor={t4} bold={isSelected}>{t5}{" "}</Text>;
    $[4] = isSelected;
    $[5] = t4;
    $[6] = t5;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  const t7 = !isSelected;
  let t8;
  if ($[8] !== isSelected || $[9] !== t7) {
    t8 = <Text dimColor={t7} bold={isSelected}>hide</Text>;
    $[8] = isSelected;
    $[9] = t7;
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  let t9;
  if ($[11] !== isSelected) {
    t9 = isSelected && <Text dimColor={true}> · enter to collapse</Text>;
    $[11] = isSelected;
    $[12] = t9;
  } else {
    t9 = $[12];
  }
  let t10;
  if ($[13] !== t3 || $[14] !== t6 || $[15] !== t8 || $[16] !== t9) {
    t10 = <Box paddingLeft={3}>{t3}{t6}{t8}{t9}</Box>;
    $[13] = t3;
    $[14] = t6;
    $[15] = t8;
    $[16] = t9;
    $[17] = t10;
  } else {
    t10 = $[17];
  }
  return t10;
}
// 原文件此处有一行 19480 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。