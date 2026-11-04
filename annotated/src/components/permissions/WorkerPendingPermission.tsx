import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { getAgentName, getTeammateColor, getTeamName } from '../../utils/teammate.js';
import { Spinner } from '../Spinner.js';
import { WorkerBadge } from './WorkerBadge.js';
type Props = {
  toolName: string;
  description: string;
};

// 文件头块注释：这是队员（worker）等待队长批准权限请求时的视觉指示——显示待批工具名、旋转动画与请求说明。多代理协作里队员侧的「我为什么停着」反馈。
/**
 * Visual indicator shown on workers while waiting for leader to approve a permission request.
 * Displays the pending tool with a spinner and information about what's being requested.
 */
// WorkerPendingPermission：_c(15) 八段缓存，静态段居多，动态的只有工具名与说明两行。
export function WorkerPendingPermission(t0) {
  const $ = _c(15);
  const {
    toolName,
    description
  } = t0;
  let t1;
// 三个身份信息各自进哨兵槽：队名、代理名、队员色在挂载时读一次环境——队员身份在一次会话内不变，无需订阅。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getTeamName();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const teamName = t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getAgentName();
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const agentName = t2;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = getTeammateColor();
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const agentColor = t3;
  let t4;
  let t5;
// 等待行与徽标共用一个槽：spinner 加 warning 色加粗的等待文案；下面条件渲染队员徽标（名字与颜色都有才显示）。
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box marginBottom={1}><Spinner /><Text color="warning" bold={true}>{" "}Waiting for team lead approval</Text></Box>;
    t5 = agentName && agentColor && <Box marginBottom={1}><WorkerBadge name={agentName} color={agentColor} /></Box>;
    $[3] = t4;
    $[4] = t5;
  } else {
    t4 = $[3];
    t5 = $[4];
  }
  let t6;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text dimColor={true}>Tool: </Text>;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
// Tool 行：暗色标签加工具名，工具名单值缓存——等待期间唯一可能变化的信息。
  if ($[6] !== toolName) {
    t7 = <Box>{t6}<Text>{toolName}</Text></Box>;
    $[6] = toolName;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text dimColor={true}>Action: </Text>;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  let t9;
// Action 行：同构的标签加说明。两个动态行各自独立缓存，等待期间队长改了请求描述能单独刷新。
  if ($[9] !== description) {
    t9 = <Box>{t8}<Text>{description}</Text></Box>;
    $[9] = description;
    $[10] = t9;
  } else {
    t9 = $[10];
  }
  let t10;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
// 队名提示：存在才显示，告知请求已发给哪个队的队长——多队场景下队员知道自己属于谁。弯引号包裹队名。
    t10 = teamName && <Box marginTop={1}><Text dimColor={true}>Permission request sent to team {"\""}{teamName}{"\""} leader</Text></Box>;
    $[11] = t10;
  } else {
    t10 = $[11];
  }
  let t11;
  if ($[12] !== t7 || $[13] !== t9) {
// 容器：warning 色圆角边框加内边距——整个指示块在视觉上是「暂停等待授权」而非「出错」，颜色语义与任务状态色一致。
    t11 = <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>{t4}{t5}{t7}{t9}{t10}</Box>;
    $[12] = t7;
    $[13] = t9;
    $[14] = t11;
  } else {
    t11 = $[14];
  }
  return t11;
}
// 原文件此处有一行 6648 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。