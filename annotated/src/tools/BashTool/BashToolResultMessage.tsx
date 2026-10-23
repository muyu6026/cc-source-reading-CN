import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { ShellTimeDisplay } from '../../components/shell/ShellTimeDisplay.js';
import { Box, Text } from '../../ink.js';
import type { Out as BashOut } from './BashTool.js';
type Props = {
  content: Omit<BashOut, 'interrupted'>;
  verbose: boolean;
  timeoutMs?: number;
};

// Pattern to match "Shell cwd was reset to <path>" message
// Use (?:^|\n) to match either start of string or after a newline
// 「Shell cwd was reset to <path>」警告从 stderr 里单独抠出来高亮显示，不当错误输出。正则要匹配行首或换行后的位置。
const SHELL_CWD_RESET_PATTERN = /(?:^|\n)(Shell cwd was reset to .+)$/;

/**
 * Extracts sandbox violations from stderr if present
 * Returns both the cleaned stderr and the violations content
 */
// extractSandboxViolations：<sandbox_violations> 标签段从 stderr 剥离（标签内容在 UI 层另有呈现，不混在错误流里）。
function extractSandboxViolations(stderr: string): {
  cleanedStderr: string;
} {
  const violationsMatch = stderr.match(/<sandbox_violations>([\s\S]*?)<\/sandbox_violations>/);
// sandbox_violations 是非贪婪匹配——一段 stderr 里可能有多组标签。
  if (!violationsMatch) {
    return {
      cleanedStderr: stderr
    };
  }

  // Remove the sandbox violations section from stderr
  const cleanedStderr = removeSandboxViolationTags(stderr).trim();
  return {
    cleanedStderr
  };
}

/**
 * Extracts the "Shell cwd was reset" warning message from stderr
 * Returns the cleaned stderr and the warning message separately
 */
// extractCwdResetWarning：把 cwd 重置警告从 stderr 摘出来，返回「干净 stderr + 警告」两件套。
function extractCwdResetWarning(stderr: string): {
  cleanedStderr: string;
  cwdResetWarning: string | null;
} {
  const match = stderr.match(SHELL_CWD_RESET_PATTERN);
  if (!match) {
    return {
      cleanedStderr: stderr,
      cwdResetWarning: null
    };
  }

  // Extract the warning message from capture group 1
// replace 用同一个正则——整行（含前面的换行）一起替换掉，不留下空行。
  const cwdResetWarning = match[1] ?? null;
  // Remove the warning from stderr (replace the full match)
  const cleanedStderr = stderr.replace(SHELL_CWD_RESET_PATTERN, '').trim();
  return {
    cleanedStderr,
    cwdResetWarning
  };
}
export default function BashToolResultMessage(t0) {
// BashToolResultMessage 是 React Compiler 编译后的产物（_c(34) 缓存槽 + t0/t1 中间变量 + bb0 标签块），源码逻辑要透过编译形态看。
  const $ = _c(34);
  const {
    content: t1,
    verbose,
    timeoutMs
  } = t0;
  const {
    stdout: t2,
    stderr: t3,
    isImage,
    returnCodeInterpretation,
    noOutputExpected,
    backgroundTaskId
  } = t1;
  const stdout = t2 === undefined ? "" : t2;
  const stdErrWithViolations = t3 === undefined ? "" : t3;
  let T0;
  let cwdResetWarning;
  let stderr;
  let t4;
  let t5;
  let t6;
  let t7;
  if ($[0] !== isImage || $[1] !== stdErrWithViolations || $[2] !== stdout || $[3] !== verbose) {
// 两个提取串行执行：先剥 sandbox violations，再剥 cwd 警告。
    t7 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const {
        cleanedStderr: stderrWithoutViolations
      } = extractSandboxViolations(stdErrWithViolations);
      ({
        cleanedStderr: stderr,
        cwdResetWarning
      } = extractCwdResetWarning(stderrWithoutViolations));
      if (isImage) {
// isImage 早退：图片输出不显示 stdout 文本，只显示占位提示 [Image data detected and sent to Claude]。
        let t8;
        if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
          t8 = <MessageResponse height={1}><Text dimColor={true}>[Image data detected and sent to Claude]</Text></MessageResponse>;
          $[11] = t8;
        } else {
          t8 = $[11];
        }
        t7 = t8;
        break bb0;
      }
      T0 = Box;
// 正常路径：stdout / stderr 各自一个 OutputLine（stderr 带 isError 样式）；空则不渲染。
      t4 = "column";
      if ($[12] !== stdout || $[13] !== verbose) {
        t5 = stdout !== "" ? <OutputLine content={stdout} verbose={verbose} /> : null;
        $[12] = stdout;
        $[13] = verbose;
        $[14] = t5;
      } else {
        t5 = $[14];
      }
      t6 = stderr.trim() !== "" ? <OutputLine content={stderr} verbose={verbose} isError={true} /> : null;
    }
    $[0] = isImage;
    $[1] = stdErrWithViolations;
    $[2] = stdout;
    $[3] = verbose;
    $[4] = T0;
    $[5] = cwdResetWarning;
    $[6] = stderr;
    $[7] = t4;
    $[8] = t5;
    $[9] = t6;
    $[10] = t7;
  } else {
    T0 = $[4];
    cwdResetWarning = $[5];
    stderr = $[6];
    t4 = $[7];
    t5 = $[8];
    t6 = $[9];
    t7 = $[10];
  }
  if (t7 !== Symbol.for("react.early_return_sentinel")) {
    return t7;
  }
  let t8;
  if ($[15] !== cwdResetWarning) {
// cwd 重置警告用 dimColor 单独一行显示在输出区之后。
    t8 = cwdResetWarning ? <MessageResponse><Text dimColor={true}>{cwdResetWarning}</Text></MessageResponse> : null;
    $[15] = cwdResetWarning;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  let t9;
  if ($[17] !== backgroundTaskId || $[18] !== cwdResetWarning || $[19] !== noOutputExpected || $[20] !== returnCodeInterpretation || $[21] !== stderr || $[22] !== stdout) {
// 「无输出」的三级文案：后台任务显示 Running in the background + ↓ manage 快捷键提示；其次 returnCodeInterpretation（如「exit 0 但无输出」的解释）；最后 noOutputExpected 时 Done、否则 (No output)。
    t9 = stdout === "" && stderr.trim() === "" && !cwdResetWarning ? <MessageResponse height={1}><Text dimColor={true}>{backgroundTaskId ? <>Running in the background{" "}<KeyboardShortcutHint shortcut={"\u2193"} action="manage" parens={true} /></> : returnCodeInterpretation || (noOutputExpected ? "Done" : "(No output)")}</Text></MessageResponse> : null;
    $[17] = backgroundTaskId;
    $[18] = cwdResetWarning;
    $[19] = noOutputExpected;
    $[20] = returnCodeInterpretation;
    $[21] = stderr;
    $[22] = stdout;
    $[23] = t9;
  } else {
    t9 = $[23];
  }
  let t10;
  if ($[24] !== timeoutMs) {
// timeoutMs 存在时挂 ShellTimeDisplay 显示耗时。
    t10 = timeoutMs && <MessageResponse><ShellTimeDisplay timeoutMs={timeoutMs} /></MessageResponse>;
    $[24] = timeoutMs;
    $[25] = t10;
  } else {
    t10 = $[25];
  }
  let t11;
  if ($[26] !== T0 || $[27] !== t10 || $[28] !== t4 || $[29] !== t5 || $[30] !== t6 || $[31] !== t8 || $[32] !== t9) {
// 最终组装：Box column 里依次排 stdout、stderr、cwd 警告、无输出提示、耗时。
    t11 = <T0 flexDirection={t4}>{t5}{t6}{t8}{t9}{t10}</T0>;
    $[26] = T0;
    $[27] = t10;
    $[28] = t4;
    $[29] = t5;
    $[30] = t6;
    $[31] = t8;
    $[32] = t9;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  return t11;
}
// 原文件此处有一行 13484 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。