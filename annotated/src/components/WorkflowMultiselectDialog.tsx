// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useState } from 'react';
// 引入 `Workflow` 类型（来自 install-github-app）与 `ExitState`。
import type { Workflow } from '../commands/install-github-app/types.js';
import type { ExitState } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Text } from '../ink.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { SelectMulti } from './CustomSelect/SelectMulti.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
// `WorkflowOption` 把 `Workflow` 包成带 label 的选项结构。
type WorkflowOption = {
  value: Workflow;
  label: string;
};
// Props：提交回调（选中哪些工作流）、默认已选集合 `defaultSelections`。
type Props = {
  onSubmit: (selectedWorkflows: Workflow[]) => void;
  defaultSelections: Workflow[];
};
// WORKFLOWS 是固定的两个可选 GitHub Action：`claude`（issue/PR 里 @ 触发）与 `claude-review`（PR 自动审查）。
const WORKFLOWS: WorkflowOption[] = [{
  value: 'claude' as const,
  label: '@Claude Code - Tag @claude in issues and PR comments'
}, {
  value: 'claude-review' as const,
  label: 'Claude Code Review - Automated code review on new PRs'
}];
// `renderInputGuide` 是一个独立函数（非编译器包裹），按 Esc 是否 pending 渲染不同的底部快捷键提示。
function renderInputGuide(exitState: ExitState): React.ReactNode {
  if (exitState.pending) {
    return <Text>Press {exitState.keyName} again to exit</Text>;
  }
  return <Byline>
      <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
      <KeyboardShortcutHint shortcut="Space" action="toggle" />
      <KeyboardShortcutHint shortcut="Enter" action="confirm" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
    </Byline>;
}
// WorkflowMultiselectDialog 在安装 GitHub App 时让用户多选要启用的工作流。
export function WorkflowMultiselectDialog(t0) {
// `_c(14)` 申请 14 个记忆槽位。
  const $ = _c(14);
  const {
    onSubmit,
    defaultSelections
  } = t0;
// `useState` 控制是否显示「至少选一个」的错误。
  const [showError, setShowError] = useState(false);
  let t1;
// 记忆 `handleSubmit`：未选任何工作流则报错返回；否则清错误并提交选中值。
  if ($[0] !== onSubmit) {
    t1 = selectedValues => {
      if (selectedValues.length === 0) {
        setShowError(true);
        return;
      }
      setShowError(false);
      onSubmit(selectedValues);
    };
    $[0] = onSubmit;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleSubmit = t1;
  let t2;
// 用哨兵记忆 `handleChange`：切换选项时清除错误提示。
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      setShowError(false);
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleChange = t2;
  let t3;
// 用哨兵记忆 `handleCancel`：从 `SelectMulti` 取消时显示错误（提示必须选）。
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = () => {
      setShowError(true);
    };
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const handleCancel = t3;
  let t4;
// 用哨兵记忆「更多示例」链接框，指向 anthropics 的 claude-code-action 示例仓库。
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box><Text dimColor={true}>More workflow examples (issue triage, CI fixes, etc.) at:{" "}<Link url="https://github.com/anthropics/claude-code-action/blob/main/examples/">https://github.com/anthropics/claude-code-action/blob/main/examples/</Link></Text></Box>;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = WORKFLOWS.map(_temp);
    $[5] = t5;
  } else {
    t5 = $[5];
  }
// 记忆 `SelectMulti`：默认全选，提交/变更/取消分别走上面三个回调，隐藏索引列。
  let t6;
  if ($[6] !== defaultSelections || $[7] !== handleSubmit) {
    t6 = <SelectMulti options={t5} defaultValue={defaultSelections} onSubmit={handleSubmit} onChange={handleChange} onCancel={handleCancel} hideIndexes={true} />;
    $[6] = defaultSelections;
    $[7] = handleSubmit;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
// 记忆错误提示框：未选时显示「至少选一个工作流」。
  let t7;
  if ($[9] !== showError) {
    t7 = showError && <Box><Text color="error">You must select at least one workflow to continue</Text></Box>;
    $[9] = showError;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
// 记忆外层 `Dialog`：标题为选择要安装的 GitHub 工作流，副标题说明会为每个选中的工作流创建文件。
  let t8;
  if ($[11] !== t6 || $[12] !== t7) {
    t8 = <Dialog title="Select GitHub workflows to install" subtitle="We'll create a workflow file in your repository for each one you select." onCancel={handleCancel} inputGuide={renderInputGuide}>{t4}{t6}{t7}</Dialog>;
    $[11] = t6;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
// `_temp` 把单个工作流映射成 `{label, value}` 选项。
function _temp(workflow) {
  return {
    label: workflow.label,
    value: workflow.value
  };
}
// 原文件此处有一行 10328 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。