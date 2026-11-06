import { c as _c } from "react/compiler-runtime";
// 依赖：React Compiler 运行时、React、GitHub Action 文档链接常量、ink 的 Box 与 Text。
import React from 'react';
import { GITHUB_ACTION_SETUP_DOCS_URL } from '../../constants/github-app.js';
import { Box, Text } from '../../ink.js';
// ErrorStepProps 接口：三个字段都可选，错误可能只有 message 没有原因或步骤。
interface ErrorStepProps {
  error: string | undefined;
  errorReason?: string;
  errorInstructions?: string[];
}
export function ErrorStep(t0) {
// ErrorStep 组件：编译器把每个条件渲染缓存到 dollar 槽，命中就复用否则重建。
  const $ = _c(15);
  const {
    error,
    errorReason,
    errorInstructions
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>Install GitHub App</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== error) {
    t2 = <Text color="error">Error: {error}</Text>;
    $[1] = error;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== errorReason) {
    t3 = errorReason && <Box marginTop={1}><Text dimColor={true}>Reason: {errorReason}</Text></Box>;
    $[3] = errorReason;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== errorInstructions) {
    t4 = errorInstructions && errorInstructions.length > 0 && <Box flexDirection="column" marginTop={1}><Text dimColor={true}>How to fix:</Text>{errorInstructions.map(_temp)}</Box>;
    $[5] = errorInstructions;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box marginTop={1}><Text dimColor={true}>For manual setup instructions, see:{" "}<Text color="claude">{GITHUB_ACTION_SETUP_DOCS_URL}</Text></Text></Box>;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== t2 || $[9] !== t3 || $[10] !== t4) {
// 组装层：把标题、错误、原因、步骤、文档链接逐层拼进圆角边框盒子。
    t6 = <Box flexDirection="column" borderStyle="round" paddingX={1}>{t1}{t2}{t3}{t4}{t5}</Box>;
    $[8] = t2;
    $[9] = t3;
    $[10] = t4;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box marginLeft={3}><Text dimColor={true}>Press any key to exit</Text></Box>;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
// 收尾层：把组装好的盒子与「按任意键退出」提示合并返回。
  if ($[13] !== t6) {
    t8 = <>{t6}{t7}</>;
    $[13] = t6;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  return t8;
}
// ErrorStep 收尾：组件闭合并交付给安装向导的失败展示页。
function _temp(instruction, index) {
  return <Box key={index} marginLeft={2}><Text dimColor={true}>• </Text><Text>{instruction}</Text></Box>;
}
// 临时函数 _temp：把每条修复指令渲染成带圆点前缀的行。
// 原文件此处有一行 6276 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。