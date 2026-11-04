import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { SandboxManager, shouldAllowManagedSandboxDomainsOnly } from '../../utils/sandbox/sandbox-adapter.js';
// 沙箱配置页签：把当前生效的排除命令、文件读写限制、网络限制、Unix 套接字全部摊开给人看
export function SandboxConfigTab() {
  const $ = _c(3);
  const isEnabled = SandboxManager.isSandboxingEnabled();
// 启用状态最先取：未启用时下面所有 getXXX 都没有意义，早返回能把分支压成一条
  let t0;
// sentinel 槽位：依赖项检查要 spawn 外部探测进程，属于首渲染同步 IO，只跑一次后整份缓存
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    const depCheck = SandboxManager.checkDependencies();
    t0 = depCheck.warnings.length > 0 ? <Box marginTop={1} flexDirection="column">{depCheck.warnings.map(_temp)}</Box> : null;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const warningsNote = t0;
// 未启用分支仍挂依赖警告：Linux 缺 seccomp 之类的提示在关掉沙箱时反而更有价值，不能只显示一行未启用
  if (!isEnabled) {
    let t1;
    if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box flexDirection="column" paddingY={1}><Text color="subtle">Sandbox is not enabled</Text>{warningsNote}</Box>;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    const fsReadConfig = SandboxManager.getFsReadConfig();
// 六类配置一口气全读：读写限制、网络、套接字、排除命令、glob 警告，都在同一块里完成
    const fsWriteConfig = SandboxManager.getFsWriteConfig();
    const networkConfig = SandboxManager.getNetworkRestrictionConfig();
    const allowUnixSockets = SandboxManager.getAllowUnixSockets();
    const excludedCommands = SandboxManager.getExcludedCommands();
    const globPatternWarnings = SandboxManager.getLinuxGlobPatternWarnings();
// glob 告警与其余配置同块展示：Linux 下 glob 模式不被完整支持，必须让用户在配置页就看见
    t1 = <Box flexDirection="column" paddingY={1}><Box flexDirection="column"><Text bold={true} color="permission">Excluded Commands:</Text><Text dimColor={true}>{excludedCommands.length > 0 ? excludedCommands.join(", ") : "None"}</Text></Box>{fsReadConfig.denyOnly.length > 0 && <Box marginTop={1} flexDirection="column"><Text bold={true} color="permission">Filesystem Read Restrictions:</Text><Text dimColor={true}>Denied: {fsReadConfig.denyOnly.join(", ")}</Text>{fsReadConfig.allowWithinDeny && fsReadConfig.allowWithinDeny.length > 0 && <Text dimColor={true}>Allowed within denied: {fsReadConfig.allowWithinDeny.join(", ")}</Text>}</Box>}{fsWriteConfig.allowOnly.length > 0 && <Box marginTop={1} flexDirection="column"><Text bold={true} color="permission">Filesystem Write Restrictions:</Text><Text dimColor={true}>Allowed: {fsWriteConfig.allowOnly.join(", ")}</Text>{fsWriteConfig.denyWithinAllow.length > 0 && <Text dimColor={true}>Denied within allowed: {fsWriteConfig.denyWithinAllow.join(", ")}</Text>}</Box>}{(networkConfig.allowedHosts && networkConfig.allowedHosts.length > 0 || networkConfig.deniedHosts && networkConfig.deniedHosts.length > 0) && <Box marginTop={1} flexDirection="column"><Text bold={true} color="permission">Network Restrictions{shouldAllowManagedSandboxDomainsOnly() ? " (Managed)" : ""}:</Text>{networkConfig.allowedHosts && networkConfig.allowedHosts.length > 0 && <Text dimColor={true}>Allowed: {networkConfig.allowedHosts.join(", ")}</Text>}{networkConfig.deniedHosts && networkConfig.deniedHosts.length > 0 && <Text dimColor={true}>Denied: {networkConfig.deniedHosts.join(", ")}</Text>}</Box>}{allowUnixSockets && allowUnixSockets.length > 0 && <Box marginTop={1} flexDirection="column"><Text bold={true} color="permission">Allowed Unix Sockets:</Text><Text dimColor={true}>{allowUnixSockets.join(", ")}</Text></Box>}{globPatternWarnings.length > 0 && <Box marginTop={1} flexDirection="column"><Text bold={true} color="warning">⚠ Warning: Glob patterns not fully supported on Linux</Text><Text dimColor={true}>The following patterns will be ignored:{" "}{globPatternWarnings.slice(0, 3).join(", ")}{globPatternWarnings.length > 3 && ` (${globPatternWarnings.length - 3} more)`}</Text></Box>}{warningsNote}</Box>;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
// 编译器把 warnings.map 的内联箭头提到顶层 _temp：拿到稳定函数引用，数组元素渲染时才不会每轮重建
function _temp(w, i) {
  return <Text key={i} dimColor={true}>{w}</Text>;
}
// 原文件此处有一行 13072 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。