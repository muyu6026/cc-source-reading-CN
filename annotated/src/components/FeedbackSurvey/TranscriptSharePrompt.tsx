import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
// 会话转录分享询问：yes/no/dont_ask_again 三种响应
export type TranscriptShareResponse = 'yes' | 'no' | 'dont_ask_again';
type Props = {
  onSelect: (option: TranscriptShareResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
};
// 数字键 1/2/3 映射响应：RESPONSE_INPUTS 常量数组加 inputToResponse 映射表，as const 全程字面量类型
const RESPONSE_INPUTS = ['1', '2', '3'] as const;
type ResponseInput = (typeof RESPONSE_INPUTS)[number];
const inputToResponse: Record<ResponseInput, TranscriptShareResponse> = {
  '1': 'yes',
  '2': 'no',
  '3': 'dont_ask_again'
} as const;
const isValidResponseInput = (input: string): input is ResponseInput => (RESPONSE_INPUTS as readonly string[]).includes(input);
// 类型守卫 isValidResponseInput：includes 判断加 input is ResponseInput 谓词
// 组件本体：静态内容全部哨兵缓存（七段），动态部分只有 useDebouncedDigitInput 的配置对象
export function TranscriptSharePrompt(t0) {
  const $ = _c(11);
  const {
    onSelect,
    inputValue,
    setInputValue
  } = t0;
  let t1;
  if ($[0] !== onSelect) {
    t1 = digit => onSelect(inputToResponse[digit]);
// onDigit 闭包：把数字转成响应后回调 onSelect
    $[0] = onSelect;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== inputValue || $[3] !== setInputValue || $[4] !== t1) {
    t2 = {
// hook 配置对象按依赖缓存：inputValue/setInputValue/onDigit 变化才重建——防抖数字输入 hook 的参数包
      inputValue,
      setInputValue,
      isValidDigit: isValidResponseInput,
      onDigit: t1
    };
    $[2] = inputValue;
    $[3] = setInputValue;
    $[4] = t1;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  useDebouncedDigitInput(t2);
// useDebouncedDigitInput：数字键防抖输入，避免连按误触发两次选择
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box><Text color="ansi:cyan">{BLACK_CIRCLE} </Text><Text bold={true}>Can Anthropic look at your session transcript to help us improve Claude Code?</Text></Box>;
// BLACK_CIRCLE 图标加加粗问题文案：隐私询问用 cyan 色圆点突出
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box marginLeft={2}><Text dimColor={true}>Learn more: https://code.claude.com/docs/en/data-usage#session-quality-surveys</Text></Box>;
// Learn more 链接固定 dim 色：data-usage 文档锚点直指 session-quality-surveys 小节
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box width={10}><Text><Text color="ansi:cyan">1</Text>: Yes</Text></Box>;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box width={10}><Text><Text color="ansi:cyan">2</Text>: No</Text></Box>;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box flexDirection="column" marginTop={1}>{t3}{t4}<Box marginLeft={2}>{t5}{t6}<Box><Text><Text color="ansi:cyan">3</Text>: Don't ask again</Text></Box></Box></Box>;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  return t7;
}
// 原文件此处有一行 7248 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。