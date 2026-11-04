import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../ink.js';
import { formatTokens } from '../utils/format.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
// IdleReturnAction 四值：continue 继续当前会话、clear 以新会话发出消息、dismiss 只关弹窗不做决定、never 不再询问。
type IdleReturnAction = 'continue' | 'clear' | 'dismiss' | 'never';
type Props = {
  idleMinutes: number;
  totalInputTokens: number;
  onDone: (action: IdleReturnAction) => void;
};
// 空闲返回弹窗：检测到用户离开一段时间后回来，提示「要不要趁机开新会话」——旧上下文越长越慢越贵，这是省 token 的入口。
export function IdleReturnDialog(t0) {
  const $ = _c(16);
  const {
    idleMinutes,
    totalInputTokens,
    onDone
  } = t0;
// 两个格式化各自独立记忆化：时长与 token 数是仅有的两个动态入参，其余全为静态。
  let t1;
  if ($[0] !== idleMinutes) {
    t1 = formatIdleDuration(idleMinutes);
    $[0] = idleMinutes;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const formattedIdle = t1;
  let t2;
  if ($[2] !== totalInputTokens) {
    t2 = formatTokens(totalInputTokens);
    $[2] = totalInputTokens;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const formattedTokens = t2;
  const t3 = `You've been away ${formattedIdle} and this conversation is ${formattedTokens} tokens.`;
  let t4;
  if ($[4] !== onDone) {
// onCancel 映射为 dismiss：Esc 关闭弹窗既不继续也不清理，下次空闲仍会询问（never 才是永久关闭）。
    t4 = () => onDone("dismiss");
    $[4] = onDone;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
// 说明文案进常量槽：点明清上下文的两个收益——省用量、更快。只劝一次，选择权留给用户。
    t5 = <Box flexDirection="column"><Text>If this is a new task, clearing context will save usage and be faster.</Text></Box>;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      value: "continue" as const,
      label: "Continue this conversation"
    };
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  let t7;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      value: "clear" as const,
      label: "Send message as a new conversation"
    };
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  let t8;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
// 选项数组三个：continue、clear、never。注意 dismiss 不在选项里——它是 Esc 专属的第四态，界面上不引导用户选它。
    t8 = [t6, t7, {
      value: "never" as const,
      label: "Don't ask me again"
    }];
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  let t9;
  if ($[10] !== onDone) {
    t9 = <Select options={t8} onChange={value => onDone(value)} />;
    $[10] = onDone;
    $[11] = t9;
  } else {
    t9 = $[11];
  }
  let t10;
  if ($[12] !== t3 || $[13] !== t4 || $[14] !== t9) {
    t10 = <Dialog title={t3} onCancel={t4}>{t5}{t9}</Dialog>;
    $[12] = t3;
    $[13] = t4;
    $[14] = t9;
    $[15] = t10;
  } else {
    t10 = $[15];
  }
  return t10;
}
// formatIdleDuration 三档：不足一分钟显示小于 1m；不足一小时只显分钟；跨小时显小时加余分钟，余数为零则只显小时。文案密度与空闲时长成正比。
function formatIdleDuration(minutes: number): string {
  if (minutes < 1) {
    return '< 1m';
  }
  if (minutes < 60) {
    return `${Math.floor(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.floor(minutes % 60);
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}
// 原文件此处有一行 7036 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。