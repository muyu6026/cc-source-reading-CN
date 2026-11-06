// React 编译器运行时缓存。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
// 引入 GitHub App 手动配置文档链接常量。
import { GITHUB_ACTION_SETUP_DOCS_URL } from '../../constants/github-app.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
// 安装步骤属性：仓库地址与提交回调。
interface InstallAppStepProps {
  repoUrl: string;
  onSubmit: () => void;
}
// 安装 GitHub App 引导步骤组件。
export function InstallAppStep(t0) {
  const $ = _c(12);
  const {
    repoUrl,
    onSubmit
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化按键绑定上下文标签。
    t1 = {
      context: "Confirmation"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:yes", onSubmit, t1);
// 绑定 confirm:yes 快捷键到提交回调。
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化标题「Install the Claude GitHub App」。
    t2 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>Install the Claude GitHub App</Text></Box>;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「正在打开浏览器」提示。
    t3 = <Box marginBottom={1}><Text>Opening browser to install the Claude GitHub App…</Text></Box>;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「如浏览器未自动打开请访问」提示。
    t4 = <Box marginBottom={1}><Text>If your browser doesn't open automatically, visit:</Text></Box>;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  let t5;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化 GitHub App 安装页链接。
    t5 = <Box marginBottom={1}><Text underline={true}>https://github.com/apps/claude</Text></Box>;
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  let t6;
  if ($[5] !== repoUrl) {
// 依赖 repoUrl 重建请为特定仓库安装提示。
    t6 = <Box marginBottom={1}><Text>Please install the app for repository: <Text bold={true}>{repoUrl}</Text></Text></Box>;
    $[5] = repoUrl;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  let t7;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「务必授予该仓库访问权」提示。
    t7 = <Box marginBottom={1}><Text dimColor={true}>Important: Make sure to grant access to this specific repository</Text></Box>;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「安装完成后按回车」提示。
    t8 = <Box><Text bold={true} color="permission">Press Enter once you've installed the app{figures.ellipsis}</Text></Box>;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  let t9;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化「遇到问题见手动配置文档」提示。
    t9 = <Box marginTop={1}><Text dimColor={true}>Having trouble? See manual setup instructions at:{" "}<Text color="claude">{GITHUB_ACTION_SETUP_DOCS_URL}</Text></Text></Box>;
    $[9] = t9;
  } else {
    t9 = $[9];
  }
  let t10;
  if ($[10] !== t6) {
// 组合全部子块到圆角容器。
    t10 = <Box flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1}>{t2}{t3}{t4}{t5}{t6}{t7}{t8}{t9}</Box>;
    $[10] = t6;
    $[11] = t10;
  } else {
    t10 = $[11];
  }
  return t10;
// 返回最终组合节点。
}
// 原文件此处有一行 6800 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。