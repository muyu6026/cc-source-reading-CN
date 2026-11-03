// 本文件是权限决策的「法医报告」：当用户想知道某条命令为什么被允许、为什么被拦、为什么弹了框，这里把决策原因、建议、以及「你写的规则里哪些永远不会生效」逐条摊开。四个组件由内到外：原因转文字、原因条目、建议规则摘要、建议明细。整份文件的技术看点有两个——一是决策原因有十种类型，每种都要翻成人话；二是复合命令把原因做成了递归结构，渲染时必须自己处理嵌套。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import figures from 'figures';
import React, { useMemo } from 'react';
import { Ansi, Box, color, Text, useTheme } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js';
import { permissionModeTitle } from '../../utils/permissions/PermissionMode.js';
import type { PermissionDecision, PermissionDecisionReason } from '../../utils/permissions/PermissionResult.js';
import { extractRules } from '../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js';
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js';
import { detectUnreachableRules } from '../../utils/permissions/shadowedRuleDetection.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettingSourceDisplayNameLowercase } from '../../utils/settings/constants.js';
// 原因条目的属性：可选的标题（用来在调试面板里加一行小标题）加上必填的决策原因。标题可选是因为同一个组件既用于顶层原因，也用于子命令的缩进原因，后者不需要再加标题。
type PermissionDecisionInfoItemProps = {
  title?: string;
  decisionReason: PermissionDecisionReason;
};
// 把决策原因翻成一行可读文字。函数签名的类型约束很值得注意：它把「子命令结果」这一种从入参类型里排除掉了——也就是说这个函数只负责叶子原因，复合原因由调用方自己递归。这种「在类型层面禁掉递归分支」的做法，比在函数体里加一句判断要可靠得多。
function decisionReasonDisplayString(decisionReason: PermissionDecisionReason & {
  type: Exclude<PermissionDecisionReason['type'], 'subcommandResults'>;
}): string {
// 分类器原因在进入 switch 之前被单独拦掉：只有在两个特性开关任一开启时才认这种类型。之所以不放进 switch，是因为它依赖编译期特性开关，如果放进 switch，外部构建里会留下一个永不命中的分支。
  if ((feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) && decisionReason.type === 'classifier') {
    return `${chalk.bold(decisionReason.classifier)} classifier: ${decisionReason.reason}`;
  }
// 十种原因的翻译表。结构上分成三类：带具体规则或工具名的（规则、权限提示工具、钩子），带模式名的（模式），以及只有一段自由文本的（工作目录、安全检查、其他、异步代理）。读的时候注意每种类型的输出都尽量包含「是什么」与「从哪来」两个信息，这是让用户能自己动手修的前提。
  switch (decisionReason.type) {
    case 'rule':
// 规则类原因同时给出规则内容与来源（本地设置、项目设置、用户设置等），来源被翻成小写短语。用户看到「来自项目设置」就能立刻想到去哪个文件改，这是这条信息存在的全部意义。
      return `${chalk.bold(permissionRuleValueToString(decisionReason.rule.ruleValue))} rule from ${getSettingSourceDisplayNameLowercase(decisionReason.rule.source)}`;
    case 'mode':
      return `${permissionModeTitle(decisionReason.mode)} mode`;
    case 'sandboxOverride':
      return 'Requires permission to bypass sandbox';
    case 'workingDir':
      return decisionReason.reason;
    case 'safetyCheck':
    case 'other':
      return decisionReason.reason;
    case 'permissionPromptTool':
      return `${chalk.bold(decisionReason.permissionPromptToolName)} permission prompt tool`;
// 钩子类原因是唯一「有原因则带原因、无原因则只报名字」的分支：钩子可以只返回允许或拒绝而不解释，此时不该拼出一个空的冒号。这类细节在调试信息里尤其重要，因为空字符串会让用户以为信息丢了。
    case 'hook':
      return decisionReason.reason ? `${chalk.bold(decisionReason.hookName)} hook: ${decisionReason.reason}` : `${chalk.bold(decisionReason.hookName)} hook`;
    case 'asyncAgent':
      return decisionReason.reason;
    default:
      return '';
  }
}
// 原因条目组件：先取主题（用于给对勾与叉号上色），再按类型分派到两种渲染——子命令结果走递归列表，其余走一行文字。整个组件只有一个记忆化槽包住格式化函数，其余都是把结果拼进盒子。
function PermissionDecisionInfoItem(t0) {
  const $ = _c(10);
  const {
    title,
    decisionReason
  } = t0;
  const [theme] = useTheme();
  let t1;
  if ($[0] !== decisionReason || $[1] !== theme) {
    t1 = function formatDecisionReason() {
// 这里第二层分派只处理两类：子命令结果与其它。注意子命令结果这一支返回的是列表，每一项自己又是一行「图标加子命令」，若该子命令还有自己的原因就再缩进一层继续递归——递归的终止条件由上面那个把子命令结果排除掉的类型约束保证。
      switch (decisionReason.type) {
// 子命令结果分支：把结果映射成「条目数组」再逐条渲染。用 Array.from 包一层而不是直接遍历映射，是因为底层是映射结构而不是普通对象，直接展开拿不到键值对。
        case "subcommandResults":
          {
            return <Box flexDirection="column">{Array.from(decisionReason.reasons.entries()).map(t2 => {
                const [subcommand, result] = t2;
// 每条子命令的图标由行为决定：允许给对勾并用成功色，其余给叉号并用错误色。注意颜色是通过主题函数算出来的着色器包在图形常量外面，而不是给文本加颜色属性——这是因为图标本身是字符串，只有包一层着色才能上色。
                const icon = result.behavior === "allow" ? color("success", theme)(figures.tick) : color("error", theme)(figures.cross);
// 单条子命令的渲染：第一行是「图标加子命令原文」，第二行是可选的原因（缩进两个空格加一个转角符号），第三行是可选的建议规则。三层都用同一个纵向盒子叠起来，所以整块读起来像一棵树。缩进用的是空格字面量而不是内边距，是为了让转角符号与上一层严格对齐。
                return <Box flexDirection="column" key={subcommand}><Text>{icon} {subcommand}</Text>{result.decisionReason !== undefined && result.decisionReason.type !== "subcommandResults" && <Text><Text dimColor={true}>{"  "}⎿{"  "}</Text><Ansi>{decisionReasonDisplayString(result.decisionReason)}</Ansi></Text>}{result.behavior === "ask" && <SuggestedRules suggestions={result.suggestions} />}</Box>;
              })}</Box>;
          }
        default:
          {
            return <Text><Ansi>{decisionReasonDisplayString(decisionReason)}</Ansi></Text>;
          }
      }
    };
    $[0] = decisionReason;
    $[1] = theme;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const formatDecisionReason = t1;
  let t2;
  if ($[3] !== title) {
    t2 = title && <Text>{title}</Text>;
    $[3] = title;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== formatDecisionReason) {
    t3 = formatDecisionReason();
    $[5] = formatDecisionReason;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t2 || $[8] !== t3) {
    t4 = <Box flexDirection="column">{t2}{t3}</Box>;
    $[7] = t2;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  return t4;
}
// 建议规则摘要组件：把建议里的规则提取出来，用逗号连成一行，前面加转角符号。如果一条规则都提不出来就整体返回空——注意这里用的是「早期返回哨兵」而不是普通的提前 return，因为组件的记忆化槽必须在所有路径上被填满，哨兵就是编译器表达提前返回的方式。
function SuggestedRules(t0) {
  const $ = _c(18);
  const {
    suggestions
  } = t0;
  let T0;
  let T1;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
// 进入哨兵区：先放哨兵，再在带标签的块里做真正的判断。块结束前如果命中「空规则」就把哨兵换成空值，之后统一在块外检查哨兵——这就是编译器改写提前返回的固定形态，读的时候把「哨兵赋值」当成 return 即可。
  if ($[0] !== suggestions) {
    t5 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const rules = extractRules(suggestions);
// 规则为空时直接置空值并跳出：没有规则就没有摘要行，不渲染空壳。
      if (rules.length === 0) {
        t5 = null;
        break bb0;
      }
      T1 = Text;
      if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
        t2 = <Text dimColor={true}>{"  "}⎿{"  "}</Text>;
        $[8] = t2;
      } else {
        t2 = $[8];
      }
      t3 = "Suggested rules:";
      t4 = " ";
      T0 = Ansi;
      t1 = rules.map(_temp).join(", ");
    }
    $[0] = suggestions;
    $[1] = T0;
    $[2] = T1;
    $[3] = t1;
    $[4] = t2;
    $[5] = t3;
    $[6] = t4;
    $[7] = t5;
  } else {
    T0 = $[1];
    T1 = $[2];
    t1 = $[3];
    t2 = $[4];
    t3 = $[5];
    t4 = $[6];
    t5 = $[7];
  }
// 哨兵检查：只要哨兵被替换过（即走了提前返回那条路），就直接返回那个值。这一句之后的所有代码都只在「没有提前返回」时执行。
  if (t5 !== Symbol.for("react.early_return_sentinel")) {
    return t5;
  }
  let t6;
  if ($[9] !== T0 || $[10] !== t1) {
    t6 = <T0>{t1}</T0>;
    $[9] = T0;
    $[10] = t1;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] !== T1 || $[13] !== t2 || $[14] !== t3 || $[15] !== t4 || $[16] !== t6) {
    t7 = <T1>{t2}{t3}{t4}{t6}</T1>;
    $[12] = T1;
    $[13] = t2;
    $[14] = t3;
    $[15] = t4;
    $[16] = t6;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  return t7;
}
function _temp(rule) {
  return chalk.bold(permissionRuleValueToString(rule));
}
type Props = {
  permissionResult: PermissionDecision;
  toolName?: string; // Filter unreachable rules to this tool
};

// Helper function to extract directories from permission updates
// 从权限更新里抽目录：只认「添加目录」这一种更新类型，其余全部丢弃。用扁平映射一次拿完，因为一条更新可能带多个目录。
function extractDirectories(updates: PermissionUpdate[] | undefined): string[] {
  if (!updates) return [];
  return updates.flatMap(update => {
    switch (update.type) {
      case 'addDirectories':
        return update.directories;
      default:
        return [];
    }
  });
}

// Helper function to extract mode from permission updates
// 从权限更新里抽模式：取最后一条设模式更新。用「取最后」而不是「取第一」，语义是后写的覆盖先写的，与设置文件的合并规则一致。
function extractMode(updates: PermissionUpdate[] | undefined): PermissionMode | undefined {
  if (!updates) return undefined;
  const update = updates.findLast(u => u.type === 'setMode');
  return update?.type === 'setMode' ? update.mode : undefined;
}
// 建议明细组件：把一份建议拆成三类来展示——规则、目录、模式。组件开头先处理「完全没有建议」的情况，中间处理「三类都为空」的情况，最后才是正常的分类列表。前两种情况文案不同（复数与单数），这个差别来自「用户是否提供了建议」而不是「建议里有没有内容」，读的时候别把两者混为一谈。
function SuggestionDisplay(t0) {
  const $ = _c(22);
  const {
    suggestions,
    width
  } = t0;
// 完全没有建议时的渲染：右侧对齐的「建议」标签加上一个「无」。这里没有提前返回，而是构造完直接返回，因为这一段不需要走后面的记忆化路径。
  if (!suggestions || suggestions.length === 0) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text dimColor={true}>Suggestions </Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    let t2;
    if ($[1] !== width) {
      t2 = <Box justifyContent="flex-end" minWidth={width}>{t1}</Box>;
      $[1] = width;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    let t3;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text>None</Text>;
      $[3] = t3;
    } else {
      t3 = $[3];
    }
    let t4;
    if ($[4] !== t2) {
      t4 = <Box flexDirection="row">{t2}{t3}</Box>;
      $[4] = t2;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    return t4;
  }
  let t1;
  let t2;
  if ($[6] !== suggestions || $[7] !== width) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const rules = extractRules(suggestions);
      const directories = extractDirectories(suggestions);
      const mode = extractMode(suggestions);
// 三类都为空的分支：结构与上面几乎相同，唯一区别是标签用了单数。这条分支存在的理由是——建议对象存在但内容全空，说明后端明确给了「没有可建议的东西」，与「压根没给建议」是两种状态，调试时要能分辨。
      if (rules.length === 0 && directories.length === 0 && !mode) {
        let t3;
        if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
          t3 = <Text dimColor={true}>Suggestion </Text>;
          $[10] = t3;
        } else {
          t3 = $[10];
        }
        let t4;
        if ($[11] !== width) {
          t4 = <Box justifyContent="flex-end" minWidth={width}>{t3}</Box>;
          $[11] = width;
          $[12] = t4;
        } else {
          t4 = $[12];
        }
        let t5;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t5 = <Text>None</Text>;
          $[13] = t5;
        } else {
          t5 = $[13];
        }
        let t6;
        if ($[14] !== t4) {
          t6 = <Box flexDirection="row">{t4}{t5}</Box>;
          $[14] = t4;
          $[15] = t6;
        } else {
          t6 = $[15];
        }
        t2 = t6;
        break bb0;
      }
      let t3;
      if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
        t3 = <Text dimColor={true}>Suggestions </Text>;
        $[16] = t3;
      } else {
        t3 = $[16];
      }
      let t4;
      if ($[17] !== width) {
        t4 = <Box justifyContent="flex-end" minWidth={width}>{t3}</Box>;
        $[17] = width;
        $[18] = t4;
      } else {
        t4 = $[18];
      }
      let t5;
      if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
        t5 = <Text> </Text>;
        $[19] = t5;
      } else {
        t5 = $[19];
      }
      let t6;
      if ($[20] !== t4) {
        t6 = <Box flexDirection="row">{t4}{t5}</Box>;
        $[20] = t4;
        $[21] = t6;
      } else {
        t6 = $[21];
      }
// 正常路径的主拼装：先算标签行，再按「有规则就加规则段、有目录就加目录段、有模式就加模式段」拼三段。三段各自用同一个宽度做右对齐，所以整块看起来像一张两列表格——左列标签右对齐、右列内容左对齐，这在终端里是最省字符的对齐方案。
      t1 = <Box flexDirection="column">{t6}{rules.length > 0 && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={width}><Text dimColor={true}> Rules </Text></Box><Box flexDirection="column">{rules.map(_temp2)}</Box></Box>}{directories.length > 0 && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={width}><Text dimColor={true}> Directories </Text></Box><Box flexDirection="column">{directories.map(_temp3)}</Box></Box>}{mode && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={width}><Text dimColor={true}> Mode </Text></Box><Text>{permissionModeTitle(mode)}</Text></Box>}</Box>;
    }
    $[6] = suggestions;
    $[7] = width;
    $[8] = t1;
    $[9] = t2;
  } else {
    t1 = $[8];
    t2 = $[9];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  return t1;
}
function _temp3(dir, index_0) {
  return <Text key={index_0}>{figures.bullet} {dir}</Text>;
}
function _temp2(rule, index) {
  return <Text key={index}>{figures.bullet} {permissionRuleValueToString(rule)}</Text>;
}
// 调试信息主组件。它做四件事：取权限上下文、从决策里分离出原因与建议、算出「哪些规则永远不生效」、再把四行信息加一个警告块纵向排开。四行分别是行为、消息（仅非允许时）、原因、建议。
export function PermissionDecisionDebugInfo(t0) {
  const $ = _c(25);
  const {
    permissionResult,
    toolName
  } = t0;
// 权限上下文从全局状态里取一个切片。取切片而不是整个状态，是为了让这个组件只在权限上下文变化时重渲染，而不是全局状态一动就重渲染。
  const toolPermissionContext = useAppState(_temp4);
  const decisionReason = permissionResult.decisionReason;
  const suggestions = "suggestions" in permissionResult ? permissionResult.suggestions : undefined;
  let t1;
  if ($[0] !== suggestions || $[1] !== toolName || $[2] !== toolPermissionContext) {
    bb0: {
// 沙箱自动允许：只有当沙箱启用且「沙箱内自动允许」也被打开时才算成立。这个值参与不可达规则的计算，因为沙箱自动允许会让一批显式规则变得多余。
      const sandboxAutoAllowEnabled = SandboxManager.isSandboxingEnabled() && SandboxManager.isAutoAllowBashIfSandboxedEnabled();
      const all = detectUnreachableRules(toolPermissionContext, {
        sandboxAutoAllowEnabled
      });
      const suggestedRules = extractRules(suggestions);
// 过滤优先级第一档：如果这次决策带了建议规则，就只保留「与建议规则同名同内容」的不可达规则。语义是——用户正要添加的这条规则已经存在，于是新加的这条永远不会生效，这个提示最有价值，所以优先级最高。
      if (suggestedRules.length > 0) {
        t1 = all.filter(u => suggestedRules.some(suggested => suggested.toolName === u.rule.ruleValue.toolName && suggested.ruleContent === u.rule.ruleValue.ruleContent));
        break bb0;
      }
// 过滤优先级第二档：没有建议时，若给了工具名，就只看这个工具下的不可达规则。第三档是两者都没有，全部展示。三档的共同点是都会先算出全量再过滤，而不是在计算阶段就带条件——先全量后过滤让计算函数保持无参数分支。
      if (toolName) {
        let t2;
        if ($[4] !== toolName) {
          t2 = u_0 => u_0.rule.ruleValue.toolName === toolName;
          $[4] = toolName;
          $[5] = t2;
        } else {
          t2 = $[5];
        }
        t1 = all.filter(t2);
        break bb0;
      }
      t1 = all;
    }
    $[0] = suggestions;
    $[1] = toolName;
    $[2] = toolPermissionContext;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const unreachableRules = t1;
  let t2;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
// 行为行：右对齐的标签加左对齐的值。标签宽度固定为十，正好容下这几个标签里最长的那个，于是所有行天然对齐。
    t2 = <Box justifyContent="flex-end" minWidth={10}><Text dimColor={true}>Behavior </Text></Box>;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== permissionResult.behavior) {
    t3 = <Box flexDirection="row">{t2}<Text>{permissionResult.behavior}</Text></Box>;
    $[7] = permissionResult.behavior;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  let t4;
// 消息行只在行为不是允许时出现：允许的决策没有消息可看，渲染一行空标签反而干扰。
  if ($[9] !== permissionResult.behavior || $[10] !== permissionResult.message) {
    t4 = permissionResult.behavior !== "allow" && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={10}><Text dimColor={true}>Message </Text></Box><Text>{permissionResult.message}</Text></Box>;
    $[9] = permissionResult.behavior;
    $[10] = permissionResult.message;
    $[11] = t4;
  } else {
    t4 = $[11];
  }
  let t5;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box justifyContent="flex-end" minWidth={10}><Text dimColor={true}>Reason </Text></Box>;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] !== decisionReason) {
    t6 = <Box flexDirection="row">{t5}{decisionReason === undefined ? <Text>undefined</Text> : <PermissionDecisionInfoItem decisionReason={decisionReason} />}</Box>;
    $[13] = decisionReason;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
// 建议行固定渲染，宽度与标签宽度一致，这样即使没有建议也会显示一个「无」，保持整块的行数稳定。
  if ($[15] !== suggestions) {
    t7 = <SuggestionDisplay suggestions={suggestions} width={10} />;
    $[15] = suggestions;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
// 不可达规则块：只有存在时才多留一段上边距并画一个警告标题（带数量），然后逐条展开。每条又分三行——规则内容用警告色、原因压暗、修复建议压暗并带前缀。这种「问题、为什么、怎么修」的三行结构，是调试类提示里信息密度最高的排法。
  if ($[17] !== unreachableRules) {
    t8 = unreachableRules.length > 0 && <Box flexDirection="column" marginTop={1}><Text color="warning">{figures.warning} Unreachable Rules ({unreachableRules.length})</Text>{unreachableRules.map(_temp5)}</Box>;
    $[17] = unreachableRules;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  let t9;
  if ($[19] !== t3 || $[20] !== t4 || $[21] !== t6 || $[22] !== t7 || $[23] !== t8) {
    t9 = <Box flexDirection="column">{t3}{t4}{t6}{t7}{t8}</Box>;
    $[19] = t3;
    $[20] = t4;
    $[21] = t6;
    $[22] = t7;
    $[23] = t8;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  return t9;
}
// 单条不可达规则的渲染：三行都要缩进两格，且原因与修复建议用两个空格字面量而不是内边距，理由与前面的树形对齐一致——终端里只有空格能保证跨组件严格对齐。
function _temp5(u_1, i) {
  return <Box key={i} flexDirection="column" marginLeft={2}><Text color="warning">{permissionRuleValueToString(u_1.rule.ruleValue)}</Text><Text dimColor={true}>{"  "}{u_1.reason}</Text><Text dimColor={true}>{"  "}Fix: {u_1.fix}</Text></Box>;
}
function _temp4(s) {
  return s.toolPermissionContext;
}
// 原文件此处有一行 38124 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。