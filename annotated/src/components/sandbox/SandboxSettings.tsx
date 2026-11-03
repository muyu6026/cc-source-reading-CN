// 沙箱设置面板。用 Tabs 分出模式 / 覆盖 / 配置 / 依赖四页，但**页签集合不是固定的**：依赖检查有错时只留依赖页、有警告时在模式页后面插依赖页。这种「页签随环境状态增减」的形态，比固定四页更接近真实排障流程——装不上沙箱的人第一件需要的不是模式选择，而是看依赖缺什么。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, color, Link, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { CommandResultDisplay } from '../../types/command.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/select.js';
import { Pane } from '../design-system/Pane.js';
import { Tab, Tabs, useTabHeaderFocus } from '../design-system/Tabs.js';
import { SandboxConfigTab } from './SandboxConfigTab.js';
import { SandboxDependenciesTab } from './SandboxDependenciesTab.js';
import { SandboxOverridesTab } from './SandboxOverridesTab.js';
// `onComplete` 的签名里带 `display?: CommandResultDisplay`，这个可选参数是「回执要不要显示」的开关：选定模式时返回一句确认文案（正常显示），按 Esc 退出时返回 undefined 并显式给 `display: 'skip'`，避免在对话里留下一条「命令已取消」的噪音。
type Props = {
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  depCheck: SandboxDependencyCheck;
};
// 三种模式是一个**扁平三选一**：auto-allow（开沙箱 + 自动放行 bash）、regular（开沙箱 + 正常权限）、disabled（不开）。注意它把「是否开沙箱」与「沙箱内的 bash 是否自动放行」这两个独立开关压成三档，是为了避免用户选出「开沙箱但 bash 也完全不走沙箱」这种自相矛盾的组合。
type SandboxMode = 'auto-allow' | 'regular' | 'disabled';
export function SandboxSettings(t0) {
  const $ = _c(34);
  const {
    onComplete,
    depCheck
  } = t0;
  const [theme] = useTheme();
// 当前状态不从上一次的选择里读，而是**每次渲染直接从 SandboxManager 问**。这保证面板显示的永远是系统真实状态——即使用户在别处改了配置（或配置文件被手改），打开面板也不会显示过时的值。
  const currentEnabled = SandboxManager.isSandboxingEnabled();
  const currentAutoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled();
  const hasWarnings = depCheck.warnings.length > 0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getSettings_DEPRECATED();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const settings = t1;
// `allowAllUnixSockets` 是唯一一个从设置了里直读的字段，用来决定要不要显示 socket 警告。语义是：如果用户已经明确允许所有 unix socket，那么「无法阻断 unix domain socket」这条警告就没有意义了，不该再吓他。
  const allowAllUnixSockets = settings.sandbox?.network?.allowAllUnixSockets;
  const showSocketWarning = hasWarnings && !allowAllUnixSockets;
// `getCurrentMode` 的推导顺序体现优先级：**先判未启用**，再判自动放行，否则 regular。顺序不能反——未启用时 autoAllowBashIfSandboxed 可能还是上次留下的 true，若先判它就会把「已关闭」误显示成 auto-allow。
  const getCurrentMode = () => {
    if (!currentEnabled) {
      return "disabled";
    }
    if (currentAutoAllow) {
      return "auto-allow";
    }
    return "regular";
  };
  const currentMode = getCurrentMode();
  let t2;
  if ($[1] !== theme) {
// `(current)` 标记是用 `color('success', theme)` 预渲染成一个**字符串**而不是 JSX 节点，因为它要拼进 label 字符串里。这是终端 UI 里少见的「颜色进字符串」做法，需要 theme 在手，所以它也是本组件唯一依赖 `useTheme` 的地方。
    t2 = color("success", theme)("(current)");
    $[1] = theme;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const currentIndicator = t2;
// 三个 label 都是「基础文案 + 当前项才追加大括号标记」。这是单选列表的常用手法：不用额外的勾选列，标记直接进文案，选中态与焦点态就不会打架（焦点由 Select 画指针，选中由这里画标记）。
  const t3 = currentMode === "auto-allow" ? `Sandbox BashTool, with auto-allow ${currentIndicator}` : "Sandbox BashTool, with auto-allow";
  let t4;
  if ($[3] !== t3) {
    t4 = {
      label: t3,
      value: "auto-allow"
    };
    $[3] = t3;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const t5 = currentMode === "regular" ? `Sandbox BashTool, with regular permissions ${currentIndicator}` : "Sandbox BashTool, with regular permissions";
  let t6;
  if ($[5] !== t5) {
    t6 = {
      label: t5,
      value: "regular"
    };
    $[5] = t5;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
// 「No Sandbox」前面用空心圆（U+25CB），另两档用对勾（U+2713）。语义上是「关闭」与「启用」的区别，视觉上也刻意不同——避免用户以为自己选中的是同一个东西。
  const t7 = currentMode === "disabled" ? `No Sandbox ${currentIndicator}` : "No Sandbox";
  let t8;
  if ($[7] !== t7) {
    t8 = {
      label: t7,
      value: "disabled"
    };
    $[7] = t7;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  let t9;
  if ($[9] !== t4 || $[10] !== t6 || $[11] !== t8) {
    t9 = [t4, t6, t8];
    $[9] = t4;
    $[10] = t6;
    $[11] = t8;
    $[12] = t9;
  } else {
    t9 = $[12];
  }
  const options = t9;
  let t10;
  if ($[13] !== onComplete) {
// 选定模式后调用 `setSandboxSettings` 写入两个字段，然后回一句确认。注意每档都**显式写全两个字段**，而不是只写变化的那一个：只写部分字段会让旧的 autoAllow 值残留下来，产生「关了沙箱但 autoAllow 还是 true」的脏状态。
    t10 = async function handleSelect(value) {
      const mode = value as SandboxMode;
      bb33: switch (mode) {
        case "auto-allow":
          {
            await SandboxManager.setSandboxSettings({
              enabled: true,
              autoAllowBashIfSandboxed: true
            });
            onComplete("\u2713 Sandbox enabled with auto-allow for bash commands");
            break bb33;
          }
        case "regular":
          {
            await SandboxManager.setSandboxSettings({
              enabled: true,
              autoAllowBashIfSandboxed: false
            });
            onComplete("\u2713 Sandbox enabled with regular bash permissions");
            break bb33;
          }
        case "disabled":
          {
            await SandboxManager.setSandboxSettings({
              enabled: false,
              autoAllowBashIfSandboxed: false
            });
            onComplete("\u25CB Sandbox disabled");
          }
      }
    };
    $[13] = onComplete;
    $[14] = t10;
  } else {
    t10 = $[14];
  }
  const handleSelect = t10;
  let t11;
  if ($[15] !== onComplete) {
    t11 = {
// `confirm:no` 绑定（Esc / 选 No）走 `onComplete(undefined, { display: 'skip' })`。这是本组件与调用方的约定：**不返回文案 + 标记 skip**，调用方据此完全不渲染任何东西。若返回空字符串，对话里还会多一个空行。
      "confirm:no": () => onComplete(undefined, {
        display: "skip"
      })
    };
    $[15] = onComplete;
    $[16] = t11;
  } else {
    t11 = $[16];
  }
  let t12;
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = {
      context: "Settings"
    };
    $[17] = t12;
  } else {
    t12 = $[17];
  }
  useKeybindings(t11, t12);
  let t13;
  if ($[18] !== handleSelect || $[19] !== onComplete || $[20] !== options || $[21] !== showSocketWarning) {
// Mode 页把 options 与 onSelect 往下传，自己只负责外层 Tab 壳。注意它同时传了 `showSocketWarning`——警告是显示在**模式页顶部**的，因为「无法阻断 socket」这件事直接影响用户该不该选 auto-allow。
    t13 = <Tab key="mode" title="Mode"><SandboxModeTab showSocketWarning={showSocketWarning} options={options} onSelect={handleSelect} onComplete={onComplete} /></Tab>;
    $[18] = handleSelect;
    $[19] = onComplete;
    $[20] = options;
    $[21] = showSocketWarning;
    $[22] = t13;
  } else {
    t13 = $[22];
  }
  const modeTab = t13;
  let t14;
  if ($[23] !== onComplete) {
    t14 = <Tab key="overrides" title="Overrides"><SandboxOverridesTab onComplete={onComplete} /></Tab>;
    $[23] = onComplete;
    $[24] = t14;
  } else {
    t14 = $[24];
  }
  const overridesTab = t14;
  let t15;
  if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Tab key="config" title="Config"><SandboxConfigTab /></Tab>;
    $[25] = t15;
  } else {
    t15 = $[25];
  }
  const configTab = t15;
// 依赖检查有 **errors** 时走完全不同的页签集合：只剩「Dependencies」一页。这意味着用户在这个状态下**无法**从界面上改模式——因为沙箱根本跑不起来，让他先选模式毫无意义。有 warnings 时则保留模式页、在它后面插依赖页（可以继续用，但建议修）。
  const hasErrors = depCheck.errors.length > 0;
  let t16;
  if ($[26] !== depCheck || $[27] !== hasErrors || $[28] !== hasWarnings || $[29] !== modeTab || $[30] !== overridesTab) {
// 页签数组用一个三目整体构造：`hasErrors ? [只依赖页] : [模式页, ...(有警告 ? [依赖页] : []), 覆盖页, 配置页]`。中间的展开是「条件插入」，这种写法比 `if` 里 push 更紧凑，但要注意顺序——依赖页被特意放在模式页之后、覆盖页之前，因为它属于「先看清环境再配置」的那一步。
    t16 = hasErrors ? [<Tab key="dependencies" title="Dependencies"><SandboxDependenciesTab depCheck={depCheck} /></Tab>] : [modeTab, ...(hasWarnings ? [<Tab key="dependencies" title="Dependencies"><SandboxDependenciesTab depCheck={depCheck} /></Tab>] : []), overridesTab, configTab];
    $[26] = depCheck;
    $[27] = hasErrors;
    $[28] = hasWarnings;
    $[29] = modeTab;
    $[30] = overridesTab;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  const tabs = t16;
  let t17;
  if ($[32] !== tabs) {
// `defaultTab=「Mode」` 是硬编码的默认页。所以**依赖有错时**用户进来会落到「不存在的 Mode 页」吗？不会——Tabs 组件在 defaultTab 不存在时会退到第一个页签，这也是为什么有错时把依赖页放在数组第一位而不是靠后。
    t17 = <Pane color="permission"><Tabs title="Sandbox:" color="permission" defaultTab="Mode">{tabs}</Tabs></Pane>;
    $[32] = tabs;
    $[33] = t17;
  } else {
    t17 = $[33];
  }
  return t17;
}
function SandboxModeTab(t0) {
  const $ = _c(16);
  const {
    showSocketWarning,
    options,
    onSelect,
    onComplete
  } = t0;
// `useTabHeaderFocus` 让「焦点在页签栏」与「焦点在内容里」互斥：headerFocused 为真时 Select 被禁用（isDisabled），此时方向键交给 Tabs 切页；否则方向键在选项里移动。这是设计系统 Tabs 约定的协作方式，页面自己不用管键位冲突。
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  let t1;
  if ($[0] !== showSocketWarning) {
    t1 = showSocketWarning && <Box marginBottom={1}><Text color="warning">Cannot block unix domain sockets (see Dependencies tab)</Text></Box>;
    $[0] = showSocketWarning;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box marginBottom={1}><Text bold={true}>Configure Mode:</Text></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== onComplete) {
    t3 = () => onComplete(undefined, {
      display: "skip"
    });
    $[3] = onComplete;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== focusHeader || $[6] !== headerFocused || $[7] !== onSelect || $[8] !== options || $[9] !== t3) {
// `onUpFromFirstItem={focusHeader}`：在选项列表第一项再按上键，焦点**交还给页签栏**。这个「向上溢出即回上级」的约定在终端多级界面里是通用手势，缺了它用户就只能靠 Tab 键切页、或者以为卡住了。
    t4 = <Select options={options} onChange={onSelect} onCancel={t3} onUpFromFirstItem={focusHeader} isDisabled={headerFocused} />;
    $[5] = focusHeader;
    $[6] = headerFocused;
    $[7] = onSelect;
    $[8] = options;
    $[9] = t3;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  let t5;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
// 页脚说明只解释 auto-allow 一档，因为另外两档的语义分别由「regular permissions」与「No Sandbox」自明。凡是「三档里只有一档需要解释」的选项组，都值得把说明写成针对性的段落，而不是给三档各写一句对称的废话。
    t5 = <Text dimColor={true}><Text bold={true} dimColor={true}>Auto-allow mode:</Text>{" "}Commands will try to run in the sandbox automatically, and attempts to run outside of the sandbox fallback to regular permissions. Explicit ask/deny rules are always respected.</Text>;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box flexDirection="column" marginTop={1} gap={1}>{t5}<Text dimColor={true}>Learn more:{" "}<Link url="https://code.claude.com/docs/en/sandboxing">code.claude.com/docs/en/sandboxing</Link></Text></Box>;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] !== t1 || $[14] !== t4) {
    t7 = <Box flexDirection="column" paddingY={1}>{t1}{t2}{t4}{t6}</Box>;
    $[13] = t1;
    $[14] = t4;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  return t7;
}
// 原文件此处有一行 21304 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。