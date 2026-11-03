// React Compiler 运行时，提供 `$` 记忆化缓存数组。
import { c as _c } from "react/compiler-runtime";
import React, { useMemo } from 'react';
// 引入 ink 组件、WebFetch 工具、权限加载器与 Select、权限相关组件。
import { Box, Text, useTheme } from '../../../ink.js';
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { type OptionWithDescription, Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { logUnaryPermissionEvent } from '../utils.js';
// inputToPermissionRuleContent：把工具输入转成权限规则内容——解析出 URL 的主机名，生成 `domain:主机名`；解析失败则用 `input:原始字符串`。
function inputToPermissionRuleContent(input: {
  [k: string]: unknown;
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return `input:${input.toString()}`;
    }
    const {
      url
    } = parsedInput.data;
    const hostname = new URL(url).hostname;
    return `domain:${hostname}`;
  } catch {
    return `input:${input.toString()}`;
  }
}
// WebFetchPermissionRequest：WebFetch 工具的权限请求对话框。展示要抓取的 URL、是否提供「不再询问此域名」选项，并处理接受与拒绝。
export function WebFetchPermissionRequest(t0) {
  const $ = _c(41);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    verbose,
    workerBadge
  } = t0;
  const [theme] = useTheme();
  const {
    url
  } = toolUseConfirm.input as {
    url: string;
  };
  let t1;
// 从 url 解析出 hostname，复用缓存避免重复构造 URL 对象。
  if ($[0] !== url) {
    t1 = new URL(url);
    $[0] = url;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const hostname = t1.hostname;
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      completion_type: "tool_use_single",
      language_name: "none"
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const unaryEvent = t2;
// usePermissionRequestLogging：上报这次权限请求（tool_use_single、无语言）。
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = shouldShowAlwaysAllowOptions();
    $[3] = t3;
  } else {
    t3 = $[3];
  }
// shouldShowAlwaysAllowOptions：是否展示「不再询问」选项（由全局权限设置决定）。
  const showAlwaysAllowOptions = t3;
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      label: "Yes",
      value: "yes"
    };
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let result;
// 构造选项列表：基础 Yes；若允许常驻则追加「Yes, and do not ask again for 域名」；最后 No（esc 拒绝）。
  if ($[5] !== hostname) {
    result = [t4];
    if (showAlwaysAllowOptions) {
      const t5 = <Text bold={true}>{hostname}</Text>;
      let t6;
      if ($[7] !== t5) {
        t6 = {
          label: <Text>Yes, and don't ask again for {t5}</Text>,
          value: "yes-dont-ask-again-domain"
        };
        $[7] = t5;
        $[8] = t6;
      } else {
        t6 = $[8];
      }
      result.push(t6);
    }
    let t5;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = {
        label: <Text>No, and tell Claude what to do differently <Text bold={true}>(esc)</Text></Text>,
        value: "no"
      };
      $[9] = t5;
    } else {
      t5 = $[9];
    }
    result.push(t5);
    $[5] = hostname;
    $[6] = result;
  } else {
    result = $[6];
  }
  const options = result;
  let t5;
  if ($[10] !== onDone || $[11] !== onReject || $[12] !== toolUseConfirm) {
// onChange：根据选择分支——yes 直接允许；yes-dont-ask-again-domain 在 localSettings 写入一条 allow 规则后再允许；no 上报拒绝并回调。
    t5 = function onChange(newValue) {
      bb8: switch (newValue) {
        case "yes":
          {
            logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "accept");
            toolUseConfirm.onAllow(toolUseConfirm.input, []);
            onDone();
            break bb8;
          }
        case "yes-dont-ask-again-domain":
          {
            logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "accept");
            const ruleContent = inputToPermissionRuleContent(toolUseConfirm.input);
            const ruleValue = {
              toolName: toolUseConfirm.tool.name,
              ruleContent
            };
            toolUseConfirm.onAllow(toolUseConfirm.input, [{
              type: "addRules",
              rules: [ruleValue],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb8;
          }
        case "no":
          {
            logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "reject");
            toolUseConfirm.onReject();
            onReject();
            onDone();
          }
      }
    };
    $[10] = onDone;
    $[11] = onReject;
    $[12] = toolUseConfirm;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const onChange = t5;
  let t6;
// 渲染工具调用消息（URL + prompt），按主题与 verbose 控制详细度。
  if ($[14] !== theme || $[15] !== toolUseConfirm.input || $[16] !== verbose) {
    t6 = WebFetchTool.renderToolUseMessage(toolUseConfirm.input as {
      url: string;
      prompt: string;
    }, {
      theme,
      verbose
    });
    $[14] = theme;
    $[15] = toolUseConfirm.input;
    $[16] = verbose;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  let t7;
  if ($[18] !== t6) {
    t7 = <Text>{t6}</Text>;
    $[18] = t6;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  let t8;
// 展示工具描述（dim 色）。
  if ($[20] !== toolUseConfirm.description) {
    t8 = <Text dimColor={true}>{toolUseConfirm.description}</Text>;
    $[20] = toolUseConfirm.description;
    $[21] = t8;
  } else {
    t8 = $[21];
  }
  let t9;
  if ($[22] !== t7 || $[23] !== t8) {
    t9 = <Box flexDirection="column" paddingX={2} paddingY={1}>{t7}{t8}</Box>;
    $[22] = t7;
    $[23] = t8;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  let t10;
// 展示权限规则解释（为何允许或拒绝）。
  if ($[25] !== toolUseConfirm.permissionResult) {
    t10 = <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />;
    $[25] = toolUseConfirm.permissionResult;
    $[26] = t10;
  } else {
    t10 = $[26];
  }
  let t11;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text>Do you want to allow Claude to fetch this content?</Text>;
    $[27] = t11;
  } else {
    t11 = $[27];
  }
// Esc 取消映射为选 no。
  let t12;
  if ($[28] !== onChange) {
    t12 = () => onChange("no");
    $[28] = onChange;
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  let t13;
  if ($[30] !== onChange || $[31] !== options || $[32] !== t12) {
    t13 = <Select options={options} onChange={onChange} onCancel={t12} />;
    $[30] = onChange;
    $[31] = options;
    $[32] = t12;
    $[33] = t13;
  } else {
    t13 = $[33];
  }
// 组装 PermissionDialog：工具消息 + 规则解释 + 询问文案 + Select，标题为 Fetch。
  let t14;
  if ($[34] !== t10 || $[35] !== t13) {
    t14 = <Box flexDirection="column">{t10}{t11}{t13}</Box>;
    $[34] = t10;
    $[35] = t13;
    $[36] = t14;
  } else {
    t14 = $[36];
  }
  let t15;
  if ($[37] !== t14 || $[38] !== t9 || $[39] !== workerBadge) {
    t15 = <PermissionDialog title="Fetch" workerBadge={workerBadge}>{t9}{t14}</PermissionDialog>;
    $[37] = t14;
    $[38] = t9;
    $[39] = workerBadge;
    $[40] = t15;
  } else {
    t15 = $[40];
  }
  return t15;
}
// 原文件此处有一行 16216 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。