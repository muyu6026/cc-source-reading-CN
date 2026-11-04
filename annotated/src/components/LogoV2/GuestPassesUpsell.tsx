import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import { checkCachedPassesEligibility, formatCreditAmount, getCachedReferrerReward, getCachedRemainingPasses } from '../../services/api/referral.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
// resetIfPassesRefreshed：剩余通行证变多（刷新或换活动）就把提示计数清零
function resetIfPassesRefreshed(): void {
  const remaining = getCachedRemainingPasses();
  if (remaining == null || remaining <= 0) return;
// 剩余为空或 0 直接返回：没有通行证不涉及提示
  const config = getGlobalConfig();
  const lastSeen = config.passesLastSeenRemaining ?? 0;
  if (remaining > lastSeen) {
// 只有严格变多才重置：数量减少不同步计数器，避免用户消耗后又被反复提示
    saveGlobalConfig(prev => ({
// 三个字段一起复位：次数、是否访问过通行证页、上次看到的剩余数
      ...prev,
      passesUpsellSeenCount: 0,
      hasVisitedPasses: false,
      passesLastSeenRemaining: remaining
    }));
  }
}
// shouldShowGuestPassesUpsell：四道闸门
function shouldShowGuestPassesUpsell(): boolean {
  const {
    eligible,
    hasCache
  } = checkCachedPassesEligibility();
  // Only show if eligible and cache exists (don't block on fetch)
  if (!eligible || !hasCache) return false;
// 必须既 eligible 又有缓存：注释写明不在展示路径上等网络请求
  // Reset upsell counters if passes were refreshed (covers both campaign change and pass refresh)
  resetIfPassesRefreshed();
  const config = getGlobalConfig();
  if ((config.passesUpsellSeenCount ?? 0) >= 3) return false;
// 看过 3 次就不再提示：软上限
  if (config.hasVisitedPasses) return false;
// 访问过通行证页面就不再提示：用户已知晓
  return true;
}
export function useShowGuestPassesUpsell() {
  const [show] = useState(_temp);
// 用 useState 的惰性初始值只求一次：这个判据带写盘副作用，不能每次渲染都跑
  return show;
}
function _temp() {
  return shouldShowGuestPassesUpsell();
}
export function incrementGuestPassesSeenCount(): void {
  let newCount = 0;
  saveGlobalConfig(prev => {
    newCount = (prev.passesUpsellSeenCount ?? 0) + 1;
// 计数器自增放在配置写入回调里：拿到的 prev 是最新值，避免并发覆盖
    return {
      ...prev,
      passesUpsellSeenCount: newCount
    };
  });
  logEvent('tengu_guest_passes_upsell_shown', {
// 打点带 seen_count：能看出提示第几次展示时的转化
    seen_count: newCount
  });
}

// Condensed layout for mini welcome screen
export function GuestPassesUpsell() {
  const $ = _c(1);
  let t0;
// 整行内容哨兵缓存：奖励金额在本次会话内不会变
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    const reward = getCachedReferrerReward();
    t0 = <Text dimColor={true}><Text color="claude">[✻]</Text> <Text color="claude">[✻]</Text>{" "}<Text color="claude">[✻]</Text> ·{" "}{reward ? `Share Claude Code and earn ${formatCreditAmount(reward)} of extra usage · /passes` : "3 guest passes at /passes"}</Text>;
// 精简版只有一行：三个图标加中间点加文案，文案按有无奖励分叉（有奖励则显示金额与 /passes）
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
// 原文件此处有一行 6700 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。