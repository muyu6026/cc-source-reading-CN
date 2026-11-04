import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import React from 'react';
import { Ansi, Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import type { PermissionDecision, PermissionDecisionReason } from '../../utils/permissions/PermissionResult.js';
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js';
import type { Theme } from '../../utils/theme.js';
import ThemedText from '../design-system/ThemedText.js';
export type PermissionRuleExplanationProps = {
// DecisionReasonStrings：权限解释的归一化形状——reasonString 是主句，configString 是「去哪改」的提示，themeColor 存在时主句按主题色渲染纯文本而非 Ansi。
  permissionResult: PermissionDecision;
  toolType: 'tool' | 'command' | 'edit' | 'read';
};
type DecisionReasonStrings = {
  reasonString: string;
  configString?: string;
  /** When set, reasonString is plain text rendered with this theme color instead of <Ansi>. */
  themeColor?: keyof Theme;
};
// stringsForDecisionReason：把六种 PermissionDecisionReason 归一成上面三元组的纯函数。展示层所有分支判断收在这里，组件本体只剩渲染。
function stringsForDecisionReason(reason: PermissionDecisionReason | undefined, toolType: 'tool' | 'command' | 'edit' | 'read'): DecisionReasonStrings | null {
  if (!reason) {
    return null;
  }
// 分类器原因（BASH_CLASSIFIER 或 TRANSCRIPT_CLASSIFIER 特性开启时）：auto-mode 分类器给 error 红色——它是自动批准链路上要求人工确认的环节，视觉上要显眼。
  if ((feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) && reason.type === 'classifier') {
    if (reason.classifier === 'auto-mode') {
      return {
        reasonString: `Auto mode classifier requires confirmation for this ${toolType}.\n${reason.reason}`,
        configString: undefined,
        themeColor: 'error'
      };
    }
    return {
// 其他分类器：分类器名加粗、无主题色、无 configString——分类器阈值不是用户可配置项，不存在「去哪改」的提示。reasonString 里内嵌换行，Ansi 渲染时原样输出两行。
      reasonString: `Classifier ${chalk.bold(reason.classifier)} requires confirmation for this ${toolType}.\n${reason.reason}`,
      configString: undefined
    };
  }
  switch (reason.type) {
// 规则原因：规则值经 permissionRuleValueToString 还原成 Bash 开头这类可读形式加粗显示。configString 按 source 分流——policySettings 是企业策略下发的，用户改不了，所以不给 /permissions 提示。
    case 'rule':
      return {
        reasonString: `Permission rule ${chalk.bold(permissionRuleValueToString(reason.rule.ruleValue))} requires confirmation for this ${toolType}.`,
        configString: reason.rule.source === 'policySettings' ? undefined : '/permissions to update rules'
      };
// hook 原因：附加可选的原因文本与来源标签（方括号暗色），configString 指向 /hooks。hook 名加粗便于在多 hook 环境里定位。
    case 'hook':
      {
        const hookReasonString = reason.reason ? `:\n${reason.reason}` : '.';
        const sourceLabel = reason.hookSource ? ` ${chalk.dim(`[${reason.hookSource}]`)}` : '';
        return {
          reasonString: `Hook ${chalk.bold(reason.hookName)} requires confirmation for this ${toolType}${hookReasonString}${sourceLabel}`,
          configString: '/hooks to update'
        };
      }
// safetyCheck 与 other 合并处理：只显示原始 reason，无配置提示——这两类原因的处置方式在触发侧已经定型。
    case 'safetyCheck':
    case 'other':
      return {
        reasonString: reason.reason,
        configString: undefined
      };
// workingDir 原因：工作目录外操作被拦，提示 /permissions 调整规则。default 返回 null——未知原因类型宁可不给解释也不编一句。
    case 'workingDir':
      return {
        reasonString: reason.reason,
        configString: '/permissions to update rules'
      };
    default:
      return null;
  }
}
// 组件本体：_c(11) 四段缓存。permissionMode 从全局状态读取，仅用于第 89 行的主题色兜底判断。
export function PermissionRuleExplanation(t0) {
  const $ = _c(11);
  const {
    permissionResult,
    toolType
  } = t0;
  const permissionMode = useAppState(_temp);
  const t1 = permissionResult?.decisionReason;
  let t2;
  if ($[0] !== t1 || $[1] !== toolType) {
    t2 = stringsForDecisionReason(t1, toolType);
    $[0] = t1;
    $[1] = toolType;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const strings = t2;
  if (!strings) {
    return null;
  }
// themeColor 兜底：hook 原因加 auto 权限模式时用 warning 色——auto 模式下 hook 拦截是用户唯一的安全阀，黄色警示。stringsForDecisionReason 已给的色（如分类器红）优先。
  const themeColor = strings.themeColor ?? (permissionResult?.decisionReason?.type === "hook" && permissionMode === "auto" ? "warning" : undefined);
  let t3;
  if ($[3] !== strings.reasonString || $[4] !== themeColor) {
// 渲染分流：有 themeColor 走 ThemedText 纯文本；否则走 Ansi 组件——reasonString 里嵌着 chalk 加粗转义序列，Ansi 解析后按序渲染。两条路径产出的段进同一记忆槽。
    t3 = themeColor ? <ThemedText color={themeColor}>{strings.reasonString}</ThemedText> : <Text><Ansi>{strings.reasonString}</Ansi></Text>;
    $[3] = strings.reasonString;
    $[4] = themeColor;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== strings.configString) {
// configString 暗色小字渲染在主句下方——「为什么拦」与「去哪改」一上一下，权限弹窗的信息架构就此完成。
    t4 = strings.configString && <Text dimColor={true}>{strings.configString}</Text>;
    $[6] = strings.configString;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== t3 || $[9] !== t4) {
    t5 = <Box marginBottom={1} flexDirection="column">{t3}{t4}</Box>;
    $[8] = t3;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  return t5;
}
function _temp(s) {
  return s.toolPermissionContext.mode;
}
// 原文件此处有一行 10828 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。