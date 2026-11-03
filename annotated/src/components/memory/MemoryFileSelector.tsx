// 本文件是记忆文件选择器：列出用户级与项目级的记忆文件（含被导入的嵌套文件），再挂上几个「打开某个目录」的入口，外加两个开关（自动记忆、自动整理）。它同时是三个角色的混合体——文件列表、目录快捷入口、配置开关，三者共用一套上下键。最值得读的是这三者如何在一个键盘模型里排队：开关行占据列表上方的位置，但只有上键从第一项再向上时才接管。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import * as React from 'react';
import { use, useEffect, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js';
import { logEvent } from '../../services/analytics/index.js';
import { isAutoDreamEnabled } from '../../services/autoDream/config.js';
import { readLastConsolidatedAt } from '../../services/autoDream/consolidationLock.js';
import { useAppState } from '../../state/AppState.js';
import { getAgentMemoryDir } from '../../tools/AgentTool/agentMemory.js';
import { openPath } from '../../utils/browser.js';
import { getMemoryFiles, type MemoryFileInfo } from '../../utils/claudemd.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import { projectIsInGitRepo } from '../../utils/memory/versions.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/index.js';
import { ListItem } from '../design-system/ListItem.js';

// 条件加载：团队记忆相关模块只在特性开关开启时用 require 拉进来，并显式禁用了那条「禁止 require」的检查规则。这样外部构建里整个模块会被摇掉，界面代码不必到处写特性判断。这种「用 require 换掉静态导入」的做法在打包体积敏感的地方很常见，代价是类型要靠手写断言补回来。
/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM') ? require('../../memdir/teamMemPaths.js') as typeof import('../../memdir/teamMemPaths.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// 扩展后的文件信息多了两个字段：是否嵌套（被导入进来的）、是否存在。后面所有「新建」标记与缩进层级都基于这两个字段，所以它必须在进入渲染之前就被补齐。
interface ExtendedMemoryFileInfo extends MemoryFileInfo {
  isNested?: boolean;
  exists: boolean;
}

// Remember last selected path
// 模块级变量记住上次选中的路径。用模块级而不是状态，是因为它的生命周期要跨组件实例——用户打开选择器、选一个文件、离开、再打开，希望光标停在上次那个文件上。这是少数几个「模块级可变状态」合理的场景。
let lastSelectedPath: string | undefined;
const OPEN_FOLDER_PREFIX = '__open_folder__';
type Props = {
  onSelect: (path: string) => void;
  onCancel: () => void;
};
// 组件本体。第一个钩子是同步读取记忆文件的「资源钩子」——它接收一个承诺而不是直接返回值，会在承诺未完成时挂起组件。这意味着本组件第一次渲染前就已经拿到了完整文件清单，没有加载态分支。
export function MemoryFileSelector(t0) {
  const $ = _c(58);
  const {
    onSelect,
    onCancel
  } = t0;
// 全文件的数据来源就是这一行：一个异步清单。后面所有内容都是这份清单的派生——补默认项、算层级、拼标签、加目录入口。理解这一点之后，中间那一大段嵌套条件其实只是在为每条文件算「标签」与「描述」两句话。
  const existingMemoryFiles = use(getMemoryFiles());
  const userMemoryPath = join(getClaudeConfigHomeDir(), "CLAUDE.md");
  const projectMemoryPath = join(getOriginalCwd(), "CLAUDE.md");
  const hasUserMemory = existingMemoryFiles.some(f => f.path === userMemoryPath);
  const hasProjectMemory = existingMemoryFiles.some(f_0 => f_0.path === projectMemoryPath);
// 三条来源拼成完整清单：已有的记忆文件（滤掉自动记忆与团队记忆两类，因为它们走目录入口而不是文件入口）、以及「若没有用户级文件就补一个占位的新建项」、再加「若没有项目级文件就补一个」。占位项的内容为空、存在标记为假，于是会在标签后面显示新建提示。
  const allMemoryFiles = [...existingMemoryFiles.filter(_temp).map(_temp2), ...(hasUserMemory ? [] : [{
    path: userMemoryPath,
    type: "User" as const,
    content: "",
    exists: false
  }]), ...(hasProjectMemory ? [] : [{
    path: projectMemoryPath,
    type: "Project" as const,
    content: "",
    exists: false
  }])];
// 层级表用普通映射而不是给每个对象加字段，因为原对象来自外部、不该被就地修改。映射的键是路径，值是深度——下面的循环按清单顺序推进，父文件必然排在子文件之前，所以查父级的深度总是命中。这个隐含前提是本文件最容易忽略的一处依赖。
  const depths = new Map();
  const memoryOptions = allMemoryFiles.map(file => {
    const displayPath = getDisplayPath(file.path);
    const existsLabel = file.exists ? "" : " (new)";
    const depth = file.parent ? (depths.get(file.parent) ?? 0) + 1 : 0;
    depths.set(file.path, depth);
    const indent = depth > 0 ? "  ".repeat(depth - 1) : "";
    let label;
// 标签的三级判定：用户级主文件叫「用户记忆」、项目级主文件叫「项目记忆」、其余带层级时前面加缩进与一个折角符号。缩进用重复空格而不是组件内边距，是为了让折角符号与上一层的文字精确对齐。
    if (file.type === "User" && !file.isNested && file.path === userMemoryPath) {
      label = "User memory";
    } else {
      if (file.type === "Project" && !file.isNested && file.path === projectMemoryPath) {
        label = "Project memory";
      } else {
        if (depth > 0) {
          label = `${indent}L ${displayPath}${existsLabel}`;
        } else {
          label = `${displayPath}`;
        }
      }
    }
    let description;
// 描述文案同样分级，而且第一层的判断依赖「当前目录是不是 git 仓库」——在仓库里说「已提交在」，否则说「保存在」。这个差别对用户很重要：前者意味着改动会被版本管理带走，后者不会。
    const isGit = projectIsInGitRepo(getOriginalCwd());
    if (file.type === "User" && !file.isNested) {
      description = "Saved in ~/.claude/CLAUDE.md";
    } else {
      if (file.type === "Project" && !file.isNested && file.path === projectMemoryPath) {
        description = `${isGit ? "Checked in at" : "Saved in"} ./CLAUDE.md`;
      } else {
        if (file.parent) {
          description = "@-imported";
        } else {
          if (file.isNested) {
            description = "dynamically loaded";
          } else {
            description = "";
          }
        }
      }
    }
    return {
      label,
      value: file.path,
      description
    };
  });
// 目录入口数组独立于文件清单，最后才拼到清单尾部。这样文件与目录在同一个下拉框里，但生成逻辑完全分开——文件来自扫描，目录来自配置。
  const folderOptions = [];
  const agentDefinitions = useAppState(_temp3);
// 自动记忆开启时才给目录入口。关掉时既不给入口、也不给下面的开关行之一，等于把整块能力从界面里摘掉，而不是显示成禁用。
  if (isAutoMemoryEnabled()) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = {
        label: "Open auto-memory folder",
        value: `${OPEN_FOLDER_PREFIX}${getAutoMemPath()}`,
        description: ""
      };
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    folderOptions.push(t1);
// 团队记忆入口再套一层特性开关与运行时开关的双重判断。特性开关决定代码是否存在，运行时开关决定这个团队是否真的启用了——两者都成立才显示。
    if (feature("TEAMMEM") && teamMemPaths.isTeamMemoryEnabled()) {
      let t2;
      if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
        t2 = {
          label: "Open team memory folder",
          value: `${OPEN_FOLDER_PREFIX}${teamMemPaths.getTeamMemPath()}`,
          description: ""
        };
        $[1] = t2;
      } else {
        t2 = $[1];
      }
      folderOptions.push(t2);
    }
// 遍历活跃代理，为每个「声明了记忆范围」的代理生成一个目录入口，标签里带加粗的代理名、描述里写范围。这说明记忆目录是按代理分片的，界面在这里把分片暴露出来。
    for (const agent of agentDefinitions.activeAgents) {
      if (agent.memory) {
        const agentDir = getAgentMemoryDir(agent.agentType, agent.memory);
        folderOptions.push({
          label: `Open ${chalk.bold(agent.agentType)} agent memory`,
          value: `${OPEN_FOLDER_PREFIX}${agentDir}`,
          description: `${agent.memory} scope`
        });
      }
    }
  }
  memoryOptions.push(...folderOptions);
  let t1;
  if ($[2] !== memoryOptions) {
// 初始聚焦值：上次选中的路径如果还在清单里就用它，否则用第一项。这个「还在清单里」的检查不能省——上次选的可能是某个已被删除的文件。
    t1 = lastSelectedPath && memoryOptions.some(_temp4) ? lastSelectedPath : memoryOptions[0]?.value || "";
    $[2] = memoryOptions;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const initialPath = t1;
// 三个开关状态：自动记忆、自动整理、是否显示整理行。前两个是可写的本地镜像（写设置时同步更新），第三个只在初始化时取一次——因为「是否显示」取决于能力是否可用，运行期间不会变。
  const [autoMemoryOn, setAutoMemoryOn] = useState(isAutoMemoryEnabled);
  const [autoDreamOn, setAutoDreamOn] = useState(isAutoDreamEnabled);
  const [showDreamRow] = useState(isAutoMemoryEnabled);
  const isDreamRunning = useAppState(_temp6);
  const [lastDreamAt, setLastDreamAt] = useState(null);
  let t2;
  if ($[4] !== showDreamRow) {
// 读上次整理时间：只在显示整理行时才读，读到后写入状态。副作用依赖里还包含「是否正在运行」，所以整理任务开始或结束时都会重新读一次时间——这就是界面能自动刷新「正在运行 / 上次运行于」的原因。
    t2 = () => {
      if (!showDreamRow) {
        return;
      }
      readLastConsolidatedAt().then(setLastDreamAt);
    };
    $[4] = showDreamRow;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== isDreamRunning || $[7] !== showDreamRow) {
    t3 = [showDreamRow, isDreamRunning];
    $[6] = isDreamRunning;
    $[7] = showDreamRow;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  useEffect(t2, t3);
  let t4;
  if ($[9] !== isDreamRunning || $[10] !== lastDreamAt) {
// 整理状态三态：正在运行时优先显示「运行中」；否则时间为空显示空串（还没读过）；时间为零显示「从未」；其余显示相对时间。零与空是两种不同状态，这个区分让「从未整理过」与「还不知道」在界面上不混淆。
    t4 = isDreamRunning ? "running" : lastDreamAt === null ? "" : lastDreamAt === 0 ? "never" : `last ran ${formatRelativeTimeAgo(new Date(lastDreamAt))}`;
    $[9] = isDreamRunning;
    $[10] = lastDreamAt;
    $[11] = t4;
  } else {
    t4 = $[11];
  }
  const dreamStatus = t4;
// 开关焦点用「下标或空」表示：空表示焦点在下方列表里，零与一表示焦点在第几个开关上。用一个可空数字同时表达「有没有焦点」与「焦点在哪」，比两个变量更难写错。
  const [focusedToggle, setFocusedToggle] = useState(null);
  const toggleFocused = focusedToggle !== null;
  const lastToggleIndex = showDreamRow ? 1 : 0;
  let t5;
  if ($[12] !== autoMemoryOn) {
// 自动记忆开关：写设置、更新本地镜像、打点，三步固定顺序。先写设置再改本地状态，是为了让写失败时界面不领先于真实配置——这是配置类开关的通用写法。
    t5 = function handleToggleAutoMemory() {
      const newValue = !autoMemoryOn;
      updateSettingsForSource("userSettings", {
        autoMemoryEnabled: newValue
      });
      setAutoMemoryOn(newValue);
      logEvent("tengu_auto_memory_toggled", {
        enabled: newValue
      });
    };
    $[12] = autoMemoryOn;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const handleToggleAutoMemory = t5;
  let t6;
  if ($[14] !== autoDreamOn) {
    t6 = function handleToggleAutoDream() {
      const newValue_0 = !autoDreamOn;
      updateSettingsForSource("userSettings", {
        autoDreamEnabled: newValue_0
      });
      setAutoDreamOn(newValue_0);
      logEvent("tengu_auto_dream_toggled", {
        enabled: newValue_0
      });
    };
    $[14] = autoDreamOn;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  const handleToggleAutoDream = t6;
// 挂载退出快捷键。注意它的返回值被丢弃了——这个钩子的作用是注册「连按两次退出键」的行为，调用即生效，不需要读返回值。
  useExitOnCtrlCDWithKeybindings();
  let t7;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      context: "Confirmation"
    };
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  useKeybinding("confirm:no", onCancel, t7);
  let t8;
  if ($[17] !== focusedToggle || $[18] !== handleToggleAutoDream || $[19] !== handleToggleAutoMemory) {
    t8 = () => {
      if (focusedToggle === 0) {
        handleToggleAutoMemory();
      } else {
        if (focusedToggle === 1) {
          handleToggleAutoDream();
        }
      }
    };
    $[17] = focusedToggle;
    $[18] = handleToggleAutoDream;
    $[19] = handleToggleAutoMemory;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  let t9;
  if ($[21] !== toggleFocused) {
    t9 = {
      context: "Confirmation",
      isActive: toggleFocused
    };
    $[21] = toggleFocused;
    $[22] = t9;
  } else {
    t9 = $[22];
  }
// 确认键的绑定带激活条件：只有焦点在开关上时才生效。这一条是三个角色共用键盘的关键——焦点在列表里时，确认键归列表；焦点在开关上时，确认键归开关。
  useKeybinding("confirm:yes", t8, t9);
  let t10;
  if ($[23] !== lastToggleIndex) {
// 下一个键的处理：焦点为空时不动；焦点还没到最后一个开关时加一；已经在最后一个时清空焦点（回到列表）。所以从开关区向下会自然回到列表，形成一个环。
    t10 = () => {
      setFocusedToggle(prev => prev !== null && prev < lastToggleIndex ? prev + 1 : null);
    };
    $[23] = lastToggleIndex;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  let t11;
  if ($[25] !== toggleFocused) {
    t11 = {
      context: "Select",
      isActive: toggleFocused
    };
    $[25] = toggleFocused;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  useKeybinding("select:next", t10, t11);
  let t12;
// 上一个键的处理用了一个独立的钳制函数（文件末尾），语义是「只有大于零才减一」。配合下面列表的「从第一项再向上」，两个方向合起来构成了「列表 ↔ 开关区」的双向通道。
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = () => {
      setFocusedToggle(_temp7);
    };
    $[27] = t12;
  } else {
    t12 = $[27];
  }
  let t13;
  if ($[28] !== toggleFocused) {
    t13 = {
      context: "Select",
      isActive: toggleFocused
    };
    $[28] = toggleFocused;
    $[29] = t13;
  } else {
    t13 = $[29];
  }
  useKeybinding("select:previous", t12, t13);
  const t14 = focusedToggle === 0;
  const t15 = autoMemoryOn ? "on" : "off";
  let t16;
  if ($[30] !== t15) {
// 自动记忆行：聚焦判定是「焦点下标等于零」。第一行用列表项组件（带聚焦样式），第二行则手写样式——两行实现方式不同，是因为第二行还要拼状态文字与运行提示，用组件反而更绕。
    t16 = <Text>Auto-memory: {t15}</Text>;
    $[30] = t15;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  let t17;
  if ($[32] !== t14 || $[33] !== t16) {
    t17 = <ListItem isFocused={t14}>{t16}</ListItem>;
    $[32] = t14;
    $[33] = t16;
    $[34] = t17;
  } else {
    t17 = $[34];
  }
  let t18;
// 自动整理行：只在显示整理行时存在，样式自己写（关掉了组件的默认样式），状态文字后面按情况追加「整理状态」与「用某命令运行」两段提示。后者只在「没在运行且开关是开的」时出现，避免在已经运行时提示用户去运行。
  if ($[35] !== autoDreamOn || $[36] !== dreamStatus || $[37] !== focusedToggle || $[38] !== isDreamRunning || $[39] !== showDreamRow) {
    t18 = showDreamRow && <ListItem isFocused={focusedToggle === 1} styled={false}><Text color={focusedToggle === 1 ? "suggestion" : undefined}>Auto-dream: {autoDreamOn ? "on" : "off"}{dreamStatus && <Text dimColor={true}> · {dreamStatus}</Text>}{!isDreamRunning && autoDreamOn && <Text dimColor={true}> · /dream to run</Text>}</Text></ListItem>;
    $[35] = autoDreamOn;
    $[36] = dreamStatus;
    $[37] = focusedToggle;
    $[38] = isDreamRunning;
    $[39] = showDreamRow;
    $[40] = t18;
  } else {
    t18 = $[40];
  }
  let t19;
  if ($[41] !== t17 || $[42] !== t18) {
    t19 = <Box flexDirection="column" marginBottom={1}>{t17}{t18}</Box>;
    $[41] = t17;
    $[42] = t18;
    $[43] = t19;
  } else {
    t19 = $[43];
  }
  let t20;
  if ($[44] !== onSelect) {
// 选中处理分两支：以目录前缀开头的值表示「打开目录」——先递归创建目录（可能还不存在）、再调用系统打开，且创建失败被静默吞掉后仍然尝试打开；其余值才是真的选了文件，此时先记住路径再回调。先创建再打开这个顺序很重要，否则新用户的自动记忆目录还不存在，打开会失败。
    t20 = value => {
      if (value.startsWith(OPEN_FOLDER_PREFIX)) {
        const folderPath = value.slice(OPEN_FOLDER_PREFIX.length);
        mkdir(folderPath, {
          recursive: true
        }).catch(_temp8).then(() => openPath(folderPath));
        return;
      }
      lastSelectedPath = value;
      onSelect(value);
    };
    $[44] = onSelect;
    $[45] = t20;
  } else {
    t20 = $[45];
  }
  let t21;
  if ($[46] !== lastToggleIndex) {
    t21 = () => setFocusedToggle(lastToggleIndex);
    $[46] = lastToggleIndex;
    $[47] = t21;
  } else {
    t21 = $[47];
  }
  let t22;
  if ($[48] !== initialPath || $[49] !== memoryOptions || $[50] !== onCancel || $[51] !== t20 || $[52] !== t21 || $[53] !== toggleFocused) {
// 下拉框的禁用条件就是「焦点在开关区」——焦点离开列表时整个列表变灰，视觉上明确了键盘此刻归谁。这个「用禁用表达焦点归属」的手法，比在列表上方加一行提示更直接。
    t22 = <Select defaultFocusValue={initialPath} options={memoryOptions} isDisabled={toggleFocused} onChange={t20} onCancel={onCancel} onUpFromFirstItem={t21} />;
    $[48] = initialPath;
    $[49] = memoryOptions;
    $[50] = onCancel;
    $[51] = t20;
    $[52] = t21;
    $[53] = toggleFocused;
    $[54] = t22;
  } else {
    t22 = $[54];
  }
  let t23;
  if ($[55] !== t19 || $[56] !== t22) {
    t23 = <Box flexDirection="column" width="100%">{t19}{t22}</Box>;
    $[55] = t19;
    $[56] = t22;
    $[57] = t23;
  } else {
    t23 = $[57];
  }
  return t23;
}
function _temp8() {}
// 钳制函数：焦点为空或已经为零时原样返回同一个值，否则减一。返回同一个引用而不是新值，是让状态更新在边界上成为空操作，避免无意义的重渲染。
function _temp7(prev_0) {
  return prev_0 !== null && prev_0 > 0 ? prev_0 - 1 : prev_0;
}
function _temp6(s_0) {
  return Object.values(s_0.tasks).some(_temp5);
}
function _temp5(t) {
  return t.type === "dream" && t.status === "running";
}
function _temp4(opt) {
  return opt.value === lastSelectedPath;
}
function _temp3(s) {
  return s.agentDefinitions;
}
function _temp2(f_2) {
  return {
    ...f_2,
    exists: true
  };
}
function _temp(f_1) {
  return f_1.type !== "AutoMem" && f_1.type !== "TeamMem";
}
// 原文件此处有一行 35088 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。