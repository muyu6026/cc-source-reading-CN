import { c as _c } from "react/compiler-runtime";
// 引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。
import React, { useCallback, useMemo } from 'react';
import { logError } from 'src/utils/log.js';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import { Box, Text } from '../../../ink.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { SKILL_TOOL_NAME } from '../../../tools/SkillTool/constants.js';
import { SkillTool } from '../../../tools/SkillTool/SkillTool.js';
import { env } from '../../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { logUnaryEvent } from '../../../utils/unaryLogging.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption, type ToolAnalyticsContext } from '../PermissionPrompt.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
// 末尾导入 PermissionRuleExplanation：展示该权限命中的规则来源。
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
type SkillOptionValue = 'yes' | 'yes-exact' | 'yes-prefix' | 'no';
// SkillOptionValue：用户可选择的四种结果——同意、精确记住、前缀记住、拒绝。
export function SkillPermissionRequest(props) {
// SkillPermissionRequest 组件：确认是否运行某个 Skill 的权限弹窗。
  const $ = _c(51);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    workerBadge
  } = props;
  const parseInput = _temp;
  let t0;
  if ($[0] !== toolUseConfirm.input) {
    t0 = parseInput(toolUseConfirm.input);
    $[0] = toolUseConfirm.input;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const skill = t0;
// 先用 SkillTool 的输入 schema 解析工具输入，取出 skill 名称。
  const commandObj = toolUseConfirm.permissionResult.behavior === "ask" && toolUseConfirm.permissionResult.metadata && "command" in toolUseConfirm.permissionResult.metadata ? toolUseConfirm.permissionResult.metadata.command : undefined;
// 若权限结果是 ask 且元数据带 command，记录命令行对象用于展示说明。
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      completion_type: "tool_use_single",
      language_name: "none"
    };
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const unaryEvent = t1;
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
// usePermissionRequestLogging 统一上报本次权限请求的遥测事件。
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getOriginalCwd();
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const originalCwd = t2;
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = shouldShowAlwaysAllowOptions();
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const showAlwaysAllowOptions = t3;
// showAlwaysAllowOptions 决定是否展示「不再询问」类选项。
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
      label: "Yes",
      value: "yes",
      feedbackConfig: {
        type: "accept"
      }
    }];
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const baseOptions = t4;
// alwaysAllowOptions：根据 skill 名是否含空格，生成精确或前缀两种「记住」选项。
  let alwaysAllowOptions;
  if ($[6] !== skill) {
    alwaysAllowOptions = [];
    if (showAlwaysAllowOptions) {
      const t5 = <Text bold={true}>{skill}</Text>;
      let t6;
      if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
        t6 = <Text bold={true}>{originalCwd}</Text>;
        $[8] = t6;
      } else {
        t6 = $[8];
      }
      let t7;
      if ($[9] !== t5) {
        t7 = {
          label: <Text>Yes, and don't ask again for {t5} in{" "}{t6}</Text>,
          value: "yes-exact"
        };
        $[9] = t5;
        $[10] = t7;
      } else {
        t7 = $[10];
      }
      alwaysAllowOptions.push(t7);
      const spaceIndex = skill.indexOf(" ");
      if (spaceIndex > 0) {
        const commandPrefix = skill.substring(0, spaceIndex);
        const t8 = commandPrefix + ":*";
        let t9;
        if ($[11] !== t8) {
          t9 = <Text bold={true}>{t8}</Text>;
          $[11] = t8;
          $[12] = t9;
        } else {
          t9 = $[12];
        }
        let t10;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t10 = <Text bold={true}>{originalCwd}</Text>;
          $[13] = t10;
        } else {
          t10 = $[13];
        }
        let t11;
        if ($[14] !== t9) {
          t11 = {
            label: <Text>Yes, and don't ask again for{" "}{t9} commands in{" "}{t10}</Text>,
            value: "yes-prefix"
          };
          $[14] = t9;
          $[15] = t11;
        } else {
          t11 = $[15];
        }
        alwaysAllowOptions.push(t11);
      }
    }
    $[6] = skill;
    $[7] = alwaysAllowOptions;
  } else {
    alwaysAllowOptions = $[7];
  }
  let t5;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      label: "No",
      value: "no",
      feedbackConfig: {
        type: "reject"
      }
    };
    $[16] = t5;
  } else {
    t5 = $[16];
  }
  const noOption = t5;
// noOption 是「拒绝」选项，用于拼到选项列表末尾。
  let t6;
  if ($[17] !== alwaysAllowOptions) {
    t6 = [...baseOptions, ...alwaysAllowOptions, noOption];
    $[17] = alwaysAllowOptions;
    $[18] = t6;
  } else {
    t6 = $[18];
  }
  const options = t6;
// options 把基础选项、记住选项、拒绝选项拼成最终选择列表。
  let t7;
  if ($[19] !== toolUseConfirm.tool.name) {
    t7 = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name);
    $[19] = toolUseConfirm.tool.name;
    $[20] = t7;
  } else {
    t7 = $[20];
  }
  const t8 = toolUseConfirm.tool.isMcp ?? false;
  let t9;
  if ($[21] !== t7 || $[22] !== t8) {
    t9 = {
      toolName: t7,
      isMcp: t8
    };
    $[21] = t7;
    $[22] = t8;
    $[23] = t9;
  } else {
    t9 = $[23];
  }
  const toolAnalyticsContext = t9;
// toolAnalyticsContext 提取工具名与是否 MCP，用于遥测。
  let t10;
  if ($[24] !== onDone || $[25] !== onReject || $[26] !== skill || $[27] !== toolUseConfirm) {
    t10 = (value, feedback) => {
      bb33: switch (value) {
        case "yes":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "accept",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback);
            onDone();
            break bb33;
          }
        case "yes-exact":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "accept",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            toolUseConfirm.onAllow(toolUseConfirm.input, [{
              type: "addRules",
              rules: [{
                toolName: SKILL_TOOL_NAME,
                ruleContent: skill
              }],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb33;
          }
        case "yes-prefix":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "accept",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            const spaceIndex_0 = skill.indexOf(" ");
            const commandPrefix_0 = spaceIndex_0 > 0 ? skill.substring(0, spaceIndex_0) : skill;
            toolUseConfirm.onAllow(toolUseConfirm.input, [{
              type: "addRules",
              rules: [{
                toolName: SKILL_TOOL_NAME,
                ruleContent: `${commandPrefix_0}:*`
              }],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb33;
          }
        case "no":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "reject",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            toolUseConfirm.onReject(feedback);
            onReject();
            onDone();
          }
      }
    };
    $[24] = onDone;
    $[25] = onReject;
    $[26] = skill;
    $[27] = toolUseConfirm;
    $[28] = t10;
  } else {
    t10 = $[28];
  }
  const handleSelect = t10;
// handleSelect：按用户选择执行同意/加规则/拒绝，并上报对应的 unary 事件。
  let t11;
  if ($[29] !== onDone || $[30] !== onReject || $[31] !== toolUseConfirm) {
    t11 = () => {
      logUnaryEvent({
        completion_type: "tool_use_single",
        event: "reject",
        metadata: {
          language_name: "none",
          message_id: toolUseConfirm.assistantMessage.message.id,
          platform: env.platform
        }
      });
      toolUseConfirm.onReject();
      onReject();
      onDone();
    };
    $[29] = onDone;
    $[30] = onReject;
    $[31] = toolUseConfirm;
    $[32] = t11;
  } else {
    t11 = $[32];
  }
  const handleCancel = t11;
// handleCancel：用户取消时上报拒绝事件并触发 onReject/onDone。
  const t12 = `Use skill "${skill}"?`;
// 标题用 Use skill「xxx」? 提示用户即将运行的 Skill 名称。
  let t13;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Text>Claude may use instructions, code, or files from this Skill.</Text>;
    $[33] = t13;
  } else {
    t13 = $[33];
  }
  const t14 = commandObj?.description;
  let t15;
  if ($[34] !== t14) {
    t15 = <Box flexDirection="column" paddingX={2} paddingY={1}><Text dimColor={true}>{t14}</Text></Box>;
    $[34] = t14;
    $[35] = t15;
  } else {
    t15 = $[35];
  }
  let t16;
  if ($[36] !== toolUseConfirm.permissionResult) {
    t16 = <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />;
    $[36] = toolUseConfirm.permissionResult;
    $[37] = t16;
  } else {
    t16 = $[37];
  }
  let t17;
  if ($[38] !== handleCancel || $[39] !== handleSelect || $[40] !== options || $[41] !== toolAnalyticsContext) {
    t17 = <PermissionPrompt options={options} onSelect={handleSelect} onCancel={handleCancel} toolAnalyticsContext={toolAnalyticsContext} />;
    $[38] = handleCancel;
    $[39] = handleSelect;
    $[40] = options;
    $[41] = toolAnalyticsContext;
    $[42] = t17;
  } else {
    t17 = $[42];
  }
  let t18;
  if ($[43] !== t16 || $[44] !== t17) {
    t18 = <Box flexDirection="column">{t16}{t17}</Box>;
    $[43] = t16;
    $[44] = t17;
    $[45] = t18;
  } else {
    t18 = $[45];
  }
  let t19;
  if ($[46] !== t12 || $[47] !== t15 || $[48] !== t18 || $[49] !== workerBadge) {
    t19 = <PermissionDialog title={t12} workerBadge={workerBadge}>{t13}{t15}{t18}</PermissionDialog>;
    $[46] = t12;
    $[47] = t15;
    $[48] = t18;
    $[49] = workerBadge;
    $[50] = t19;
  } else {
    t19 = $[50];
  }
  return t19;
// 返回组装好的权限弹窗：说明 + 命令描述 + 规则来源 + 选项列表。
}
function _temp(input) {
// _temp 解析 skill 工具输入，失败时记日志并返回空串。
  const result = SkillTool.inputSchema.safeParse(input);
  if (!result.success) {
    logError(new Error(`Failed to parse skill tool input: ${result.error.message}`));
    return "";
  }
  return result.data.skill;
}
// 原文件此处有一行 25876 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。