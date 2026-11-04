import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ModelSelector } from '../../ModelSelector.js';
import type { AgentWizardData } from '../types.js';
// 新建 agent 向导的「选择模型」步骤：组装底部快捷键提示并渲染模型选择对话框。
export function ModelStep() {
  const $ = _c(8);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
// 从向导上下文取出导航与数据回调，以及当前已选模型。
  let t0;
  if ($[0] !== goNext || $[1] !== updateWizardData) {
    t0 = model => {
      updateWizardData({
        selectedModel: model
      });
      goNext();
    };
    $[0] = goNext;
    $[1] = updateWizardData;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const handleComplete = t0;
// 将构造好的完成回调暴露给后续渲染使用。
  let t1;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
// 构造底部快捷键提示行（Byline 包裹各类 hint）。
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== goBack || $[5] !== handleComplete || $[6] !== wizardData.selectedModel) {
    t2 = <WizardDialogLayout subtitle="Select model" footerText={t1}><ModelSelector initialModel={wizardData.selectedModel} onComplete={handleComplete} onCancel={goBack} /></WizardDialogLayout>;
// 渲染向导对话框，内部挂载模型选择器并绑定完成/取消回调。
    $[4] = goBack;
    $[5] = handleComplete;
    $[6] = wizardData.selectedModel;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
// 返回组装好的对话框节点。
}
// 原文件此处有一行 4516 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。