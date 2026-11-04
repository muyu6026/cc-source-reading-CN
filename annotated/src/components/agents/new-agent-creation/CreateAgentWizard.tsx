import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { isAutoMemoryEnabled } from '../../../memdir/paths.js';
import type { Tools } from '../../../Tool.js';
import type { AgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js';
import { WizardProvider } from '../../wizard/index.js';
import type { WizardStepComponent } from '../../wizard/types.js';
import type { AgentWizardData } from './types.js';
import { ColorStep } from './wizard-steps/ColorStep.js';
import { ConfirmStepWrapper } from './wizard-steps/ConfirmStepWrapper.js';
import { DescriptionStep } from './wizard-steps/DescriptionStep.js';
import { GenerateStep } from './wizard-steps/GenerateStep.js';
import { LocationStep } from './wizard-steps/LocationStep.js';
import { MemoryStep } from './wizard-steps/MemoryStep.js';
import { MethodStep } from './wizard-steps/MethodStep.js';
import { ModelStep } from './wizard-steps/ModelStep.js';
import { PromptStep } from './wizard-steps/PromptStep.js';
import { ToolsStep } from './wizard-steps/ToolsStep.js';
import { TypeStep } from './wizard-steps/TypeStep.js';
type Props = {
  tools: Tools;
  existingAgents: AgentDefinition[];
  onComplete: (message: string) => void;
  onCancel: () => void;
};
// 创建 agent 的多步向导组装器：把各步骤组件按顺序塞进 WizardProvider，自身几乎无逻辑
export function CreateAgentWizard(t0) {
  const $ = _c(17);
  const {
    tools,
    existingAgents,
    onComplete,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== existingAgents) {
    t1 = () => <TypeStep existingAgents={existingAgents} />;
// TypeStep/ToolsStep 用闭包包一层：步骤数组要求组件类型，闭包按依赖缓存（$[0]!==existingAgents 才重建），避免每次渲染产生新组件引用导致步骤状态重置
    $[0] = existingAgents;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== tools) {
    t2 = () => <ToolsStep tools={tools} />;
    $[2] = tools;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = isAutoMemoryEnabled() ? [MemoryStep] : [];
// MemoryStep 仅在 isAutoMemoryEnabled 时插入——特性探测结果被哨兵缓存，整个生命周期只求值一次
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== existingAgents || $[6] !== onComplete || $[7] !== tools) {
    t4 = () => <ConfirmStepWrapper tools={tools} existingAgents={existingAgents} onComplete={onComplete} />;
// ConfirmStepWrapper 是终点步骤：拿到 tools/existingAgents/onComplete 生成最终配置
    $[5] = existingAgents;
    $[6] = onComplete;
    $[7] = tools;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== t1 || $[10] !== t2 || $[11] !== t4) {
    t5 = [LocationStep, MethodStep, GenerateStep, t1, PromptStep, DescriptionStep, t2, ModelStep, ColorStep, ...t3, t4];
// 完整步骤序列：Location→Method→Generate→Type→Prompt→Description→Tools→Model→Color→[Memory?]→Confirm，Memory 是条件插入的可选步
    $[9] = t1;
    $[10] = t2;
    $[11] = t4;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const steps = t5;
  let t6;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {};
// initialData 用空对象哨兵：向导初始数据从空开始，缓存同一引用避免 WizardProvider 每次收到新对象
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== onCancel || $[15] !== steps) {
    t7 = <WizardProvider steps={steps} initialData={t6} onComplete={_temp} onCancel={onCancel} title="Create new agent" showStepCounter={false} />;
// onComplete 传的是 _temp 空函数——真正的完成回调由 ConfirmStepWrapper 内部处理，provider 层只是占位
    $[14] = onCancel;
    $[15] = steps;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  return t7;
}
// _temp 即空箭头函数 ()=>{}：空实现，编译器把内联空箭头函数提取成顶层函数以获得稳定引用
function _temp() {}
// 原文件此处有一行 7472 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。