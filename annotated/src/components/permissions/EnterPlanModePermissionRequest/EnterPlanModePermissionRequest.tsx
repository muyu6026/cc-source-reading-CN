import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { handlePlanModeTransition } from '../../../bootstrap/state.js';
import { Box, Text } from '../../../ink.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { useAppState } from '../../../state/AppState.js';
import { isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { Select } from '../../CustomSelect/index.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
// 进入计划模式的权限弹窗：Claude 请求从执行模式切到 plan 模式做探索与方案设计。与其他权限弹窗一样接 PermissionRequestProps，多一个 workerBadge（子代理徽标）。
export function EnterPlanModePermissionRequest(t0) {
  const $ = _c(18);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    workerBadge
  } = t0;
// 从全局应用状态读当前权限模式：进入 plan 前要记住「从哪个模式来」，批准计划的返回才会切回去。选择器函数被提取为文件尾的 _temp。
  const toolPermissionContextMode = useAppState(_temp);
  let t1;
  if ($[0] !== onDone || $[1] !== onReject || $[2] !== toolPermissionContextMode || $[3] !== toolUseConfirm) {
// handleResponse 是弹窗的全部业务：yes 走批准三连，no 走拒绝三连。函数记忆化依赖四个闭包变量。
    t1 = function handleResponse(value) {
      if (value === "yes") {
// 打点：记录进入计划模式事件与入口方式（tool 表示由工具请求触发，区别于用户主动 shift+tab 切换）；是否启用访谈阶段也一并上报，供 A/B 分析。
        logEvent("tengu_plan_enter", {
          interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
          entryMethod: "tool" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
// 同步 bootstrap 全局状态到 plan 模式——这改的是应用级状态，第 30 行的 setMode 指令改的是权限上下文，两处都要改。
        handlePlanModeTransition(toolPermissionContextMode, "plan");
        onDone();
// onAllow 的第二参数是副作用指令数组：批准工具调用的同时附带一条 setMode 指令，把权限上下文的模式切到 plan 并持久化到 session 级。「批准一个动作」与「切换一个模式」用同一机制表达。
        toolUseConfirm.onAllow({}, [{
          type: "setMode",
          mode: "plan",
          destination: "session"
        }]);
      } else {
// 拒绝三连：onDone 关弹窗、onReject 通知权限系统、onReject 通知工具调用方。三个回调各管一层，缺一会出现弹窗关了但工具还在等的悬挂。
        onDone();
        onReject();
        toolUseConfirm.onReject();
      }
    };
    $[0] = onDone;
    $[1] = onReject;
    $[2] = toolPermissionContextMode;
    $[3] = toolUseConfirm;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const handleResponse = t1;
  let t2;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
// 提示文案分三段且全部进常量槽：说明句、plan 模式会做的四件事（探索代码、识别既有模式、设计策略、提交计划供批准）、承诺句。静态文案只建一次，动态部分只有 Select 的 onChange。
    t2 = <Text>Claude wants to enter plan mode to explore and design an implementation approach.</Text>;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box marginTop={1} flexDirection="column"><Text dimColor={true}>In plan mode, Claude will:</Text><Text dimColor={true}> · Explore the codebase thoroughly</Text><Text dimColor={true}> · Identify existing patterns</Text><Text dimColor={true}> · Design an implementation strategy</Text><Text dimColor={true}> · Present a plan for your approval</Text></Box>;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// 承诺句单独一段：批准计划前不会改任何代码——这是 plan 模式的核心承诺，文案上与上面的动作列表隔开。
    t4 = <Box marginTop={1}><Text dimColor={true}>No code changes will be made until you approve the plan.</Text></Box>;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      label: "Yes, enter plan mode",
      value: "yes" as const
    };
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
// 选项数组：两选项均为字面量常量进槽。第二项文案是 No, start implementing now——拒绝即按原模式直接执行原请求。
    t6 = [t5, {
      label: "No, start implementing now",
      value: "no" as const
    }];
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== handleResponse) {
    t7 = () => handleResponse("no");
    $[10] = handleResponse;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  let t8;
  if ($[12] !== handleResponse || $[13] !== t7) {
// 主体容器：三段文案加 Select。onCancel 映射为 handleResponse 加 no——Esc 等价于点第二项。
    t8 = <Box flexDirection="column" marginTop={1} paddingX={1}>{t2}{t3}{t4}<Box marginTop={1}><Select options={t6} onChange={handleResponse} onCancel={t7} /></Box></Box>;
    $[12] = handleResponse;
    $[13] = t7;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] !== t8 || $[16] !== workerBadge) {
// PermissionDialog color 为 planMode：计划模式弹窗有专属配色，视觉上与普通权限弹窗区分。workerBadge 原样透传。
    t9 = <PermissionDialog color="planMode" title="Enter plan mode?" workerBadge={workerBadge}>{t8}</PermissionDialog>;
    $[15] = t8;
    $[16] = workerBadge;
    $[17] = t9;
  } else {
    t9 = $[17];
  }
  return t9;
}
function _temp(s) {
  return s.toolPermissionContext.mode;
}
// 原文件此处有一行 9420 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。