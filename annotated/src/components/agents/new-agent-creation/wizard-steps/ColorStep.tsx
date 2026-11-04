import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import type { AgentColorName } from '../../../../tools/AgentTool/agentColorManager.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { ColorPicker } from '../../ColorPicker.js';
import type { AgentWizardData } from '../types.js';
// 向导的颜色步：选完颜色即在此组装 finalAgent 并进入下一步
export function ColorStep() {
  const $ = _c(14);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Confirmation"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  useKeybinding("confirm:no", goBack, t0);
// Esc 走 goBack 且上下文标 Confirmation：与其它步骤的回退键保持一致
  let t1;
  if ($[1] !== goNext || $[2] !== updateWizardData || $[3] !== wizardData.agentType || $[4] !== wizardData.location || $[5] !== wizardData.selectedModel || $[6] !== wizardData.selectedTools || $[7] !== wizardData.systemPrompt || $[8] !== wizardData.whenToUse) {
    t1 = color => {
// handleConfirm 的缓存依赖把 wizardData 的六个字段逐个列出：任何一项变化都要重建闭包，因为闭包里要读它们
      updateWizardData({
        selectedColor: color,
        finalAgent: {
// finalAgent 在这一步组装：把向导散落各步的字段拼成 AgentDefinition 形状
          agentType: wizardData.agentType,
          whenToUse: wizardData.whenToUse,
          getSystemPrompt: () => wizardData.systemPrompt,
// getSystemPrompt 存的是函数而非字符串：延迟求值，后续编辑不会被快照成旧值
          tools: wizardData.selectedTools,
          ...(wizardData.selectedModel ? {
// selectedModel 条件展开：模型未选时连 model 字段都不出现，避免写入 undefined
            model: wizardData.selectedModel
          } : {}),
          ...(color ? {
// color 同样条件展开：automatic 表示不指定颜色，此时字段缺省
            color: color as AgentColorName
          } : {}),
          source: wizardData.location
        }
      });
      goNext();
    };
    $[1] = goNext;
    $[2] = updateWizardData;
    $[3] = wizardData.agentType;
    $[4] = wizardData.location;
    $[5] = wizardData.selectedModel;
    $[6] = wizardData.selectedTools;
    $[7] = wizardData.systemPrompt;
    $[8] = wizardData.whenToUse;
    $[9] = t1;
  } else {
    t1 = $[9];
  }
  const handleConfirm = t1;
  let t2;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
// 页脚三枚提示用 Byline 串联：↑↓ 导航、Enter 选择，Esc 走 ConfigurableShortcutHint 以支持键位可配置且回退显示 Esc
    $[10] = t2;
  } else {
    t2 = $[10];
  }
  const t3 = wizardData.agentType || "agent";
// agentName 回落成 agent：颜色预览要拿名字算稳定色相，未定名时给占位名
  let t4;
  if ($[11] !== handleConfirm || $[12] !== t3) {
    t4 = <WizardDialogLayout subtitle="Choose background color" footerText={t2}><Box><ColorPicker agentName={t3} currentColor="automatic" onConfirm={handleConfirm} /></Box></WizardDialogLayout>;
    $[11] = handleConfirm;
    $[12] = t3;
    $[13] = t4;
  } else {
    t4 = $[13];
  }
  return t4;
}
// 原文件此处有一行 7384 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。