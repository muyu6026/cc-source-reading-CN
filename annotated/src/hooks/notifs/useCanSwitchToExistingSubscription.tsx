import * as React from 'react';
import { getOauthProfileFromApiKey } from 'src/services/oauth/getOauthProfile.js';
import { isClaudeAISubscriber } from 'src/utils/auth.js';
import { Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { useStartupNotification } from './useStartupNotification.js';
// 全局最多提示 3 次（config.subscriptionNoticeCount 计数）——
// 反复骚扰用户去 /login 适得其反。
const MAX_SHOW_COUNT = 3;

/**
 * Hook to check if the user has a subscription on Console but isn't logged into it.
 */
// 检测「账号有 Claude 订阅但当前用 API key 登录」的错配，
// 提示切回订阅登录。整个 hook 只是 useStartupNotification
// 的一行包装，逻辑全在 _temp2 里。
export function useCanSwitchToExistingSubscription() {
  useStartupNotification(_temp2);
}

/**
 * Checks if the user has a subscription but is not currently logged into it.
 * This helps inform users they should run /login to access their subscription.
 */
// 启动通知计算函数：异步反查 profile。
async function _temp2() {
// 计数达上限直接放弃（连网络都不查）。
  if ((getGlobalConfig().subscriptionNoticeCount ?? 0) >= MAX_SHOW_COUNT) {
    return null;
  }
  const subscriptionType = await getExistingClaudeSubscription();
  if (subscriptionType === null) {
    return null;
  }
// 每条提示落盘前先把全局计数 +1（先行落盘，
// 即使通知展示失败也不再重试）。
  saveGlobalConfig(_temp);
  logEvent("tengu_switch_to_subscription_notice_shown", {});
  return {
    key: "switch-to-subscription",
    jsx: <Text color="suggestion">Use your existing Claude {subscriptionType} plan with Claude Code<Text color="text" dimColor={true}>{" "}· /login to activate</Text></Text>,
    priority: "low"
  };
}
function _temp(current) {
  return {
    ...current,
    subscriptionNoticeCount: (current.subscriptionNoticeCount ?? 0) + 1
  };
}
async function getExistingClaudeSubscription(): Promise<'Max' | 'Pro' | null> {
  // If already using subscription auth, there is nothing to switch to
// 已在用订阅登录 → 无可切换，短路。
  if (isClaudeAISubscriber()) {
    return null;
  }
  const profile = await getOauthProfileFromApiKey();
  if (!profile) {
    return null;
  }
// Max 优先于 Pro（账号可能两者都有）。
  if (profile.account.has_claude_max) {
    return 'Max';
  }
  if (profile.account.has_claude_pro) {
    return 'Pro';
  }
  return null;
}
// 原文件此处有一行 5328 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。