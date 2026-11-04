// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../ink.js';
// `formatNumber` 用于把 token 数格式化成易读的数字（加千分位等）。
import { formatNumber } from '../utils/format.js';
import type { Theme } from '../utils/theme.js';
// Props 字段非常多：智能体类型、名称、描述、工具调用次数、token 数、各种状态标志（已解决/错误/异步/最后一项等）。
type Props = {
  agentType: string;
  description?: string;
  name?: string;
  descriptionColor?: keyof Theme;
  taskDescription?: string;
  toolUseCount: number;
  tokens: number | null;
  color?: keyof Theme;
  isLast: boolean;
  isResolved: boolean;
  isError: boolean;
  isAsync?: boolean;
  shouldAnimate: boolean;
  lastToolInfo?: string | null;
  hideType?: boolean;
};
// AgentProgressLine 是「智能体任务进度」单行展示：树状连接符 + 类型/名称 + 工具次数 + 状态文字。
export function AgentProgressLine(t0) {
// `_c(32)` 申请 32 个记忆槽位，本组件片段较多（状态函数、各段文本、组合行）。
  const $ = _c(32);
  const {
    agentType,
    description,
    name,
    descriptionColor,
    taskDescription,
    toolUseCount,
    tokens,
    color,
    isLast,
    isResolved,
    isAsync: t1,
    lastToolInfo,
    hideType: t2
  } = t0;
  const isAsync = t1 === undefined ? false : t1;
  const hideType = t2 === undefined ? false : t2;
// 树状连接符：最后一项用 `└─`，其余用 `├─`，拼出终端里的树形缩进。
  const treeChar = isLast ? "\u2514\u2500" : "\u251C\u2500";
// `isBackgrounded` 表示「异步且已解决」，即已经后台运行结束。
  const isBackgrounded = isAsync && isResolved;
  let t3;
// 记忆 `getStatusText`：未解决时显示最近工具信息或「初始化中」；后台结束时显示任务描述或「后台运行中」；否则「完成」。
  if ($[0] !== isBackgrounded || $[1] !== isResolved || $[2] !== lastToolInfo || $[3] !== taskDescription) {
    t3 = () => {
      if (!isResolved) {
        return lastToolInfo || "Initializing\u2026";
      }
      if (isBackgrounded) {
        return taskDescription ?? "Running in the background";
      }
      return "Done";
    };
    $[0] = isBackgrounded;
    $[1] = isResolved;
    $[2] = lastToolInfo;
    $[3] = taskDescription;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const getStatusText = t3;
  let t4;
  if ($[5] !== treeChar) {
    t4 = <Text dimColor={true}>{treeChar} </Text>;
    $[5] = treeChar;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const t5 = !isResolved;
  let t6;
// 记忆主体标签行：隐藏类型时显示「名称/描述」，否则显示带背景色的「类型」徽章，并可选附上描述。
  if ($[7] !== agentType || $[8] !== color || $[9] !== description || $[10] !== descriptionColor || $[11] !== hideType || $[12] !== name) {
    t6 = hideType ? <><Text bold={true}>{name ?? description ?? agentType}</Text>{name && description && <Text dimColor={true}>: {description}</Text>}</> : <><Text bold={true} backgroundColor={color} color={color ? "inverseText" : undefined}>{agentType}</Text>{description && <>{" ("}<Text backgroundColor={descriptionColor} color={descriptionColor ? "inverseText" : undefined}>{description}</Text>{")"}</>}</>;
    $[7] = agentType;
    $[8] = color;
    $[9] = description;
    $[10] = descriptionColor;
    $[11] = hideType;
    $[12] = name;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
// 记忆统计行：工具调用次数（单复数）与 token 数，仅在非后台运行时显示。
  let t7;
  if ($[14] !== isBackgrounded || $[15] !== tokens || $[16] !== toolUseCount) {
    t7 = !isBackgrounded && <>{" \xB7 "}{toolUseCount} tool {toolUseCount === 1 ? "use" : "uses"}{tokens !== null && <> · {formatNumber(tokens)} tokens</>}</>;
    $[14] = isBackgrounded;
    $[15] = tokens;
    $[16] = toolUseCount;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
// 记忆状态文字行：用暗显强调「未解决」，并在最后一项/非最后一项用不同竖线字符。
  let t8;
  if ($[18] !== t5 || $[19] !== t6 || $[20] !== t7) {
    t8 = <Text dimColor={t5}>{t6}{t7}</Text>;
    $[18] = t5;
    $[19] = t6;
    $[20] = t7;
    $[21] = t8;
  } else {
    t8 = $[21];
  }
// 记忆整体：把树符行与状态行组合进一个缩进 `Box`，得到最终单行进度 `t11`。
  let t9;
  if ($[22] !== t4 || $[23] !== t8) {
    t9 = <Box paddingLeft={3}>{t4}{t8}</Box>;
    $[22] = t4;
    $[23] = t8;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  let t10;
  if ($[25] !== getStatusText || $[26] !== isBackgrounded || $[27] !== isLast) {
    t10 = !isBackgrounded && <Box paddingLeft={3} flexDirection="row"><Text dimColor={true}>{isLast ? "   \u23BF  " : "\u2502  \u23BF  "}</Text><Text dimColor={true}>{getStatusText()}</Text></Box>;
    $[25] = getStatusText;
    $[26] = isBackgrounded;
    $[27] = isLast;
    $[28] = t10;
  } else {
    t10 = $[28];
  }
  let t11;
  if ($[29] !== t10 || $[30] !== t9) {
    t11 = <Box flexDirection="column">{t9}{t10}</Box>;
    $[29] = t10;
    $[30] = t9;
    $[31] = t11;
  } else {
    t11 = $[31];
  }
  return t11;
}
// 原文件此处有一行 10332 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。