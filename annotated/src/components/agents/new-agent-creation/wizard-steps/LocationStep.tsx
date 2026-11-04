import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import type { SettingSource } from '../../../../utils/settings/constants.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
// 向导的保存位置步：项目级 .claude/agents 或用户级 ~/.claude/agents
export function LocationStep() {
  const $ = _c(11);
  const {
    goNext,
    updateWizardData,
    cancel
  } = useWizard();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
// 第一项单独缓存（$[0]），第二项数组复用第一项（$[1]）：编译器的分层缓存
      label: "Project (.claude/agents/)",
      value: "projectSettings" as SettingSource
// value 用 SettingSource 类型标注：与设置系统共用同一套来源枚举，不引入自定义字符串
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [t0, {
// 两项顺序即优先级展示：项目级在前
      label: "Personal (~/.claude/agents/)",
      value: "userSettings" as SettingSource
    }];
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const locationOptions = t1;
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline>;
// Esc 提示的 description 是 cancel，而同目录的 MethodStep 写 go back：同一步的语义差异体现在文案上
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== goNext || $[4] !== updateWizardData) {
    t3 = value => {
// 选择即写 location 并前进，没有二次确认
      updateWizardData({
        location: value as SettingSource
      });
      goNext();
    };
    $[3] = goNext;
    $[4] = updateWizardData;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== cancel) {
    t4 = () => cancel();
// 取消包一层无参函数
    $[6] = cancel;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== t3 || $[9] !== t4) {
    t5 = <WizardDialogLayout subtitle="Choose location" footerText={t2}><Box><Select key="location-select" options={locationOptions} onChange={t3} onCancel={t4} /></Box></WizardDialogLayout>;
// key 用 location-select，与 MethodStep 同一做法
    $[8] = t3;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  return t5;
}
// 原文件此处有一行 5888 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。