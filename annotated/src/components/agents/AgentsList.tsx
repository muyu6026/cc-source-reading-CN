// 本文件是子代理清单：按来源（全部 / 内置 / 插件 / 各设置源）分组列出所有可用代理，带「新建代理」入口，并处理「同名代理被更高优先级来源覆盖」这种影子关系。它没有用通用下拉框，而是自己实现了一个上下键循环的列表——原因可以从状态看出：它有两类可聚焦条目（新建项与代理项），而通用下拉框只有一类。这个自建键盘模型是本文件最值得读的部分。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import type { SettingSource } from 'src/utils/settings/constants.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import type { ResolvedAgent } from '../../tools/AgentTool/agentDisplay.js';
import { AGENT_SOURCE_GROUPS, compareAgentsByName, getOverrideSourceLabel, resolveAgentModelDisplay } from '../../tools/AgentTool/agentDisplay.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import { count } from '../../utils/array.js';
import { Dialog } from '../design-system/Dialog.js';
import { Divider } from '../design-system/Divider.js';
import { getAgentSourceDisplayName } from './utils.js';
// 属性里的来源字段有五种取值：四种设置源加三个伪来源（全部、内置、插件）。用同一个字符串联合类型而不是嵌套枚举，是为了让标题文案与过滤逻辑都只依赖一个值。
type Props = {
  source: SettingSource | 'all' | 'built-in' | 'plugin';
  agents: ResolvedAgent[];
  onBack: () => void;
  onSelect: (agent: AgentDefinition) => void;
  onCreateNew?: () => void;
  changes?: string[];
};
export function AgentsList(t0) {
  const $ = _c(96);
  const {
    source,
    agents,
    onBack,
    onSelect,
    onCreateNew,
    changes
  } = t0;
// 两个状态分离：选中的代理（对象，可为空）与「新建项是否选中」（布尔）。为什么不合并成一个「选中下标」？因为代理列表是分组的，扁平下标要跨越分组边界，容易与渲染顺序错位；用「对象引用加一个布尔」把两类条目彻底分开，就没有顺序契约的问题。
  const [selectedAgent, setSelectedAgent] = React.useState(null);
// 新建项默认选中。这是产品决策而不只是初始值——用户打开这个界面最常见的目的是新建，所以把光标放在新建项上，按回车即达。
  const [isCreateNewSelected, setIsCreateNewSelected] = React.useState(true);
  let t1;
// 排序只做一次：按名称比较，缓存在输入不变期间。排序结果后面被复用四五次（过滤、计数、分组渲染），所以必须是稳定引用，否则每次渲染都会生成新数组、把所有下游记忆化打穿。
  if ($[0] !== agents) {
    t1 = [...agents].sort(compareAgentsByName);
    $[0] = agents;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const sortedAgents = t1;
  const getOverrideInfo = _temp;
  let t2;
// 新建项的渲染函数：选中时给指针符号与强调色，未选中时给两个空格占位。用空格占位而不是条件渲染，是为了让两种状态下文字起始列完全一致——列表里所有行都靠这个约定对齐。
  if ($[2] !== isCreateNewSelected) {
    t2 = () => <Box><Text color={isCreateNewSelected ? "suggestion" : undefined}>{isCreateNewSelected ? `${figures.pointer} ` : "  "}</Text><Text color={isCreateNewSelected ? "suggestion" : undefined}>Create new agent</Text></Box>;
    $[2] = isCreateNewSelected;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const renderCreateNewOption = t2;
  let t3;
// 单个代理行的渲染函数，依赖三项：新建项是否选中、当前选中代理的类型、当前选中代理的来源。后两项一起构成「唯一标识」，因为同名代理可能来自不同来源，只比类型会误判。
  if ($[4] !== isCreateNewSelected || $[5] !== selectedAgent?.agentType || $[6] !== selectedAgent?.source) {
    t3 = agent_0 => {
// 内置代理不参与选中：它没有指针、也没有可聚焦态。原因是内置代理不可修改、也不可被选择去编辑，只作为「存在这些能力」的信息展示。
      const isBuiltIn = agent_0.source === "built-in";
// 选中判定：非内置、新建项未选中、且类型与来源都相同。三个条件缺一不可——只看类型会把不同来源的同名代理一起点亮。
      const isSelected = !isBuiltIn && !isCreateNewSelected && selectedAgent?.agentType === agent_0.agentType && selectedAgent?.source === agent_0.source;
      const {
        isOverridden,
        overriddenBy
      } = getOverrideInfo(agent_0);
      const dimmed = isBuiltIn || isOverridden;
      const textColor = !isBuiltIn && isSelected ? "suggestion" : undefined;
      const resolvedModel = resolveAgentModelDisplay(agent_0);
// 整行由五段可选内容拼成：指针或缩进、代理类型名、解析后的模型名、记忆范围、以及影子警告。每一段都自己判空，所以没有模型或没有记忆的代理不会留下多余的分隔点。分隔符用中点加空格而不是竖线，是为了在密集列表里保持轻盈。
      return <Box key={`${agent_0.agentType}-${agent_0.source}`}><Text dimColor={dimmed && !isSelected} color={textColor}>{isBuiltIn ? "" : isSelected ? `${figures.pointer} ` : "  "}</Text><Text dimColor={dimmed && !isSelected} color={textColor}>{agent_0.agentType}</Text>{resolvedModel && <Text dimColor={true} color={textColor}>{" \xB7 "}{resolvedModel}</Text>}{agent_0.memory && <Text dimColor={true} color={textColor}>{" \xB7 "}{agent_0.memory} memory</Text>}{overriddenBy && <Text dimColor={!isSelected} color={isSelected ? "warning" : undefined}>{" "}{figures.warning} shadowed by {getOverrideSourceLabel(overriddenBy)}</Text>}</Box>;
    };
    $[4] = isCreateNewSelected;
    $[5] = selectedAgent?.agentType;
    $[6] = selectedAgent?.source;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const renderAgent = t3;
  let t4;
// 可选代理的扁平顺序在这里确定：先滤掉内置（它们不可选），然后如果来源是「全部」就按预设的源分组顺序逐组铺开，否则原样保留。这个扁平表是键盘上下键的唯一依据，所以它的顺序必须与下面渲染时的顺序严格一致——这正是本文件最容易出错的地方。
  if ($[8] !== sortedAgents || $[9] !== source) {
    bb0: {
      const nonBuiltIn = sortedAgents.filter(_temp2);
// 全部来源时按分组顺序重排：外层遍历预设分组、内层取该组的代理。这样扁平表顺序与界面上的分组呈现一致，上下键的移动才符合直觉。
      if (source === "all") {
        t4 = AGENT_SOURCE_GROUPS.filter(_temp3).flatMap(t5 => {
          const {
            source: groupSource
          } = t5;
          return nonBuiltIn.filter(a_0 => a_0.source === groupSource);
        });
        break bb0;
      }
      t4 = nonBuiltIn;
    }
    $[8] = sortedAgents;
    $[9] = source;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  const selectableAgentsInOrder = t4;
  let t5;
  let t6;
// 挂载与状态变化后的兜底：如果既没有选中代理、新建项又没选中，就把焦点放到新建项（若有新建入口）或第一个代理。这个副作用处理的是「列表刷新后选中项消失」的情况，否则界面会处于无焦点的死态。
  if ($[11] !== isCreateNewSelected || $[12] !== onCreateNew || $[13] !== selectableAgentsInOrder || $[14] !== selectedAgent) {
    t5 = () => {
      if (!selectedAgent && !isCreateNewSelected && selectableAgentsInOrder.length > 0) {
        if (onCreateNew) {
          setIsCreateNewSelected(true);
        } else {
          setSelectedAgent(selectableAgentsInOrder[0] || null);
        }
      }
    };
    t6 = [selectableAgentsInOrder, selectedAgent, isCreateNewSelected, onCreateNew];
    $[11] = isCreateNewSelected;
    $[12] = onCreateNew;
    $[13] = selectableAgentsInOrder;
    $[14] = selectedAgent;
    $[15] = t5;
    $[16] = t6;
  } else {
    t5 = $[15];
    t6 = $[16];
  }
  React.useEffect(t5, t6);
  let t7;
// 键盘处理：回车优先处理，其余只认上下键。回车分支里两个选择互斥——新建项选中且确实有新建入口就新建，否则有选中代理就打开它。
  if ($[17] !== isCreateNewSelected || $[18] !== onCreateNew || $[19] !== onSelect || $[20] !== selectableAgentsInOrder || $[21] !== selectedAgent) {
    t7 = e => {
      if (e.key === "return") {
        e.preventDefault();
        if (isCreateNewSelected && onCreateNew) {
          onCreateNew();
        } else {
          if (selectedAgent) {
            onSelect(selectedAgent);
          }
        }
        return;
      }
      if (e.key !== "up" && e.key !== "down") {
        return;
      }
      e.preventDefault();
// 上下键前先算总条数：代理数加（是否有新建项）。这个「加一」是后面所有下标换算的基准，一旦某处忘了加，整个循环就会错位一条。
      const hasCreateOption = !!onCreateNew;
      const totalItems = selectableAgentsInOrder.length + (hasCreateOption ? 1 : 0);
      if (totalItems === 0) {
        return;
      }
// 当前光标位置从选中状态反推：新建项选中时位置为 0，否则在扁平表里找匹配项的下标，再按有无新建项决定要不要加一。用「类型加来源」匹配而不是引用相等，是因为列表可能被重新加载、对象引用会变。
      let currentPosition = 0;
      if (!isCreateNewSelected && selectedAgent) {
        const agentIndex = selectableAgentsInOrder.findIndex(a_1 => a_1.agentType === selectedAgent.agentType && a_1.source === selectedAgent.source);
        if (agentIndex >= 0) {
          currentPosition = hasCreateOption ? agentIndex + 1 : agentIndex;
        }
      }
// 环绕移动：向上时若已在 0 就跳到末尾、否则减一；向下时若已在末尾就回 0、否则加一。两个分支都写成三元，是因为整个计算要在一个表达式里得出新位置。
      const newPosition = e.key === "up" ? currentPosition === 0 ? totalItems - 1 : currentPosition - 1 : currentPosition === totalItems - 1 ? 0 : currentPosition + 1;
      if (hasCreateOption && newPosition === 0) {
        setIsCreateNewSelected(true);
        setSelectedAgent(null);
      } else {
        const agentIndex_0 = hasCreateOption ? newPosition - 1 : newPosition;
        const newAgent = selectableAgentsInOrder[agentIndex_0];
        if (newAgent) {
          setIsCreateNewSelected(false);
          setSelectedAgent(newAgent);
        }
      }
    };
    $[17] = isCreateNewSelected;
    $[18] = onCreateNew;
    $[19] = onSelect;
    $[20] = selectableAgentsInOrder;
    $[21] = selectedAgent;
    $[22] = t7;
  } else {
    t7 = $[22];
  }
  const handleKeyDown = t7;
  let t8;
// 内置代理区段的渲染：标题可自定义（默认为内置加「始终可用」），下面逐个渲染内置代理。这个区段会被三个地方复用——无代理的空态、按源筛选时的尾段、以及全部来源时的末尾块。
  if ($[23] !== renderAgent || $[24] !== sortedAgents) {
    t8 = t9 => {
      const title = t9 === undefined ? "Built-in (always available):" : t9;
      const builtInAgents = sortedAgents.filter(_temp4);
      return <Box flexDirection="column" marginBottom={1} paddingLeft={2}><Text bold={true} dimColor={true}>{title}</Text>{builtInAgents.map(renderAgent)}</Box>;
    };
    $[23] = renderAgent;
    $[24] = sortedAgents;
    $[25] = t8;
  } else {
    t8 = $[25];
  }
  const renderBuiltInAgentsSection = t8;
  let t9;
// 普通分组的渲染：空分组直接返回空、不渲染标题；非空则标题里带上该组的目录路径（取第一个代理的基目录，因为同组代理同目录）。这个「组内第一个代理的目录当组标题」的做法依赖分组本身的干净，属于轻量约定。
  if ($[26] !== renderAgent) {
    t9 = (title_0, groupAgents) => {
      if (!groupAgents.length) {
        return null;
      }
      const folderPath = groupAgents[0]?.baseDir;
      return <Box flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true} dimColor={true}>{title_0}</Text>{folderPath && <Text dimColor={true}> ({folderPath})</Text>}</Box>{groupAgents.map(agent_1 => renderAgent(agent_1))}</Box>;
    };
    $[26] = renderAgent;
    $[27] = t9;
  } else {
    t9 = $[27];
  }
  const renderAgentGroup = t9;
  let t10;
  if ($[28] !== source) {
    t10 = getAgentSourceDisplayName(source);
    $[28] = source;
    $[29] = t10;
  } else {
    t10 = $[29];
  }
  const sourceTitle = t10;
  let T0;
  let T1;
  let t11;
  let t12;
  let t13;
  let t14;
  let t15;
  let t16;
  let t17;
  let t18;
  let t19;
  let t20;
  let t21;
  let t22;
// 这里开始是编译产物里最长的一段缓存头部，后面跟着一个带标签的块，用来表达「提前返回空态」。读法：把块内的逻辑当成正常的 if 分支，把最后那个哨兵检查当成「函数末尾之外的提前返回」。
  if ($[30] !== changes || $[31] !== handleKeyDown || $[32] !== onBack || $[33] !== onCreateNew || $[34] !== renderAgent || $[35] !== renderAgentGroup || $[36] !== renderBuiltInAgentsSection || $[37] !== renderCreateNewOption || $[38] !== sortedAgents || $[39] !== source || $[40] !== sourceTitle) {
    t22 = Symbol.for("react.early_return_sentinel");
    bb1: {
// 先单独算出内置代理列表，供后面多处使用。它与上面那个「所有代理」的区别是这里用的是已排序的完整表，而不是被过滤过的可选表。
      const builtInAgents_0 = sortedAgents.filter(_temp5);
// 空态判定有两段：一个代理都没有，或者来源不是内置但一个非内置代理都没有。后一段不能省——否则在某个设置源下会显示「有代理」的壳、里面却是空的。
      const hasNoAgents = !sortedAgents.length || source !== "built-in" && !sortedAgents.some(_temp6);
      if (hasNoAgents) {
        let t23;
        if ($[55] !== onCreateNew || $[56] !== renderCreateNewOption) {
          t23 = onCreateNew && <Box>{renderCreateNewOption()}</Box>;
          $[55] = onCreateNew;
          $[56] = renderCreateNewOption;
          $[57] = t23;
        } else {
          t23 = $[57];
        }
        let t24;
        let t25;
        let t26;
        if ($[58] === Symbol.for("react.memo_cache_sentinel")) {
          t24 = <Text dimColor={true}>No agents found. Create specialized subagents that Claude can delegate to.</Text>;
          t25 = <Text dimColor={true}>Each subagent has its own context window, custom system prompt, and specific tools.</Text>;
          t26 = <Text dimColor={true}>Try creating: Code Reviewer, Code Simplifier, Security Reviewer, Tech Lead, or UX Reviewer.</Text>;
          $[58] = t24;
          $[59] = t25;
          $[60] = t26;
        } else {
          t24 = $[58];
          t25 = $[59];
          t26 = $[60];
        }
        let t27;
        if ($[61] !== renderBuiltInAgentsSection || $[62] !== sortedAgents || $[63] !== source) {
// 空态里还允许挂内置代理区段：只要当前不是内置视图且确实存在内置代理，就在分隔线后补上这一段。这个设计的意思是「你要的没有，但你可能对这些感兴趣」，比纯空页面有用。
          t27 = source !== "built-in" && sortedAgents.some(_temp7) && <><Divider />{renderBuiltInAgentsSection()}</>;
          $[61] = renderBuiltInAgentsSection;
          $[62] = sortedAgents;
          $[63] = source;
          $[64] = t27;
        } else {
          t27 = $[64];
        }
        let t28;
        if ($[65] !== handleKeyDown || $[66] !== t23 || $[67] !== t27) {
          t28 = <Box flexDirection="column" gap={1} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t23}{t24}{t25}{t26}{t27}</Box>;
          $[65] = handleKeyDown;
          $[66] = t23;
          $[67] = t27;
          $[68] = t28;
        } else {
          t28 = $[68];
        }
        let t29;
        if ($[69] !== onBack || $[70] !== sourceTitle || $[71] !== t28) {
          t29 = <Dialog title={sourceTitle} subtitle="No agents found" onCancel={onBack} hideInputGuide={true}>{t28}</Dialog>;
          $[69] = onBack;
          $[70] = sourceTitle;
          $[71] = t28;
          $[72] = t29;
        } else {
          t29 = $[72];
        }
        t22 = t29;
        break bb1;
      }
      T1 = Dialog;
      t17 = sourceTitle;
      let t23;
      if ($[73] !== sortedAgents) {
// 副标题里的数量不是列表长度，而是过滤掉「被覆盖的代理」之后的计数。这是个关键口径：界面上同名的代理只显示一次（显示最高优先级的那个），所以总数也必须是去重后的数，否则用户数一遍会对不上。
        t23 = count(sortedAgents, _temp8);
        $[73] = sortedAgents;
        $[74] = t23;
      } else {
        t23 = $[74];
      }
// 副标题文案恒用复数形式，即使只有一个也用 agents。这是为了不让副标题在数量变化时抖动，属于刻意的文案选择而非疏漏。
      t18 = `${t23} agents`;
      t19 = onBack;
      t20 = true;
// 变更提示只取最后一条。这类提示通常是「已创建某代理」之类的操作回执，多条堆叠没有意义，最后一条即最新结论。
      if ($[75] !== changes) {
        t21 = changes && changes.length > 0 && <Box marginTop={1}><Text dimColor={true}>{changes[changes.length - 1]}</Text></Box>;
        $[75] = changes;
        $[76] = t21;
      } else {
        t21 = $[76];
      }
      T0 = Box;
      t11 = "column";
      t12 = 0;
      t13 = true;
      t14 = handleKeyDown;
      if ($[77] !== onCreateNew || $[78] !== renderCreateNewOption) {
        t15 = onCreateNew && <Box marginBottom={1}>{renderCreateNewOption()}</Box>;
        $[77] = onCreateNew;
        $[78] = renderCreateNewOption;
        $[79] = t15;
      } else {
        t15 = $[79];
      }
// 主内容按来源分三支。全部来源：按分组渲染非内置、末尾附内置块；内置来源：一句说明加完整列表（含不可修改的理由）；其余来源：先渲染非内置、若存在内置则用分隔线补一段。三支都复用上面那两个渲染函数，所以行样式完全一致。
      t16 = source === "all" ? <>{AGENT_SOURCE_GROUPS.filter(_temp9).map(t24 => {
          const {
            label,
            source: groupSource_0
          } = t24;
          return <React.Fragment key={groupSource_0}>{renderAgentGroup(label, sortedAgents.filter(a_7 => a_7.source === groupSource_0))}</React.Fragment>;
        })}{builtInAgents_0.length > 0 && <Box flexDirection="column" marginBottom={1} paddingLeft={2}><Text dimColor={true}><Text bold={true}>Built-in agents</Text> (always available)</Text>{builtInAgents_0.map(renderAgent)}</Box>}</> : source === "built-in" ? <><Text dimColor={true} italic={true}>Built-in agents are provided by default and cannot be modified.</Text><Box marginTop={1} flexDirection="column">{sortedAgents.map(agent_2 => renderAgent(agent_2))}</Box></> : <>{sortedAgents.filter(_temp0).map(agent_3 => renderAgent(agent_3))}{sortedAgents.some(_temp1) && <><Divider />{renderBuiltInAgentsSection()}</>}</>;
    }
    $[30] = changes;
    $[31] = handleKeyDown;
    $[32] = onBack;
    $[33] = onCreateNew;
    $[34] = renderAgent;
    $[35] = renderAgentGroup;
    $[36] = renderBuiltInAgentsSection;
    $[37] = renderCreateNewOption;
    $[38] = sortedAgents;
    $[39] = source;
    $[40] = sourceTitle;
    $[41] = T0;
    $[42] = T1;
    $[43] = t11;
    $[44] = t12;
    $[45] = t13;
    $[46] = t14;
    $[47] = t15;
    $[48] = t16;
    $[49] = t17;
    $[50] = t18;
    $[51] = t19;
    $[52] = t20;
    $[53] = t21;
    $[54] = t22;
  } else {
    T0 = $[41];
    T1 = $[42];
    t11 = $[43];
    t12 = $[44];
    t13 = $[45];
    t14 = $[46];
    t15 = $[47];
    t16 = $[48];
    t17 = $[49];
    t18 = $[50];
    t19 = $[51];
    t20 = $[52];
    t21 = $[53];
    t22 = $[54];
  }
// 哨兵检查：走到这里说明没走空态分支，继续组装正常的弹窗结构。这一段是「提前返回块」的出口，位置在渲染主体之前、渲染主体之后才是真正的返回。
  if (t22 !== Symbol.for("react.early_return_sentinel")) {
    return t22;
  }
  let t23;
  if ($[80] !== T0 || $[81] !== t11 || $[82] !== t12 || $[83] !== t13 || $[84] !== t14 || $[85] !== t15 || $[86] !== t16) {
    t23 = <T0 flexDirection={t11} tabIndex={t12} autoFocus={t13} onKeyDown={t14}>{t15}{t16}</T0>;
    $[80] = T0;
    $[81] = t11;
    $[82] = t12;
    $[83] = t13;
    $[84] = t14;
    $[85] = t15;
    $[86] = t16;
    $[87] = t23;
  } else {
    t23 = $[87];
  }
  let t24;
  if ($[88] !== T1 || $[89] !== t17 || $[90] !== t18 || $[91] !== t19 || $[92] !== t20 || $[93] !== t21 || $[94] !== t23) {
    t24 = <T1 title={t17} subtitle={t18} onCancel={t19} hideInputGuide={t20}>{t21}{t23}</T1>;
    $[88] = T1;
    $[89] = t17;
    $[90] = t18;
    $[91] = t19;
    $[92] = t20;
    $[93] = t21;
    $[94] = t23;
    $[95] = t24;
  } else {
    t24 = $[95];
  }
  return t24;
}
function _temp1(a_9) {
  return a_9.source === "built-in";
}
function _temp0(a_8) {
  return a_8.source !== "built-in";
}
function _temp9(g_0) {
  return g_0.source !== "built-in";
}
function _temp8(a_6) {
  return !a_6.overriddenBy;
}
function _temp7(a_5) {
  return a_5.source === "built-in";
}
function _temp6(a_4) {
  return a_4.source !== "built-in";
}
function _temp5(a_3) {
  return a_3.source === "built-in";
}
function _temp4(a_2) {
  return a_2.source === "built-in";
}
function _temp3(g) {
  return g.source !== "built-in";
}
function _temp2(a) {
  return a.source !== "built-in";
}
function _temp(agent) {
  return {
    isOverridden: !!agent.overriddenBy,
    overriddenBy: agent.overriddenBy || null
  };
}
// 原文件此处有一行 37276 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。