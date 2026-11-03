// 兜底权限弹窗。所有**没有专属弹窗**的工具（MCP 工具、第三方工具、未来新增工具）都落到这里，所以它只敢给三个最保守的选项：允许一次、允许并记住、拒绝。它同时也是这一族弹窗里最短的一份——因为没有任何领域知识可讲，只剩「允许/拒绝 + 遥测 + 反馈」。
import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useMemo } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Box, Text, useTheme } from '../../ink.js';
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js';
import { env } from '../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../utils/permissions/permissionsLoader.js';
import { truncateToLines } from '../../utils/stringUtils.js';
import { logUnaryEvent } from '../../utils/unaryLogging.js';
import { type UnaryEvent, usePermissionRequestLogging } from './hooks.js';
import { PermissionDialog } from './PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption, type ToolAnalyticsContext } from './PermissionPrompt.js';
import type { PermissionRequestProps } from './PermissionRequest.js';
import { PermissionRuleExplanation } from './PermissionRuleExplanation.js';
// 三个取值用联合类型钉死，而不是用布尔。第三档之所以叫 `yes-dont-ask-again` 而不叫 `always`，是因为这里的「记住」不是命令前缀、而是**整个工具名**——档位语义必须从命名上就跟 Bash 那种前缀规则区分开。
type FallbackOptionValue = 'yes' | 'yes-dont-ask-again' | 'no';
export function FallbackPermissionRequest(t0) {
  const $ = _c(58);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    workerBadge
  } = t0;
  const [theme] = useTheme();
// `originalUserFacingName` 与 `t1`（去掉后缀后的名字）同时保留，是这一小段的核心：显示时用去掉 MCP 后缀的短名（否则标题会长到挤掉正文），但判断「要不要补一个 (MCP) 标注」时还得看原名。一个变量存两份形态，避免后面反复做字符串运算。
  let originalUserFacingName;
  let t1;
  if ($[0] !== toolUseConfirm.input || $[1] !== toolUseConfirm.tool) {
    originalUserFacingName = toolUseConfirm.tool.userFacingName(toolUseConfirm.input as never);
// `endsWith(「 (MCP)」)` 后 `slice(0, -6)` 精确砍掉 6 个字符（空格 + 括号 + 三个字母 + 右括号）。硬编码长度看起来脆，但工具名的后缀格式是内部约定、不会变；换成正则反而每次渲染都要编译。
    t1 = originalUserFacingName.endsWith(" (MCP)") ? originalUserFacingName.slice(0, -6) : originalUserFacingName;
    $[0] = toolUseConfirm.input;
    $[1] = toolUseConfirm.tool;
    $[2] = originalUserFacingName;
    $[3] = t1;
  } else {
    originalUserFacingName = $[2];
    t1 = $[3];
  }
  const userFacingName = t1;
  let t2;
// unaryEvent 是常量对象但被单独放进缓存槽：`usePermissionRequestLogging` 的依赖数组里会拿它做比较，如果每次渲染新建一个对象，那个 hook 内部的 effect 就会每次重跑、每次重发一次「弹窗出现」的遥测。
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      completion_type: "tool_use_single",
      language_name: "none"
    };
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const unaryEvent = t2;
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  let t3;
  if ($[5] !== onDone || $[6] !== onReject || $[7] !== toolUseConfirm) {
    t3 = (value, feedback) => {
// `bb8: switch` 又是编译器的标签块重写：源码里这是一整个 switch，编译器把三个 case 各包成裸块并给 switch 加标签，好让 `break` 能跳到 switch 之外。case 分支里那些大括号不是业务分组，是编译器插的块作用域。
      bb8: switch (value) {
// 允许一次：记遥测（accept）→ 调 onAllow（**第二个参数是空数组**，表示不新增任何规则）→ onDone。第二个参数给空数组而不是省略，是为了让下游能区分「明确不加规则」与「调用方忘了传」。
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
            break bb8;
          }
// 允许并记住：onAllow 第二个参数变成一条 `addRules`，规则里只有 `toolName`、没有 pattern——这正是「整个工具放行」的表达方式。目标写死 `localSettings`（项目本地设置），不是 userSettings：这类兜底放行通常是针对当前项目里的某个 MCP 服务，放到用户级会把临时决定变成全局策略。
        case "yes-dont-ask-again":
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
                toolName: toolUseConfirm.tool.name
              }],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb8;
          }
// 拒绝分支：把 feedback 传给 onReject，然后 onReject 与 onDone 各调一次。**注意这里没有 break**，因为它是最后一个 case，落到 switch 尾部自然结束。上面两个分支都写了 break，是编译器为了保证标签块语义一致而保留的，不是笔误。
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
    $[5] = onDone;
    $[6] = onReject;
    $[7] = toolUseConfirm;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  const handleSelect = t3;
  let t4;
  if ($[9] !== onDone || $[10] !== onReject || $[11] !== toolUseConfirm) {
// Esc/取消走的是另一条路径：它同样记一条 reject 遥测、调 onReject，但**不传 feedback**——因为用户没在输入框里写任何东西。把「拒绝」与「放弃作答」分成两个回调，是为了让上游能区分用户意图（前者是明确否决，后者多半是走神了）。
    t4 = () => {
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
    $[9] = onDone;
    $[10] = onReject;
    $[11] = toolUseConfirm;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  const handleCancel = t4;
  let t5;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = getOriginalCwd();
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const originalCwd = t5;
  let t6;
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
// `shouldShowAlwaysAllowOptions()` 只在启动时求值一次（哨兵缓存）：它读的是权限加载器里的全局策略（例如企业版可能禁止任何「不再询问」）。这个值在整个进程生命周期内不会变，每次渲染都问一遍纯属浪费。
    t6 = shouldShowAlwaysAllowOptions();
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  const showAlwaysAllowOptions = t6;
  let t7;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
// 「Yes」这一项带 `feedbackConfig: { type: 'accept' }`，意味着选中它之后还会多出一个可选的反馈输入框（Tab 打开）。把反馈配置挂在选项上而不是挂在弹窗上，是因为**允许与拒绝要问的问题不一样**：允许时问「顺便说说什么让它更方便」，拒绝时问「为什么不行」。
    t7 = {
      label: "Yes",
      value: "yes",
      feedbackConfig: {
        type: "accept"
      }
    };
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let result;
// 选项数组用 `let result = [t7]` 加 push 的方式拼，而不是一次性三目：因为中间那一项是条件插入。编译器把整段包进 `$[16] !== userFacingName` 的依赖判断里，说明这一项**只依赖工具显示名**——名字不变就不用重建选项数组，避免每次渲染都给 PermissionPrompt 传新引用。
  if ($[16] !== userFacingName) {
    result = [t7];
    if (showAlwaysAllowOptions) {
      const t8 = <Text bold={true}>{userFacingName}</Text>;
      let t9;
      if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
        t9 = <Text bold={true}>{originalCwd}</Text>;
        $[18] = t9;
      } else {
        t9 = $[18];
      }
      let t10;
      if ($[19] !== t8) {
        t10 = {
// 「不再询问」的标签把工具名与原始工作目录都嵌成 React 节点（不是字符串拼接）：这样工具名能加粗、目录能单独配色。文案里两个 `{}` 之间的 `{「 」}` 是显式空格——JSX 换行会把空白吃掉，不加就会变成 `namecommands`。
          label: <Text>Yes, and don't ask again for {t8}{" "}commands in {t9}</Text>,
          value: "yes-dont-ask-again"
        };
        $[19] = t8;
        $[20] = t10;
      } else {
        t10 = $[20];
      }
      result.push(t10);
    }
    let t8;
    if ($[21] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = {
        label: "No",
        value: "no",
        feedbackConfig: {
          type: "reject"
        }
      };
      $[21] = t8;
    } else {
      t8 = $[21];
    }
    result.push(t8);
    $[16] = userFacingName;
    $[17] = result;
  } else {
    result = $[17];
  }
  const options = result;
  let t8;
  if ($[22] !== toolUseConfirm.tool.name) {
    t8 = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name);
    $[22] = toolUseConfirm.tool.name;
    $[23] = t8;
  } else {
    t8 = $[23];
  }
// `isMcp` 传给分析上下文，用来在遥测里把「内置工具」与「MCP 工具」分开统计。注意它用的是 `?? false` 而不是 `|| false`：`isMcp` 若为 undefined 才降级，若显式为 false 要保留原意——两者对下游可能不同。
  const t9 = toolUseConfirm.tool.isMcp ?? false;
  let t10;
  if ($[24] !== t8 || $[25] !== t9) {
    t10 = {
      toolName: t8,
      isMcp: t9
    };
    $[24] = t8;
    $[25] = t9;
    $[26] = t10;
  } else {
    t10 = $[26];
  }
  const toolAnalyticsContext = t10;
  let t11;
  if ($[27] !== theme || $[28] !== toolUseConfirm.input || $[29] !== toolUseConfirm.tool) {
// 正文用 `renderToolUseMessage(input, { verbose: true })`：**verbose 传真**，因为权限弹窗是用户唯一能看清「这工具到底要拿什么参数干什么」的地方，这里省字反而危险。这个渲染由工具自己提供，所以每种工具在这一行里显示的内容与主对话里一致。
    t11 = toolUseConfirm.tool.renderToolUseMessage(toolUseConfirm.input as never, {
      theme,
      verbose: true
    });
    $[27] = theme;
    $[28] = toolUseConfirm.input;
    $[29] = toolUseConfirm.tool;
    $[30] = t11;
  } else {
    t11 = $[30];
  }
  let t12;
  if ($[31] !== originalUserFacingName) {
// 标题行由三段拼成：短名 + 括号里的参数摘要 + 可选的 (MCP) 标注。MCP 标注不是普通的 dim 文本，它是一个独立的 Text 节点——因为主对话里同一工具的标题不带这个后缀，权限弹窗是唯一标注「这是外部服务」的地方。
    t12 = originalUserFacingName.endsWith(" (MCP)") ? <Text dimColor={true}> (MCP)</Text> : "";
    $[31] = originalUserFacingName;
    $[32] = t12;
  } else {
    t12 = $[32];
  }
  let t13;
  if ($[33] !== t11 || $[34] !== t12 || $[35] !== userFacingName) {
    t13 = <Text>{userFacingName}({t11}){t12}</Text>;
    $[33] = t11;
    $[34] = t12;
    $[35] = userFacingName;
    $[36] = t13;
  } else {
    t13 = $[36];
  }
  let t14;
  if ($[37] !== toolUseConfirm.description) {
// 描述统一截断到 **3 行**。这不是排版偏好：权限弹窗的高度直接决定下方选项列表还能剩几行，而选项列表一滚就会让用户看不到「No」这一项。宁可截断描述也不让选项出屏，是这一族弹窗共同的取舍。
    t14 = truncateToLines(toolUseConfirm.description, 3);
    $[37] = toolUseConfirm.description;
    $[38] = t14;
  } else {
    t14 = $[38];
  }
  let t15;
  if ($[39] !== t14) {
    t15 = <Text dimColor={true}>{t14}</Text>;
    $[39] = t14;
    $[40] = t15;
  } else {
    t15 = $[40];
  }
  let t16;
  if ($[41] !== t13 || $[42] !== t15) {
    t16 = <Box flexDirection="column" paddingX={2} paddingY={1}>{t13}{t15}</Box>;
    $[41] = t13;
    $[42] = t15;
    $[43] = t16;
  } else {
    t16 = $[43];
  }
  let t17;
  if ($[44] !== toolUseConfirm.permissionResult) {
// `PermissionRuleExplanation` 只在有 permissionResult 时才渲染（内部自己判空），负责把「为什么弹出来」讲清楚——是没匹配到规则、还是匹配到了 ask 规则。兜底弹窗尤其需要它：用户往往不知道为什么一个陌生工具会突然要权限。
    t17 = <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />;
    $[44] = toolUseConfirm.permissionResult;
    $[45] = t17;
  } else {
    t17 = $[45];
  }
  let t18;
  if ($[46] !== handleCancel || $[47] !== handleSelect || $[48] !== options || $[49] !== toolAnalyticsContext) {
// 正文与选项分开组装，最后一起塞进 PermissionDialog：Dialog 只负责外框、标题、worker 徽章，内容完全由调用方拼。这样所有权限弹窗的外框样式能保持一致，改一次边框全部生效。
    t18 = <PermissionPrompt options={options} onSelect={handleSelect} onCancel={handleCancel} toolAnalyticsContext={toolAnalyticsContext} />;
    $[46] = handleCancel;
    $[47] = handleSelect;
    $[48] = options;
    $[49] = toolAnalyticsContext;
    $[50] = t18;
  } else {
    t18 = $[50];
  }
  let t19;
  if ($[51] !== t17 || $[52] !== t18) {
    t19 = <Box flexDirection="column">{t17}{t18}</Box>;
    $[51] = t17;
    $[52] = t18;
    $[53] = t19;
  } else {
    t19 = $[53];
  }
  let t20;
  if ($[54] !== t16 || $[55] !== t19 || $[56] !== workerBadge) {
// 注意这里**没有任何 hover/焦点状态**：FallbackPermissionRequest 自己不维护光标位置，全交给 PermissionPrompt 内部的选项列表。这是它比 Bash/Edit 那些弹窗简单得多的根本原因——没有编辑框、没有多选、没有预览，所以不需要自己接管键盘。
    t20 = <PermissionDialog title="Tool use" workerBadge={workerBadge}>{t16}{t19}</PermissionDialog>;
    $[54] = t16;
    $[55] = t19;
    $[56] = workerBadge;
    $[57] = t20;
  } else {
    t20 = $[57];
  }
  return t20;
}
// 原文件此处有一行 21464 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。