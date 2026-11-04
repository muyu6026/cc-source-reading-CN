import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to continue
import { Box, Link, Newline, Text, useInput } from '../ink.js';
import { isChromeExtensionInstalled } from '../utils/claudeInChrome/setup.js';
import { saveGlobalConfig } from '../utils/config.js';
import { Dialog } from './design-system/Dialog.js';
// 两个链接常量：扩展安装页与权限说明页。权限页用短链 clau.de——终端里手动输入的 URL 越短越好。
const CHROME_EXTENSION_URL = 'https://claude.ai/chrome';
const CHROME_PERMISSIONS_URL = 'https://clau.de/chrome/permissions';
type Props = {
  onDone(): void;
};
// Claude in Chrome 集成的引导弹窗：介绍浏览器控制能力，检测扩展是否已装，完成后写全局配置标记。Beta 阶段功能，标题里注明。
export function ClaudeInChromeOnboarding(t0) {
  const $ = _c(20);
  const {
    onDone
  } = t0;
  const [isExtensionInstalled, setIsExtensionInstalled] = React.useState(false);
  let t1;
  let t2;
// 挂载 effect（依赖空数组，编译器连依赖数组本身也进了记忆槽）：三件事——打点上报弹窗展示、异步探测扩展安装状态、写配置标记引导已完成。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      logEvent("tengu_claude_in_chrome_onboarding_shown", {});
      isChromeExtensionInstalled().then(setIsExtensionInstalled);
// isChromeExtensionInstalled 返回 Promise，then 后 setState。组件可能在 Promise 结算前卸载，React 18 对已卸载组件的 setState 是静默无害的。
      saveGlobalConfig(_temp);
// saveGlobalConfig 的更新器被提取为文件尾 _temp：把 hasCompletedClaudeInChromeOnboarding 置真，下次不再弹此引导。
    };
    t2 = [];
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  React.useEffect(t1, t2);
  let t3;
  if ($[2] !== onDone) {
// useInput 直接监听回车结束引导。第 4 行 eslint-disable 注明故意绕过 keybindings 体系——引导弹窗是临时交互面，不值得注册全局键位。
    t3 = (_input, key) => {
      if (key.return) {
        onDone();
      }
    };
    $[2] = onDone;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  useInput(t3);
  let t4;
  if ($[4] !== isExtensionInstalled) {
// 未安装扩展时追加下载入口：两个 Newline 隔开、附带链接。isExtensionInstalled 变化时这一段整体重建。
    t4 = !isExtensionInstalled && <><Newline /><Newline />Requires the Chrome extension. Get started at{" "}<Link url={CHROME_EXTENSION_URL} /></>;
    $[4] = isExtensionInstalled;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== t4) {
// 介绍文案：浏览器导航、填表、截图、录 GIF、控制台与网络调试。文案末尾拼接第 51 行的安装提示段（未安装时非空）。
    t5 = <Text>Claude in Chrome works with the Chrome extension to let you control your browser directly from Claude Code. You can navigate websites, fill forms, capture screenshots, record GIFs, and debug with console logs and network requests.{t4}</Text>;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== isExtensionInstalled) {
    t6 = isExtensionInstalled && <>{" "}(<Link url={CHROME_PERMISSIONS_URL} />)</>;
    $[8] = isExtensionInstalled;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== t6) {
// 权限说明：站点级权限继承自 Chrome 扩展本体，Claude Code 侧不单独管理。已安装时附权限管理页链接（第 67 行 t6）。
    t7 = <Text dimColor={true}>Site-level permissions are inherited from the Chrome extension. Manage permissions in the Chrome extension settings to control which sites Claude can browse, click, and type on{t6}.</Text>;
    $[10] = t6;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  let t8;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text bold={true} color="chromeYellow">/chrome</Text>;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
// 更多信息的静态段：/chrome 命令加文档链接，整体进常量槽。
    t9 = <Text dimColor={true}>For more info, use{" "}{t8}{" "}or visit <Link url="https://code.claude.com/docs/en/chrome" /></Text>;
    $[13] = t9;
  } else {
    t9 = $[13];
  }
  let t10;
  if ($[14] !== t5 || $[15] !== t7) {
    t10 = <Box flexDirection="column" gap={1}>{t5}{t7}{t9}</Box>;
    $[14] = t5;
    $[15] = t7;
    $[16] = t10;
  } else {
    t10 = $[16];
  }
  let t11;
  if ($[17] !== onDone || $[18] !== t10) {
// Dialog color 为 chromeYellow：品牌专属色。onCancel 即 onDone——弹窗没有失败路径，关闭就是完成。
    t11 = <Dialog title="Claude in Chrome (Beta)" onCancel={onDone} color="chromeYellow">{t10}</Dialog>;
    $[17] = onDone;
    $[18] = t10;
    $[19] = t11;
  } else {
    t11 = $[19];
  }
  return t11;
}
function _temp(current) {
  return {
    ...current,
    hasCompletedClaudeInChromeOnboarding: true
  };
}
// 原文件此处有一行 8616 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。