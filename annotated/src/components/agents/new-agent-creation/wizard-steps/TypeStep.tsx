import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode, useState } from 'react';
import { Box, Text } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import type { AgentDefinition } from '../../../../tools/AgentTool/loadAgentsDir.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import TextInput from '../../../TextInput.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { validateAgentType } from '../../validateAgent.js';
import type { AgentWizardData } from '../types.js';
type Props = {
  existingAgents: AgentDefinition[];
};
// TypeStep：新建代理向导第一步——输入代理类型标识。三态：agentType、error、cursorOffset，与同向导的 DescriptionStep 结构完全一致。
export function TypeStep(_props) {
  const $ = _c(15);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
// 初始值来自向导数据：返回编辑本步时恢复已填内容；光标偏移同步初始化在末尾。
  const [agentType, setAgentType] = useState(wizardData.agentType || "");
  const [error, setError] = useState(null);
  const [cursorOffset, setCursorOffset] = useState(agentType.length);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Settings"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
// confirm:no（Esc）绑定 goBack，Settings 上下文——向导各步返回键的统一接法。
  useKeybinding("confirm:no", goBack, t0);
  let t1;
  if ($[1] !== goNext || $[2] !== updateWizardData) {
// handleSubmit：trim 后调 validateAgentType（与保存前的整体验证共用同一函数，见 validateAgent.ts）。校验失败就地显示错误不前进；合法写向导数据并 goNext。
    t1 = value => {
      const trimmedValue = value.trim();
      const validationError = validateAgentType(trimmedValue);
      if (validationError) {
        setError(validationError);
        return;
      }
      setError(null);
      updateWizardData({
        agentType: trimmedValue
      });
      goNext();
    };
    $[1] = goNext;
    $[2] = updateWizardData;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const handleSubmit = t1;
  let t2;
// Byline 快捷键提示进哨兵槽：输入、回车继续、Esc 返回。
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Byline><KeyboardShortcutHint shortcut="Type" action="enter text" /><KeyboardShortcutHint shortcut="Enter" action="continue" /><ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" /></Byline>;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text>Enter a unique identifier for your agent:</Text>;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== agentType || $[7] !== cursorOffset || $[8] !== handleSubmit) {
// TextInput columns 固定 60：标识符短，输入区不必占满弹窗。placeholder 给了三个示例（test-runner、tech-lead）暗示命名风格是连字符小写。
    t4 = <Box marginTop={1}><TextInput value={agentType} onChange={setAgentType} onSubmit={handleSubmit} placeholder="e.g., test-runner, tech-lead, etc" columns={60} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} focus={true} showCursor={true} /></Box>;
    $[6] = agentType;
    $[7] = cursorOffset;
    $[8] = handleSubmit;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
// 错误行单独缓存：error 为 null 时复用 null 槽，输入过程零开销。
  if ($[10] !== error) {
    t5 = error && <Box marginTop={1}><Text color="error">{error}</Text></Box>;
    $[10] = error;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== t4 || $[13] !== t5) {
    t6 = <WizardDialogLayout subtitle="Agent type (identifier)" footerText={t2}><Box flexDirection="column">{t3}{t4}{t5}</Box></WizardDialogLayout>;
    $[12] = t4;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
// 原文件此处有一行 9056 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。