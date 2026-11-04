import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../ink.js';
import { getCachedKeybindingWarnings, getKeybindingsPath, isKeybindingCustomizationEnabled } from '../keybindings/loadUserBindings.js';

/**
 * Displays keybinding validation warnings in the UI.
 * Similar to McpParsingWarnings, this provides persistent visibility
 * of configuration issues.
 *
 * Only shown when keybinding customization is enabled (ant users + feature gate).
 */
// 块注释说明：在 UI 展示按键绑定校验告警，类似 MCP 解析告警，仅开启自定义时显示；函数拉取缓存告警并按错误/警告分类渲染。
export function KeybindingWarnings() {
  const $ = _c(2);
  if (!isKeybindingCustomizationEnabled()) {
    return null;
  }
  let t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const warnings = getCachedKeybindingWarnings();
// 读取已缓存的按键绑定告警列表。
      if (warnings.length === 0) {
        t1 = null;
        break bb0;
      }
      const errors = warnings.filter(_temp);
// 过滤出错误级别的绑定问题。
      const warns = warnings.filter(_temp2);
// 过滤出警告级别的绑定问题。
      t0 = <Box flexDirection="column" marginTop={1} marginBottom={1}><Text bold={true} color={errors.length > 0 ? "error" : "warning"}>Keybinding Configuration Issues</Text><Box><Text dimColor={true}>Location: </Text><Text dimColor={true}>{getKeybindingsPath()}</Text></Box><Box marginLeft={1} flexDirection="column" marginTop={1}>{errors.map(_temp3)}{warns.map(_temp4)}</Box></Box>;
    }
    $[0] = t0;
    $[1] = t1;
  } else {
    t0 = $[0];
    t1 = $[1];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  return t0;
// 优先返回提前返回哨兵值；否则渲染分类后的告警列表。
}
function _temp4(warning, i_0) {
  return <Box key={`warning-${i_0}`} flexDirection="column"><Box><Text dimColor={true}>└ </Text><Text color="warning">[Warning]</Text><Text dimColor={true}> {warning.message}</Text></Box>{warning.suggestion && <Box marginLeft={3}><Text dimColor={true}>→ {warning.suggestion}</Text></Box>}</Box>;
}
function _temp3(error, i) {
  return <Box key={`error-${i}`} flexDirection="column"><Box><Text dimColor={true}>└ </Text><Text color="error">[Error]</Text><Text dimColor={true}> {error.message}</Text></Box>{error.suggestion && <Box marginLeft={3}><Text dimColor={true}>→ {error.suggestion}</Text></Box>}</Box>;
}
function _temp2(w_0) {
  return w_0.severity === "warning";
}
function _temp(w) {
  return w.severity === "error";
}
// 原文件此处有一行 7220 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。