import * as React from 'react';
import { Text } from '../ink.js';
import { isClaudeAISubscriber } from '../utils/auth.js';
import { isChromeExtensionInstalled, shouldEnableClaudeInChrome } from '../utils/claudeInChrome/setup.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import { useStartupNotification } from './notifs/useStartupNotification.js';
function getChromeFlag(): boolean | undefined {
// CLI 参数解析：--chrome 强制开、--no-chrome 强制关、都不给则 undefined 走默认。
  if (process.argv.includes('--chrome')) {
    return true;
  }
  if (process.argv.includes('--no-chrome')) {
    return false;
  }
  return undefined;
}
export function useChromeExtensionNotification() {
// 本 hook 只是壳：把 compute 逻辑 _temp 委托给 useStartupNotification 基座，
// 复用其「一次性计算 + 远程门控」的通用流程。
  useStartupNotification(_temp);
}
async function _temp() {
  const chromeFlag = getChromeFlag();
  if (!shouldEnableClaudeInChrome(chromeFlag)) {
    return null;
  }
  if (true && !isClaudeAISubscriber()) {
// 注：if (true && !isClaudeAISubscriber()) 里的 true && 是 feature flag 移除后的残留恒真短路，
// 已无开关意义（与构建环境泄漏的恒假条件不同类，但同样值得清理）。
    return {
      key: "chrome-requires-subscription",
      jsx: <Text color="error">Claude in Chrome requires a claude.ai subscription</Text>,
      priority: "immediate",
      timeoutMs: 5000
    };
  }
  const installed = await isChromeExtensionInstalled();
// 扩展未装且不在 Homespace 环境时弹「未检测到扩展」提示（带安装链接），5 秒低优。
  if (!installed && !isRunningOnHomespace()) {
    return {
      key: "chrome-extension-not-detected",
      jsx: <Text color="warning">Chrome extension not detected · https://claude.ai/chrome to install</Text>,
      priority: "immediate",
      timeoutMs: 3000
    };
  }
  if (chromeFlag === undefined) {
    return {
      key: "claude-in-chrome-default-enabled",
      text: "Claude in Chrome enabled \xB7 /chrome",
      priority: "low"
    };
  }
  return null;
}
// 原文件此处有一行 5212 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。