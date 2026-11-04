import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
type Props = {
  teamsSelected: boolean;
  showHint: boolean;
};

/**
 * Footer status indicator showing teammate count
 * Similar to BackgroundTaskStatus but for teammates
 */
// 页脚队友计数指示：与后台任务状态条同类，但统计的是 teammate
export function TeamStatus(t0) {
  const $ = _c(14);
  const {
    teamsSelected,
    showHint
  } = t0;
  const teamContext = useAppState(_temp);
// 只订阅 teamContext 切片
  let t1;
  if ($[0] !== teamContext) {
    t1 = teamContext ? Object.values(teamContext.teammates).filter(_temp2).length : 0;
// Object.values 计数并过滤掉 team-lead：队长自己不算「队友」，否则数字永远多 1
    $[0] = teamContext;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const totalTeammates = t1;
  if (totalTeammates === 0) {
// 0 个队友时整个指示不渲染
    return null;
  }
  let t2;
  if ($[2] !== showHint || $[3] !== teamsSelected) {
    t2 = showHint && teamsSelected ? <><Text dimColor={true}>· </Text><Text dimColor={true}>Enter to view</Text></> : null;
// 提示只在已选中团队且 showHint 时出现：Enter to view
    $[2] = showHint;
    $[3] = teamsSelected;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const hint = t2;
  const statusText = `${totalTeammates} ${totalTeammates === 1 ? "teammate" : "teammates"}`;
// 单复数处理：1 用 teammate，多则 teammates
  const t3 = teamsSelected ? "selected" : "normal";
  let t4;
  if ($[5] !== statusText || $[6] !== t3 || $[7] !== teamsSelected) {
    t4 = <Text key={t3} color="background" inverse={teamsSelected}>{statusText}</Text>;
// key 随选中态切换（selected 与 normal）：强制重挂载以刷新 inverse 反色渲染
    $[5] = statusText;
    $[6] = t3;
    $[7] = teamsSelected;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== hint) {
    t5 = hint ? <Text> {hint}</Text> : null;
// 提示前补一个空格，与非反色的状态文本分开
    $[9] = hint;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== t4 || $[12] !== t5) {
    t6 = <>{t4}{t5}</>;
    $[11] = t4;
    $[12] = t5;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  return t6;
}
function _temp2(t) {
  return t.name !== "team-lead";
}
function _temp(s) {
  return s.teamContext;
}
// 原文件此处有一行 4992 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。