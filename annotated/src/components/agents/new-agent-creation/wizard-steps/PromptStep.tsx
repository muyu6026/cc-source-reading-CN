// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode, useCallback, useState } from 'react';
import { Box, Text } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
// `editPromptInEditor` 把当前 prompt 丢进外部编辑器，让用户用惯用编辑器写长文本。
import { editPromptInEditor } from '../../../../utils/promptEditor.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import TextInput from '../../../TextInput.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
// 从 `../types.js` 引入 `AgentWizardData`，即新建智能体向导的累积数据。
import type { AgentWizardData } from '../types.js';
// PromptStep 是「新建智能体」向导里的「系统提示词」一步：让用户填写并校验系统提示词。
export function PromptStep() {
// `_c(20)` 申请 20 个记忆槽位。
  const $ = _c(20);
// 从 `useWizard` 取出导航与数据更新函数，以及当前向导数据。
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
// `systemPrompt` 以向导里已有的值为初值（为空则用空串），`cursorOffset` 初始指向文末。
  const [systemPrompt, setSystemPrompt] = useState(wizardData.systemPrompt || "");
  const [cursorOffset, setCursorOffset] = useState(systemPrompt.length);
  const [error, setError] = useState(null);
  let t0;
// 首次渲染建立确认键上下文 `{context:`Settings`}`，供下面 Esc 返回用。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Settings"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
// 把 Esc（`confirm:no`）绑定到 `goBack`，上下文为 Settings。
  useKeybinding("confirm:no", goBack, t0);
  let t1;
// 记忆 `handleExternalEditor`：打开外部编辑器编辑 prompt，返回后更新内容与光标。
  if ($[1] !== systemPrompt) {
    t1 = async () => {
      const result = await editPromptInEditor(systemPrompt);
      if (result.content !== null) {
        setSystemPrompt(result.content);
        setCursorOffset(result.content.length);
      }
    };
    $[1] = systemPrompt;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleExternalEditor = t1;
  let t2;
// 首次渲染建立 `chat:externalEditor` 的上下文字典 `{context:`Chat`}`。
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Chat"
    };
    $[3] = t2;
  } else {
    t2 = $[3];
  }
// 把 `chat:externalEditor` 绑定到 `handleExternalEditor`（ctrl+g 默认）。
  useKeybinding("chat:externalEditor", handleExternalEditor, t2);
// 记忆 `handleSubmit`：trim 后为空则报错；否则写入向导数据并前进到下一步。
  let t3;
  if ($[4] !== goNext || $[5] !== systemPrompt || $[6] !== updateWizardData) {
    t3 = () => {
      const trimmedPrompt = systemPrompt.trim();
      if (!trimmedPrompt) {
        setError("System prompt is required");
        return;
      }
      setError(null);
      updateWizardData({
        systemPrompt: trimmedPrompt
      });
      goNext();
    };
    $[4] = goNext;
    $[5] = systemPrompt;
    $[6] = updateWizardData;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const handleSubmit = t3;
  let t4;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Byline><KeyboardShortcutHint shortcut="Type" action="enter text" /><KeyboardShortcutHint shortcut="Enter" action="continue" /><ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+g" description="open in editor" /><ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" /></Byline>;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>Enter the system prompt for your agent:</Text>;
    t6 = <Text dimColor={true}>Be comprehensive for best results</Text>;
    $[9] = t5;
    $[10] = t6;
  } else {
    t5 = $[9];
    t6 = $[10];
  }
  let t7;
// 记忆输入区 `TextInput`：列宽固定 80、显示光标与焦点、同步光标偏移，提交走 `handleSubmit`。
  if ($[11] !== cursorOffset || $[12] !== handleSubmit || $[13] !== systemPrompt) {
    t7 = <Box marginTop={1}><TextInput value={systemPrompt} onChange={setSystemPrompt} onSubmit={handleSubmit} placeholder="You are a helpful code reviewer who..." columns={80} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} focus={true} showCursor={true} /></Box>;
    $[11] = cursorOffset;
    $[12] = handleSubmit;
    $[13] = systemPrompt;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
// 记忆错误提示框：仅 `error` 非空时显示。
  let t8;
  if ($[15] !== error) {
    t8 = error && <Box marginTop={1}><Text color="error">{error}</Text></Box>;
    $[15] = error;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
// 记忆整体布局：用 `WizardDialogLayout` 包住说明、输入区与错误提示，副标题为 System prompt。
  let t9;
  if ($[17] !== t7 || $[18] !== t8) {
    t9 = <WizardDialogLayout subtitle="System prompt" footerText={t4}><Box flexDirection="column">{t5}{t6}{t7}{t8}</Box></WizardDialogLayout>;
    $[17] = t7;
    $[18] = t8;
    $[19] = t9;
  } else {
    t9 = $[19];
  }
  return t9;
}
// 原文件此处有一行 10672 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。