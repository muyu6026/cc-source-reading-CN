import * as React from 'react';
import type { Notification } from '../context/notifications.js';
import { Text } from '../ink.js';
import { logForDebugging } from '../utils/debug.js';
import { checkAndInstallOfficialMarketplace } from '../utils/plugins/officialMarketplaceStartupCheck.js';
import { useStartupNotification } from './notifs/useStartupNotification.js';

/**
 * Hook that handles official marketplace auto-installation and shows
 * notifications for success/failure in the bottom right of the REPL.
 */
// 薄封装 hook：仅把「官方市场自动安装检查」作为一次性 compute 交给 useStartupNotification 基座，自身不负责排程。
export function useOfficialMarketplaceNotification() {
  useStartupNotification(_temp);
}
async function _temp() {
  const result = await checkAndInstallOfficialMarketplace();
// 同步跑安装检查；configSaveFailed / installed / skipped(unknown) 三类结果各自 push 一条右下角通知（基座统一控制展示与超时）。
  const notifs = [];
  if (result.configSaveFailed) {
    logForDebugging("Showing marketplace config save failure notification");
    notifs.push({
      key: "marketplace-config-save-failed",
      jsx: <Text color="error">Failed to save marketplace retry info · Check ~/.claude.json permissions</Text>,
      priority: "immediate",
      timeoutMs: 10000
    });
  }
  if (result.installed) {
    logForDebugging("Showing marketplace installation success notification");
    notifs.push({
      key: "marketplace-installed",
      jsx: <Text color="success">✓ Anthropic marketplace installed · /plugin to see available plugins</Text>,
      priority: "immediate",
      timeoutMs: 7000
    });
  } else {
    if (result.skipped && result.reason === "unknown") {
      logForDebugging("Showing marketplace installation failure notification");
      notifs.push({
        key: "marketplace-install-failed",
        jsx: <Text color="warning">Failed to install Anthropic marketplace · Will retry on next startup</Text>,
        priority: "immediate",
        timeoutMs: 8000
      });
    }
  }
  return notifs;
}
// 原文件此处有一行 5488 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。