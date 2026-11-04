import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';
type Props = {
  onSelect: (option: FeedbackSurveyResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  message?: string;
};
// RESPONSE_INPUTS：0 到 3 四个按键，映射到 dismissed、bad、fine、good 四种响应。用 const 断言让字面量类型直接从数组推导，映射表与数组由同一类型约束。
const RESPONSE_INPUTS = ['0', '1', '2', '3'] as const;
type ResponseInput = (typeof RESPONSE_INPUTS)[number];
const inputToResponse: Record<ResponseInput, FeedbackSurveyResponse> = {
  '0': 'dismissed',
  '1': 'bad',
  '2': 'fine',
  '3': 'good'
} as const;
// isValidResponseInput 类型守卫：收窄后的字符串可以直接索引映射表。导出供 useSurveyState 与防抖输入 hook 共用。
export const isValidResponseInput = (input: string): input is ResponseInput => (RESPONSE_INPUTS as readonly string[]).includes(input);
// 默认问题文案标注 optional——按数字即答、按 0 忽略，问卷不抢占输入焦点。
const DEFAULT_MESSAGE = 'How is Claude doing this session? (optional)';
// FeedbackSurveyView：纯展示加按键处理。问题行是唯一动态段，选项区全部静态。
export function FeedbackSurveyView(t0) {
  const $ = _c(15);
  const {
    onSelect,
    inputValue,
    setInputValue,
    message: t1
  } = t0;
// message 缺省回退默认文案：调用方可以换成针对上下文的定制问题（如按了不喜欢后的追问）。
  const message = t1 === undefined ? DEFAULT_MESSAGE : t1;
  let t2;
  if ($[0] !== onSelect) {
    t2 = digit => onSelect(inputToResponse[digit]);
    $[0] = onSelect;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== inputValue || $[3] !== setInputValue || $[4] !== t2) {
    t3 = {
      inputValue,
      setInputValue,
      isValidDigit: isValidResponseInput,
      onDigit: t2
    };
    $[2] = inputValue;
    $[3] = setInputValue;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
// useDebouncedDigitInput：数字按键防抖——聊天流里用户可能正在输入包含数字的文本，防抖窗口区分「正在打字」与「想按评分」。输入值与回调经对象打包传入，依赖四值记忆化。
  useDebouncedDigitInput(t3);
  let t4;
// 五个静态段全部进哨兵槽：圆点图标、三档评分（每档固定宽 10 对齐成列）、0 忽略。问卷不打字、只按键，所以选项是一次性的静态布局。
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text color="ansi:cyan">● </Text>;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== message) {
    t5 = <Box>{t4}<Text bold={true}>{message}</Text></Box>;
    $[7] = message;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box width={10}><Text><Text color="ansi:cyan">1</Text>: Bad</Text></Box>;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box width={10}><Text><Text color="ansi:cyan">2</Text>: Fine</Text></Box>;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box width={10}><Text><Text color="ansi:cyan">3</Text>: Good</Text></Box>;
    $[11] = t8;
  } else {
    t8 = $[11];
  }
  let t9;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Box marginLeft={2}>{t6}{t7}{t8}<Box><Text><Text color="ansi:cyan">0</Text>: Dismiss</Text></Box></Box>;
    $[12] = t9;
  } else {
    t9 = $[12];
  }
  let t10;
// 最终容器只依赖 t5（问题行）：message 不变时整棵树复用，防抖状态变化不触发问卷重绘。
  if ($[13] !== t5) {
    t10 = <Box flexDirection="column" marginTop={1}>{t5}{t9}</Box>;
    $[13] = t5;
    $[14] = t10;
  } else {
    t10 = $[14];
  }
  return t10;
}
// 原文件此处有一行 7768 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。