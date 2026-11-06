// React 编译器运行时缓存。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
// 成功步骤属性：密钥状态、是否复用、密钥名、是否跳过工作流。
type SuccessStepProps = {
  secretExists: boolean;
  useExistingSecret: boolean;
  secretName: string;
  skipWorkflow?: boolean;
};
// 安装成功步骤组件，属性解构进 t0。
export function SuccessStep(t0) {
  const $ = _c(21);
  const {
    secretExists,
    useExistingSecret,
    secretName,
    skipWorkflow: t1
  } = t0;
  const skipWorkflow = t1 === undefined ? false : t1;
// skipWorkflow 缺省视为 false。
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化标题「Install GitHub App / Success」。
    t2 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>Install GitHub App</Text><Text dimColor={true}>Success</Text></Box>;
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  let t3;
  if ($[1] !== skipWorkflow) {
// 依赖 skipWorkflow 重建工作流创建提示。
    t3 = !skipWorkflow && <Text color="success">✓ GitHub Actions workflow created!</Text>;
    $[1] = skipWorkflow;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] !== secretExists || $[4] !== useExistingSecret) {
// 依赖状态重建复用密钥提示。
    t4 = secretExists && useExistingSecret && <Box marginTop={1}><Text color="success">✓ Using existing ANTHROPIC_API_KEY secret</Text></Box>;
    $[3] = secretExists;
    $[4] = useExistingSecret;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== secretExists || $[7] !== secretName || $[8] !== useExistingSecret) {
// 依赖状态重建新存密钥提示。
    t5 = (!secretExists || !useExistingSecret) && <Box marginTop={1}><Text color="success">✓ API key saved as {secretName} secret</Text></Box>;
    $[6] = secretExists;
    $[7] = secretName;
    $[8] = useExistingSecret;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「Next steps」提示块。
    t6 = <Box marginTop={1}><Text>Next steps:</Text></Box>;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== skipWorkflow) {
// 依赖 skipWorkflow 切换后续步骤文案。
    t7 = skipWorkflow ? <><Text>1. Install the Claude GitHub App if you haven't already</Text><Text>2. Your workflow file was kept unchanged</Text><Text>3. API key is configured and ready to use</Text></> : <><Text>1. A pre-filled PR page has been created</Text><Text>2. Install the Claude GitHub App if you haven't already</Text><Text>3. Merge the PR to enable Claude PR assistance</Text></>;
    $[11] = skipWorkflow;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
// 组合全部子块到圆角容器。
  if ($[13] !== t3 || $[14] !== t4 || $[15] !== t5 || $[16] !== t7) {
    t8 = <Box flexDirection="column" borderStyle="round" paddingX={1}>{t2}{t3}{t4}{t5}{t6}{t7}</Box>;
    $[13] = t3;
    $[14] = t4;
    $[15] = t5;
    $[16] = t7;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  let t9;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化退出提示。
    t9 = <Box marginLeft={3}><Text dimColor={true}>Press any key to exit</Text></Box>;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== t8) {
    t10 = <>{t8}{t9}</>;
    $[19] = t8;
    $[20] = t10;
  } else {
    t10 = $[20];
  }
  return t10;
// 返回最终组合节点。
}
// 原文件此处有一行 7256 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。