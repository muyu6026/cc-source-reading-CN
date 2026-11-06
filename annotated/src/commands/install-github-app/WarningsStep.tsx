// 引入 React 编译器运行时与 ink 终端 UI 库；本组件是安装 GitHub App 向导里的「警告汇总」步骤（React 编译器产物，用 `$` 缓存与 `_c(n)` 槽位做记忆化）
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { GITHUB_ACTION_SETUP_DOCS_URL } from '../../constants/github-app.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { Warning } from './types.js';
interface WarningsStepProps {
  warnings: Warning[];
  onContinue: () => void;
}
export function WarningsStep(t0) {
// 主组件：接收警告清单与继续回调，把 confirm:yes 键位绑定到 onContinue
  const $ = _c(8);
  const {
    warnings,
    onContinue
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Confirmation"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:yes", onContinue, t1);
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>{figures.warning} Setup Warnings</Text><Text dimColor={true}>We found some potential issues, but you can continue anyway</Text></Box>;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== warnings) {
    t3 = warnings.map(_temp2);
    $[2] = warnings;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box marginTop={1}><Text bold={true} color="permission">Press Enter to continue anyway, or Ctrl+C to exit and fix issues</Text></Box>;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box marginTop={1}><Text dimColor={true}>You can also try the manual setup steps if needed:{" "}<Text color="claude">{GITHUB_ACTION_SETUP_DOCS_URL}</Text></Text></Box>;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== t3) {
    t6 = <><Box flexDirection="column" borderStyle="round" paddingX={1}>{t2}{t3}{t4}{t5}</Box></>;
    $[6] = t3;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  return t6;
// 返回汇总的警告面板 JSX（确认键已绑定到继续回调）
}
function _temp2(warning, index) {
  return <Box key={index} flexDirection="column" marginBottom={1}><Text color="warning" bold={true}>{warning.title}</Text><Text>{warning.message}</Text>{warning.instructions.length > 0 && <Box flexDirection="column" marginLeft={2} marginTop={1}>{warning.instructions.map(_temp)}</Box>}</Box>;
}
// 警告项渲染器：标题 + 正文 + 可展开的指令列表
function _temp(instruction, i) {
  return <Text key={i} dimColor={true}>• {instruction}</Text>;
}
// 单条指令的纯文本行渲染器
// 原文件此处有一行 6764 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。