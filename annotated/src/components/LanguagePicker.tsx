import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useState } from 'react';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import TextInput from './TextInput.js';
type Props = {
  initialLanguage: string | undefined;
  onComplete: (language: string | undefined) => void;
  onCancel: () => void;
};
// 语言选择器：文本输入加受控光标偏移，提交时 trim，空值回落默认英语
export function LanguagePicker(t0) {
  const $ = _c(13);
  const {
    initialLanguage,
    onComplete,
    onCancel
  } = t0;
  const [language, setLanguage] = useState(initialLanguage);
// language 初值允许是 undefined：代表「尚未设置」
  const [cursorOffset, setCursorOffset] = useState((initialLanguage ?? "").length);
// 光标初值放在已有文本末尾：编辑既有设置时不用先按 End
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Settings"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:no", onCancel, t1);
// confirm:no 绑定在 Settings 上下文：源码注释解释了原因——否则在输入框里打字母 n 会被当成取消
  let t2;
  if ($[1] !== language || $[2] !== onComplete) {
    t2 = function handleSubmit() {
// handleSubmit：trim 后空串统一转成 undefined，等价于「用默认值」
      const trimmed = language?.trim();
      onComplete(trimmed || undefined);
    };
    $[1] = language;
    $[2] = onComplete;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSubmit = t2;
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text>Enter your preferred response and voice language:</Text>;
// 提示文案要求同时给出语言名与语音语言：一个字段同时影响回复语言与语音合成
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text>{figures.pointer}</Text>;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const t5 = language ?? "";
  let t6;
  if ($[6] !== cursorOffset || $[7] !== handleSubmit || $[8] !== t5) {
    t6 = <Box flexDirection="row" gap={1}>{t4}<TextInput value={t5} onChange={setLanguage} onSubmit={handleSubmit} focus={true} showCursor={true} placeholder={`e.g., Japanese, 日本語, Español${figures.ellipsis}`} columns={60} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /></Box>;
// TextInput 全受控：value/onChange/onSubmit 加 focus/showCursor/columns 等于 60，placeholder 给三种语言样例（含日中），cursorOffset 双向受控
    $[6] = cursorOffset;
    $[7] = handleSubmit;
    $[8] = t5;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text dimColor={true}>Leave empty for default (English)</Text>;
// 底部暗色说明：留空即默认英语——把「清空」这条隐形操作显式写出来
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== t6) {
    t8 = <Box flexDirection="column" gap={1}>{t3}{t6}{t7}</Box>;
    $[11] = t6;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  return t8;
}
// 原文件此处有一行 6260 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。