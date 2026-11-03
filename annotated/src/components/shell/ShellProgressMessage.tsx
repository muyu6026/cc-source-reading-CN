import { c as _c } from "react/compiler-runtime";
import React from 'react';
import stripAnsi from 'strip-ansi';
import { Box, Text } from '../../ink.js';
import { formatFileSize } from '../../utils/format.js';
import { MessageResponse } from '../MessageResponse.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { ShellTimeDisplay } from './ShellTimeDisplay.js';
type Props = {
  output: string;
  fullOutput: string;
  elapsedTimeSeconds?: number;
  totalLines?: number;
  totalBytes?: number;
  timeoutMs?: number;
  taskId?: string;
  verbose: boolean;
};
// 长命令运行时的进度面板：把标准输出按行截断展示，并附上耗时、行数、字节数等状态信息
export function ShellProgressMessage(t0) {
  const $ = _c(30);
  const {
    output,
    fullOutput,
    elapsedTimeSeconds,
    totalLines,
    totalBytes,
    timeoutMs,
    verbose
  } = t0;
  let t1;
  if ($[0] !== fullOutput) {
    t1 = stripAnsi(fullOutput.trim());
// 整份完整输出先去 ANSI 转义再 trim：用于计算「还有多少行未显示」等非展示用途
    $[0] = fullOutput;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const strippedFullOutput = t1;
  let lines;
  let t2;
  if ($[2] !== output || $[3] !== strippedFullOutput || $[4] !== verbose) {
    const strippedOutput = stripAnsi(output.trim());
    lines = strippedOutput.split("\n").filter(_temp);
// 可见行计算：非详细模式下只取最后 5 行；`_temp` 是恒等过滤函数（占位，便于以后加规则）
    t2 = verbose ? strippedFullOutput : lines.slice(-5).join("\n");
    $[2] = output;
    $[3] = strippedFullOutput;
    $[4] = verbose;
    $[5] = lines;
    $[6] = t2;
  } else {
    lines = $[5];
    t2 = $[6];
  }
  const displayLines = t2;
  if (!lines.length) {
    let t3;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text dimColor={true}>Running… </Text>;
// 还没有任何输出时显示「Running…」并接入计时器，用 OffscreenFreeze 把未挂载子树挡在渲染外
      $[7] = t3;
    } else {
      t3 = $[7];
    }
    let t4;
    if ($[8] !== elapsedTimeSeconds || $[9] !== timeoutMs) {
      t4 = <MessageResponse><OffscreenFreeze>{t3}<ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} /></OffscreenFreeze></MessageResponse>;
      $[8] = elapsedTimeSeconds;
      $[9] = timeoutMs;
      $[10] = t4;
    } else {
      t4 = $[10];
    }
    return t4;
  }
  const extraLines = totalLines ? Math.max(0, totalLines - 5) : 0;
// 超出 5 行的部分记为 extraLines，用于提示「还有 N 行」
  let lineStatus = "";
  if (!verbose && totalBytes && totalLines) {
    lineStatus = `~${totalLines} lines`;
  } else {
    if (!verbose && extraLines > 0) {
      lineStatus = `+${extraLines} lines`;
    }
  }
  const t3 = verbose ? undefined : Math.min(5, lines.length);
// 非详细模式把高度限制为 5 行（`Math.min`），详细模式不设高度以完整展示
  let t4;
  if ($[11] !== displayLines) {
    t4 = <Text dimColor={true}>{displayLines}</Text>;
    $[11] = displayLines;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  let t5;
  if ($[13] !== t3 || $[14] !== t4) {
    t5 = <Box height={t3} flexDirection="column" overflow="hidden">{t4}</Box>;
// 输出区用固定高度 + overflow:hidden 截断，超出行数直接裁掉而不出现滚动条
    $[13] = t3;
    $[14] = t4;
    $[15] = t5;
  } else {
    t5 = $[15];
  }
  let t6;
  if ($[16] !== lineStatus) {
    t6 = lineStatus ? <Text dimColor={true}>{lineStatus}</Text> : null;
    $[16] = lineStatus;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  let t7;
  if ($[18] !== elapsedTimeSeconds || $[19] !== timeoutMs) {
    t7 = <ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} />;
    $[18] = elapsedTimeSeconds;
    $[19] = timeoutMs;
    $[20] = t7;
  } else {
    t7 = $[20];
  }
  let t8;
  if ($[21] !== totalBytes) {
    t8 = totalBytes ? <Text dimColor={true}>{formatFileSize(totalBytes)}</Text> : null;
// 有总字节数时显示人类可读的大小（如 1.2 MB），否则该段为空
    $[21] = totalBytes;
    $[22] = t8;
  } else {
    t8 = $[22];
  }
  let t9;
  if ($[23] !== t6 || $[24] !== t7 || $[25] !== t8) {
    t9 = <Box flexDirection="row" gap={1}>{t6}{t7}{t8}</Box>;
    $[23] = t6;
    $[24] = t7;
    $[25] = t8;
    $[26] = t9;
  } else {
    t9 = $[26];
  }
  let t10;
  if ($[27] !== t5 || $[28] !== t9) {
    t10 = <MessageResponse><OffscreenFreeze><Box flexDirection="column">{t5}{t9}</Box></OffscreenFreeze></MessageResponse>;
// 整体结构：输出区 + 状态行（行数/字节）包进 MessageResponse 与 OffscreenFreeze，保证未挂载时不重渲染
    $[27] = t5;
    $[28] = t9;
    $[29] = t10;
  } else {
    t10 = $[29];
  }
  return t10;
}
function _temp(line) {
  return line;
}
// 原文件此处有一行 10500 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。