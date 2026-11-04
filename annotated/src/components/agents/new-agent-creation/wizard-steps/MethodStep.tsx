import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
// 向导的创建方式步：让 Claude 生成 vs 手动配置
export function MethodStep() {
  const $ = _c(11);
  const {
    goNext,
    goBack,
    updateWizardData,
    goToStep
  } = useWizard();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = [{
// 两个选项：生成（文案里标 recommended）与手动——推荐是靠「排第一加文案标注」，不是独立开关
      label: "Generate with Claude (recommended)",
      value: "generate"
    }, {
      label: "Manual configuration",
      value: "manual"
    }];
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const methodOptions = t0;
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
// 页脚提示：↑↓ 导航、Enter 选择，Esc 走可配置键位
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== goNext || $[3] !== goToStep || $[4] !== updateWizardData) {
    t2 = value => {
// 选择回调先写 method 与 wasGenerated 两个字段
      const method = value as 'generate' | 'manual';
      updateWizardData({
        method,
        wasGenerated: method === "generate"
// wasGenerated 是 method 的派生值：冗余存一份，后续步骤不必再判断 method 就知道来源
      });
      if (method === "generate") {
// 生成走 goNext，手动直接 goToStep(3) 跳到提示词步——跳步是按索引硬编码的，插入新步骤要同步改这里
        goNext();
      } else {
        goToStep(3);
      }
    };
    $[2] = goNext;
    $[3] = goToStep;
    $[4] = updateWizardData;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== goBack) {
    t3 = () => goBack();
// onCancel 包一层无参函数
    $[6] = goBack;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  let t4;
  if ($[8] !== t2 || $[9] !== t3) {
    t4 = <WizardDialogLayout subtitle="Creation method" footerText={t1}><Box><Select key="method-select" options={methodOptions} onChange={t2} onCancel={t3} /></Box></WizardDialogLayout>;
// Select 的 key 用 method-select：换实例时重置内部光标位置
    $[8] = t2;
    $[9] = t3;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  return t4;
}
// 原文件此处有一行 6172 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。