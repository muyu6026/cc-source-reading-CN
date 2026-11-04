import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
// 沙箱诊断区：在支持且已开启沙箱时，展示依赖检查结果（错误/警告）。
export function SandboxDoctorSection() {
  const $ = _c(2);
// 平台不支持则整段不渲染。
  if (!SandboxManager.isSupportedPlatform()) {
    return null;
  }
// 设置里未开启沙箱同样不渲染。
  if (!SandboxManager.isSandboxEnabledInSettings()) {
    return null;
  }
  let t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const depCheck = SandboxManager.checkDependencies();
// 检查沙箱依赖，并判断是否存在错误/警告。
      const hasErrors = depCheck.errors.length > 0;
      const hasWarnings = depCheck.warnings.length > 0;
      if (!hasErrors && !hasWarnings) {
        t1 = null;
        break bb0;
      }
      const statusColor = hasErrors ? "error" as const : "warning" as const;
      const statusText = hasErrors ? "Missing dependencies" : "Available (with warnings)";
// 无错误显示「可用（有警告）」，有错误显示「缺少依赖」。
      t0 = <Box flexDirection="column"><Text bold={true}>Sandbox</Text><Text>└ Status: <Text color={statusColor}>{statusText}</Text></Text>{depCheck.errors.map(_temp)}{depCheck.warnings.map(_temp2)}{hasErrors && <Text dimColor={true}>└ Run /sandbox for install instructions</Text>}</Box>;
    }
    $[0] = t0;
    $[1] = t1;
  } else {
    t0 = $[0];
    t1 = $[1];
  }
// 若存在提前返回哨兵则直接返回（无问题时不渲染）。
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  return t0;
// 否则返回渲染好的沙箱状态区块。
}
// 辅助：渲染单条警告行（黄色）。
function _temp2(w, i_0) {
  return <Text key={i_0} color="warning">└ {w}</Text>;
}
// 辅助：渲染单条错误行（红色）。
function _temp(e, i) {
  return <Text key={i} color="error">└ {e}</Text>;
}
// 原文件此处有一行 4604 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。