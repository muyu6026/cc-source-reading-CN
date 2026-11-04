import { c as _c } from "react/compiler-runtime";
// biome-ignore 注释保留导入顺序标记——这些 import 是「仅批注（ANT-ONLY）」工具插入的，不能被格式化器重排。
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import * as React from 'react';
import { Suspense, useState } from 'react';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import { Pane } from '../design-system/Pane.js';
import { Tabs, Tab } from '../design-system/Tabs.js';
import { Status, buildDiagnostics } from './Status.js';
import { Config } from './Config.js';
import { Usage } from './Usage.js';
// Props：关闭回调、命令上下文、默认打开的标签页（Status/Config/Usage/Gates 之一）。
import type { LocalJSXCommandContext, CommandResultDisplay } from '../../commands.js';
type Props = {
  onClose: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  context: LocalJSXCommandContext;
  defaultTab: 'Status' | 'Config' | 'Usage' | 'Gates';
};
// Settings 是设置弹窗主体，用 `Tabs` 组织 Status / Config / Usage 三个标签（Gates 当前被禁用）。
export function Settings(t0) {
// `_c(25)` 申请 25 个记忆槽位。
  const $ = _c(25);
  const {
    onClose,
    context,
    defaultTab
  } = t0;
// 四个 `useState`：当前标签、标签是否隐藏、Config 是否独占 Esc、Gates 是否独占 Esc。后两个用于在嵌入输入框时把 Esc 让给子组件。
  const [selectedTab, setSelectedTab] = useState(defaultTab);
  const [tabsHidden, setTabsHidden] = useState(false);
  const [configOwnsEsc, setConfigOwnsEsc] = useState(false);
  const [gatesOwnsEsc, setGatesOwnsEsc] = useState(false);
// `useIsInsideModal` 判断弹窗是否嵌在模态框里，这会改变可用高度的计算方式。
  const insideModal = useIsInsideModal();
  const {
    rows
  } = useModalOrTerminalSize(useTerminalSize());
// 内容高度：模态框内用 `rows+1`；否则取终端高度 80% 并夹在 15 到 30 行之间。
  const contentHeight = insideModal ? rows + 1 : Math.max(15, Math.min(Math.floor(rows * 0.8), 30));
// 诊断信息来自一个 Promise：`_temp2` 在首次渲染时建立，失败则 catch 成空数组（见文件末尾 `_temp`）。
  const [diagnosticsPromise] = useState(_temp2);
  useExitOnCtrlCDWithKeybindings();
  let t1;
  if ($[0] !== onClose || $[1] !== tabsHidden) {
    t1 = () => {
      if (tabsHidden) {
        return;
      }
// 记忆 `handleEscape`：标签未隐藏时才真正关闭，并回一条 `display:`system`` 消息表示「Status 对话框已关闭」。
      onClose("Status dialog dismissed", {
        display: "system"
      });
    };
    $[0] = onClose;
    $[1] = tabsHidden;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleEscape = t1;
// `t2` 计算确认键是否生效：标签未隐藏、且当前不是由 Config/Gates 独占 Esc 时才激活。
  const t2 = !tabsHidden && !(selectedTab === "Config" && configOwnsEsc) && !(selectedTab === "Gates" && gatesOwnsEsc);
  let t3;
  if ($[3] !== t2) {
    t3 = {
      context: "Settings",
      isActive: t2
    };
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  useKeybinding("confirm:no", handleEscape, t3);
  let t4;
// 记忆 Status 标签页内容：把诊断 Promise 透传给 `Status` 组件。
  if ($[5] !== context || $[6] !== diagnosticsPromise) {
    t4 = <Tab key="status" title="Status"><Status context={context} diagnosticsPromise={diagnosticsPromise} /></Tab>;
    $[5] = context;
    $[6] = diagnosticsPromise;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
// 记忆 Config 标签页：用 `Suspense` 包住懒加载的 `Config`，并把切 Esc 归属的回调 `setConfigOwnsEsc` 传下去。
  if ($[8] !== contentHeight || $[9] !== context || $[10] !== onClose) {
    t5 = <Tab key="config" title="Config"><Suspense fallback={null}><Config context={context} onClose={onClose} setTabsHidden={setTabsHidden} onIsSearchModeChange={setConfigOwnsEsc} contentHeight={contentHeight} /></Suspense></Tab>;
    $[8] = contentHeight;
    $[9] = context;
    $[10] = onClose;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Tab key="usage" title="Usage"><Usage /></Tab>;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
// Gates 标签页目前是禁用的：`false ? [<Gates/>] : []`，编译后恒为空数组，保留接口位置以便日后启用。
  let t7;
  if ($[13] !== contentHeight) {
    t7 = false ? [<Tab key="gates" title="Gates"><Gates onOwnsEscChange={setGatesOwnsEsc} contentHeight={contentHeight} /></Tab>] : [];
    $[13] = contentHeight;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== t4 || $[16] !== t5 || $[17] !== t7) {
    t8 = [t4, t5, t6, ...t7];
    $[15] = t4;
    $[16] = t5;
    $[17] = t7;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  const tabs = t8;
  const t9 = defaultTab !== "Config" && defaultTab !== "Gates";
  const t10 = tabsHidden || insideModal ? undefined : contentHeight;
  let t11;
// 记忆整体结构：用 `Pane` 包住 `Tabs`，把 selectedTab、隐藏状态、初始焦点等全部传给 Tabs。
  if ($[19] !== selectedTab || $[20] !== t10 || $[21] !== t9 || $[22] !== tabs || $[23] !== tabsHidden) {
    t11 = <Pane color="permission"><Tabs color="permission" selectedTab={selectedTab} onTabChange={setSelectedTab} hidden={tabsHidden} initialHeaderFocused={t9} contentHeight={t10}>{tabs}</Tabs></Pane>;
    $[19] = selectedTab;
    $[20] = t10;
    $[21] = t9;
    $[22] = tabs;
    $[23] = tabsHidden;
    $[24] = t11;
  } else {
    t11 = $[24];
  }
  return t11;
}
// `_temp2` 首次建立诊断 Promise；`buildDiagnostics` 失败时由 `_temp` 兜底为空数组。
function _temp2() {
  return buildDiagnostics().catch(_temp);
}
function _temp() {
  return [];
}
// 原文件此处有一行 14224 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。