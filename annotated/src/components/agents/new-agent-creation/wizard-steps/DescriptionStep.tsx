import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode, useCallback, useState } from 'react';
import { Box, Text } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { editPromptInEditor } from '../../../../utils/promptEditor.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import TextInput from '../../../TextInput.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import type { AgentWizardData } from '../types.js';
// 新建代理向导的描述步骤（第二步）。标题副文案里点明用途：告诉 Claude 什么时候该用这个代理，也就是系统提示词里的 whenToUse 字段。
export function DescriptionStep() {
  const $ = _c(18);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
// 本地状态初始化自向导数据：返回编辑本步时能恢复已填内容。光标偏移同步初始化在文本末尾，避免返回编辑时光标跳到开头。
  const [whenToUse, setWhenToUse] = useState(wizardData.whenToUse || "");
// cursorOffset 与文本一起受控：输入时 onChangeCursorOffset 同步，外部编辑器返回时也重置到末尾。TextInput 的受控光标见第 96 行。
  const [cursorOffset, setCursorOffset] = useState(whenToUse.length);
  const [error, setError] = useState(null);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Settings"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
// confirm:no（默认 Esc）绑定 goBack：在 Settings 上下文里返回上一步。useKeybinding 第三参数是作用域描述对象，进常量槽。
  useKeybinding("confirm:no", goBack, t0);
  let t1;
  if ($[1] !== whenToUse) {
// 外部编辑器回调：把当前文本交给 editPromptInEditor，用户在 $EDITOR 里改完返回后写回文本并重置光标。content 为 null 表示用户清空或取消编辑器，此时不动原文本。
    t1 = async () => {
      const result = await editPromptInEditor(whenToUse);
      if (result.content !== null) {
        setWhenToUse(result.content);
        setCursorOffset(result.content.length);
      }
    };
    $[1] = whenToUse;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleExternalEditor = t1;
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Chat"
    };
    $[3] = t2;
  } else {
    t2 = $[3];
  }
// chat:externalEditor（默认 ctrl+g）绑定同一回调：长描述适合在外部编辑器里写，快捷键提示在 Byline 里可见（第 82 行）。
  useKeybinding("chat:externalEditor", handleExternalEditor, t2);
  let t3;
  if ($[4] !== goNext || $[5] !== updateWizardData) {
// 提交校验：trim 后为空就地报错不前进；合法则把修剪后的值写回向导数据并 goNext。错误只在提交瞬间产生，输入变化不会主动清除（见第 105 行，error 状态只在下次提交时被覆盖）。
    t3 = value => {
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        setError("Description is required");
        return;
      }
      setError(null);
      updateWizardData({
        whenToUse: trimmedValue
      });
      goNext();
    };
    $[4] = goNext;
    $[5] = updateWizardData;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const handleSubmit = t3;
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// Byline 快捷键提示行：输入、回车继续、ctrl+g 外部编辑、Esc 返回。四条提示全部进常量槽，与文本内容一样只建一次。
    t4 = <Byline><KeyboardShortcutHint shortcut="Type" action="enter text" /><KeyboardShortcutHint shortcut="Enter" action="continue" /><ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+g" description="open in editor" /><ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" /></Byline>;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>When should Claude use this agent?</Text>;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== cursorOffset || $[10] !== handleSubmit || $[11] !== whenToUse) {
// TextInput 配置：columns 固定 80 而不是跟随终端宽度——向导弹窗有固定框架，输入区宽度独立于主界面。focus 与 showCursor 恒真，本步只有一个输入焦点。
    t6 = <Box marginTop={1}><TextInput value={whenToUse} onChange={setWhenToUse} onSubmit={handleSubmit} placeholder="e.g., use this agent after you're done writing code..." columns={80} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} focus={true} showCursor={true} /></Box>;
    $[9] = cursorOffset;
    $[10] = handleSubmit;
    $[11] = whenToUse;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
// 错误显示：error 非空时渲染红色文本。编译器把它单独缓存一段——大多数渲染里 error 为 null，t7 直接复用 null 槽，不拖累其他段落。
  if ($[13] !== error) {
    t7 = error && <Box marginTop={1}><Text color="error">{error}</Text></Box>;
    $[13] = error;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== t6 || $[16] !== t7) {
    t8 = <WizardDialogLayout subtitle="Description (tell Claude when to use this agent)" footerText={t4}><Box flexDirection="column">{t5}{t6}{t7}</Box></WizardDialogLayout>;
    $[15] = t6;
    $[16] = t7;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  return t8;
}
// 原文件此处有一行 10340 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。