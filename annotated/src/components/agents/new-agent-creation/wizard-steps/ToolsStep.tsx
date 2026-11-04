import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import type { Tools } from '../../../../Tool.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ToolSelector } from '../../ToolSelector.js';
import type { AgentWizardData } from '../types.js';
type Props = {
  tools: Tools;
};
// 新建智能体向导的「选工具」步骤：用 `ToolSelector` 选择并写入向导数据后进入下一步。
export function ToolsStep(t0) {
  const $ = _c(9);
  const {
    tools
  } = t0;
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
  let t1;
  if ($[0] !== goNext || $[1] !== updateWizardData) {
    t1 = selectedTools => {
      updateWizardData({
        selectedTools
      });
      goNext();
    };
    $[0] = goNext;
    $[1] = updateWizardData;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleComplete = t1;
  const initialTools = wizardData.selectedTools;
// 初始已选工具取自向导数据里已存的 `selectedTools`。
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Byline><KeyboardShortcutHint shortcut="Enter" action="toggle selection" /><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== goBack || $[5] !== handleComplete || $[6] !== initialTools || $[7] !== tools) {
    t3 = <WizardDialogLayout subtitle="Select tools" footerText={t2}><ToolSelector tools={tools} initialTools={initialTools} onComplete={handleComplete} onCancel={goBack} /></WizardDialogLayout>;
    $[4] = goBack;
    $[5] = handleComplete;
    $[6] = initialTools;
    $[7] = tools;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
// 底部提示复用 `Byline` 展示回车切换、方向键导航、Esc 返回等快捷键。
// 原文件此处有一行 5228 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。