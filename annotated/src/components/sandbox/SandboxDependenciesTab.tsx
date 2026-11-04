import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { getPlatform } from '../../utils/platform.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
// Props 只有一个 depCheck：沙箱依赖体检结果，errors 是缺失依赖的报错文本数组，warnings 主要是 seccomp 相关警告。本组件把它翻译成按平台分组的安装指引。
type Props = {
  depCheck: SandboxDependencyCheck;
};
// 沙箱设置弹窗的依赖体检标签页。平台决定展示哪一组：macOS 只看 ripgrep（seatbelt 内建），Linux 要看 bwrap、socat、seccomp 三件套。
export function SandboxDependenciesTab(t0) {
  const $ = _c(24);
  const {
    depCheck
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// getPlatform 的结果进常量槽：进程生命周期内平台不会变。isMac 由此派生。
    t1 = getPlatform();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const platform = t1;
  const isMac = platform === "macos";
  let t2;
  if ($[1] !== depCheck.errors) {
// 三个缺失判定都从 errors 文本里做子串匹配（some 加 includes）——上游 adapter 没有结构化的缺失项字段，按报错文案匹配是务实选择。三个判定函数提取为文件尾 _temp 系列。
    t2 = depCheck.errors.some(_temp);
    $[1] = depCheck.errors;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const rgMissing = t2;
  let t3;
  if ($[3] !== depCheck.errors) {
    t3 = depCheck.errors.some(_temp2);
    $[3] = depCheck.errors;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const bwrapMissing = t3;
  let t4;
  if ($[5] !== depCheck.errors) {
    t4 = depCheck.errors.some(_temp3);
    $[5] = depCheck.errors;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const socatMissing = t4;
// seccompMissing 的口径不同：它不进 errors 而进 warnings，因为 seccomp 可选——缺了只损失拦截 unix domain socket 的能力，沙箱仍可运行。
  const seccompMissing = depCheck.warnings.length > 0;
  let t5;
  if ($[7] !== bwrapMissing || $[8] !== depCheck.errors || $[9] !== rgMissing || $[10] !== seccompMissing || $[11] !== socatMissing) {
// 主体重建块：五个缺失状态任一变化才重算。块内又分四段缓存（macOS seatbelt 行、ripgrep 组、Linux 三件套、容器）。
    const otherErrors = depCheck.errors.filter(_temp4);
// ripgrep 安装提示按平台选包管理器：macOS 用 brew，其余用 apt。ripgrep 全平台必需——用于扫描危险目录。
    const rgInstallHint = isMac ? "brew install ripgrep" : "apt install ripgrep";
    let t6;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
// macOS 独占行：seatbelt 是系统内建，标 success 绿色。这一段与 isMac 无关的判断交给短路——isMac 为假时整段为 false 不渲染。
      t6 = isMac && <Box flexDirection="column"><Text>seatbelt: <Text color="success">built-in (macOS)</Text></Text></Box>;
      $[13] = t6;
    } else {
      t6 = $[13];
    }
    let t7;
    let t8;
    if ($[14] !== rgMissing) {
// ripgrep 行：缺失标 error 红、在场标 success 绿，缺失时下一行给安装提示。t7 与 t8 一起进 rgMissing 单依赖的槽。
      t7 = <Text>ripgrep (rg):{" "}{rgMissing ? <Text color="error">not found</Text> : <Text color="success">found</Text>}</Text>;
      t8 = rgMissing && <Text dimColor={true}>{"  "}· {rgInstallHint}</Text>;
      $[14] = rgMissing;
      $[15] = t7;
      $[16] = t8;
    } else {
      t7 = $[15];
      t8 = $[16];
    }
    let t9;
    if ($[17] !== t7 || $[18] !== t8) {
      t9 = <Box flexDirection="column">{t7}{t8}</Box>;
      $[17] = t7;
      $[18] = t8;
      $[19] = t9;
    } else {
      t9 = $[19];
    }
    let t10;
    if ($[20] !== bwrapMissing || $[21] !== seccompMissing || $[22] !== socatMissing) {
// Linux 三件套（bwrap、socat、seccomp）整段短路于 isMac 为假。seccomp 的安装指引给两条路：npm 全局装 sandbox-runtime，或手动拷贝 vendor 下的 BPF 文件并在 settings.json 里配置路径——第二条是为离线或受限环境准备的。
      t10 = !isMac && <><Box flexDirection="column"><Text>bubblewrap (bwrap):{" "}{bwrapMissing ? <Text color="error">not installed</Text> : <Text color="success">installed</Text>}</Text>{bwrapMissing && <Text dimColor={true}>{"  "}· apt install bubblewrap</Text>}</Box><Box flexDirection="column"><Text>socat:{" "}{socatMissing ? <Text color="error">not installed</Text> : <Text color="success">installed</Text>}</Text>{socatMissing && <Text dimColor={true}>{"  "}· apt install socat</Text>}</Box><Box flexDirection="column"><Text>seccomp filter:{" "}{seccompMissing ? <Text color="warning">not installed</Text> : <Text color="success">installed</Text>}{seccompMissing && <Text dimColor={true}> (required to block unix domain sockets)</Text>}</Text>{seccompMissing && <Box flexDirection="column"><Text dimColor={true}>{"  "}· npm install -g @anthropic-ai/sandbox-runtime</Text><Text dimColor={true}>{"  "}· or copy vendor/seccomp/* from sandbox-runtime and set</Text><Text dimColor={true}>{"    "}sandbox.seccomp.bpfPath and applyPath in settings.json</Text></Box>}</Box></>;
      $[20] = bwrapMissing;
      $[21] = seccompMissing;
      $[22] = socatMissing;
      $[23] = t10;
    } else {
      t10 = $[23];
    }
// 最终容器：seatbelt 行、ripgrep 组、Linux 组、其余未识别错误逐条列出。otherErrors 用 err 文本作 key——文本即身份，重复报错会撞 key，但 errors 由上游去重。
    t5 = <Box flexDirection="column" paddingY={1} gap={1}>{t6}{t9}{t10}{otherErrors.map(_temp5)}</Box>;
    $[7] = bwrapMissing;
    $[8] = depCheck.errors;
    $[9] = rgMissing;
    $[10] = seccompMissing;
    $[11] = socatMissing;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  return t5;
}
// 文件尾的 _temp 系列按声明倒序对应正文引用顺序：_temp5 渲染错误行，_temp4 过滤已单独展示的三类，_temp2 到 _temp 是三个子串匹配器。
function _temp5(err) {
  return <Text key={err} color="error">{err}</Text>;
}
function _temp4(e_2) {
  return !e_2.includes("ripgrep") && !e_2.includes("bwrap") && !e_2.includes("socat");
}
function _temp3(e_1) {
  return e_1.includes("socat");
}
function _temp2(e_0) {
  return e_0.includes("bwrap");
}
function _temp(e) {
  return e.includes("ripgrep");
}
// 原文件此处有一行 13100 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。