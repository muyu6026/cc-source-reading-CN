import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { KeyboardShortcutHint } from '../components/design-system/KeyboardShortcutHint.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
type Props = {
  onRun: () => void;
  onCancel: () => void;
  reason: string;
};
// 自动运行 /issue 通知与判定：提供在反馈调查后自动触发问题上报的 UI 组件与原因判定辅助函数（仅内部 ant 构建使用）。

/**
 * Component that shows a notification about running /issue command
 * with the ability to cancel via ESC key
 */
export function AutoRunIssueNotification(t0) {
// AutoRunIssueNotification 签名：反馈捕获通知组件，挂载时立即尝试运行 /issue，并支持按 Esc 随时取消。
  const $ = _c(8);
  const {
    onRun,
    onCancel,
    reason
  } = t0;
  const hasRunRef = useRef(false);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Confirmation"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:no", onCancel, t1);
  let t2;
  let t3;
  if ($[1] !== onRun) {
    t2 = () => {
      if (!hasRunRef.current) {
        hasRunRef.current = true;
        onRun();
      }
    };
    t3 = [onRun];
    $[1] = onRun;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  useEffect(t2, t3);
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box><Text bold={true}>Running feedback capture...</Text></Box>;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box><Text dimColor={true}>Press <KeyboardShortcutHint shortcut="Esc" action="cancel" /> anytime</Text></Box>;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== reason) {
    t6 = <Box flexDirection="column" marginTop={1}>{t4}{t5}<Box><Text dimColor={true}>Reason: {reason}</Text></Box></Box>;
    $[6] = reason;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  return t6;
}
// AutoRunIssueNotification 收尾：用 React 编译器缓存渲染提示文案与取消提示，组合出通知界面。
export type AutoRunIssueReason = 'feedback_survey_bad' | 'feedback_survey_good';
// AutoRunIssueReason：自动运行原因类型，区分「反馈差评」与「反馈好评」。

/**
 * Determines if /issue should auto-run for Ant users
 */
export function shouldAutoRunIssue(reason: AutoRunIssueReason): boolean {
// shouldAutoRunIssue 签名：判定是否对内部用户自动运行 /issue。
  // Only for Ant users
  if ("external" !== 'ant') {
    return false;
  }
  switch (reason) {
    case 'feedback_survey_bad':
      return false;
    case 'feedback_survey_good':
      return false;
    default:
      return false;
  }
}
// shouldAutoRunIssue 收尾：当前实现对所有原因均返回 false，即默认不自动运行。

/**
 * Returns the appropriate command to auto-run based on the reason
 * ANT-ONLY: good-claude command only exists in ant builds
 */
export function getAutoRunCommand(reason: AutoRunIssueReason): string {
// getAutoRunCommand 签名：根据原因返回应自动运行的命令。
  // Only ant builds have the /good-claude command
  if ("external" === 'ant' && reason === 'feedback_survey_good') {
    return '/good-claude';
  }
  return '/issue';
}
// getAutoRunCommand 收尾：好评且为内部构建时返回 /good-claude，否则返回 /issue。

/**
 * Gets a human-readable description of why /issue is being auto-run
 */
export function getAutoRunIssueReasonText(reason: AutoRunIssueReason): string {
// getAutoRunIssueReasonText 签名：把自动运行原因转换为可读说明文字。
  switch (reason) {
    case 'feedback_survey_bad':
      return 'You responded "Bad" to the feedback survey';
    case 'feedback_survey_good':
      return 'You responded "Good" to the feedback survey';
    default:
      return 'Unknown reason';
  }
}
// getAutoRunIssueReasonText 收尾：按原因返回对应的用户提示文案。
// 原文件此处有一行 7500 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。