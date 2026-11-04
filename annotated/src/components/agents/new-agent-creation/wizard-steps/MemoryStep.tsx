import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { isAutoMemoryEnabled } from '../../../../memdir/paths.js';
import { type AgentMemoryScope, loadAgentMemoryPrompt } from '../../../../tools/AgentTool/agentMemory.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
// MemoryOption：value 是三种 AgentMemoryScope（user、project、local）或 none——none 表示不给代理持久记忆，选中时存 undefined。
type MemoryOption = {
  label: string;
  value: AgentMemoryScope | 'none';
};
// 新建代理向导的记忆配置步：决定代理的系统提示词要不要拼接记忆目录的使用说明。_c(13) 四段缓存。
export function MemoryStep() {
  const $ = _c(13);
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
// confirm:no（Esc）绑定 goBack，上下文是 Confirmation——向导每一步的返回键都这么接。
  useKeybinding("confirm:no", goBack, t0);
// isUserScope：向导的 location 是 userSettings（用户在改全局配置）还是项目级。它决定推荐项——全局配置推荐 user 记忆目录，项目配置推荐 project 记忆目录。
  const isUserScope = wizardData.location === "userSettings";
  let t1;
// 选项数组随 isUserScope 整体重建：推荐项永远排第一并标注 Recommended，其余按 user、none、project、local 固定次序跟随。推荐是位置不是开关——不加「推荐与否」的独立状态，直接换数组。
  if ($[1] !== isUserScope) {
    t1 = isUserScope ? [{
      label: "User scope (~/.claude/agent-memory/) (Recommended)",
      value: "user"
    }, {
      label: "None (no persistent memory)",
      value: "none"
    }, {
      label: "Project scope (.claude/agent-memory/)",
      value: "project"
    }, {
      label: "Local scope (.claude/agent-memory-local/)",
      value: "local"
    }] : [{
      label: "Project scope (.claude/agent-memory/) (Recommended)",
      value: "project"
    }, {
      label: "None (no persistent memory)",
      value: "none"
    }, {
      label: "User scope (~/.claude/agent-memory/)",
      value: "user"
    }, {
      label: "Local scope (.claude/agent-memory-local/)",
      value: "local"
    }];
    $[1] = isUserScope;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const memoryOptions = t1;
  let t2;
  if ($[3] !== goNext || $[4] !== updateWizardData || $[5] !== wizardData.finalAgent || $[6] !== wizardData.systemPrompt) {
// handleSelect：none 映射为 undefined 写进向导数据；关键是 getSystemPrompt 闭包——启用自动记忆且选了记忆目录时，系统提示词在向导此刻就定死为「基础提示词拼接记忆目录说明」的函数，之后代理每次启动调用它。
    t2 = value => {
      const memory = value === "none" ? undefined : value as AgentMemoryScope;
// agentType 从已生成的 finalAgent 里取：记忆说明文案按代理类型不同（主代理与子代理的记忆目录布局不同）。finalAgent 为空说明前一步没走完，整个更新跳过。
      const agentType = wizardData.finalAgent?.agentType;
      updateWizardData({
        selectedMemory: memory,
        finalAgent: wizardData.finalAgent ? {
          ...wizardData.finalAgent,
          memory,
          getSystemPrompt: isAutoMemoryEnabled() && memory && agentType ? () => wizardData.systemPrompt + "\n\n" + loadAgentMemoryPrompt(agentType, memory) : () => wizardData.systemPrompt
        } : undefined
      });
      goNext();
    };
    $[3] = goNext;
    $[4] = updateWizardData;
    $[5] = wizardData.finalAgent;
    $[6] = wizardData.systemPrompt;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  const handleSelect = t2;
  let t3;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
// Byline 快捷键提示进常量槽：上下导航、回车选择、Esc 返回。
    t3 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action="navigate" /><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" /></Byline>;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  let t4;
  if ($[9] !== goBack || $[10] !== handleSelect || $[11] !== memoryOptions) {
// Select 带 key 为 memory-select：isUserScope 切换导致选项数组整体变化时，key 保证 Select 内部状态（如光标位置）重置到新数组头部——推荐项的第一位置立刻可见。
    t4 = <WizardDialogLayout subtitle="Configure agent memory" footerText={t3}><Box><Select key="memory-select" options={memoryOptions} onChange={handleSelect} onCancel={goBack} /></Box></WizardDialogLayout>;
    $[9] = goBack;
    $[10] = handleSelect;
    $[11] = memoryOptions;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  return t4;
}
// 原文件此处有一行 10208 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。