import { c as _c } from "react/compiler-runtime";
// OverageCreditUpsell 处理超额用量额度的促销：决定该不该在 /usage 或欢迎流里展示一条赠金广告，并生成首页轮播的 feed 内容。
import * as React from 'react';
import { useState } from 'react';
import { Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import { formatGrantAmount, getCachedOverageCreditGrant, refreshOverageCreditGrantCache } from '../../services/api/overageCreditGrant.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { truncate } from '../../utils/format.js';
import type { FeedConfig } from './Feed.js';
// FeedConfig 是首页轮播 feed 的配置类型，本文件末尾的 createOverageCreditFeed 会返回它。
const MAX_IMPRESSIONS = 3;
// MAX_IMPRESSIONS = 3 限制促销在推广型界面最多出现 3 次，避免刷屏。

/**
 * Whether to show the overage credit upsell on any surface.
 *
 * Eligibility comes entirely from the backend GET /overage_credit_grant
 * response — the CLI doesn't replicate tier/threshold/role checks. The
 * backend returns available: false for Team members who aren't admins,
 * so they don't see an upsell they can't act on.
 *
 * isEligibleForOverageCreditGrant — just the backend eligibility. Use for
 *   persistent reference surfaces (/usage) where the info should show
 *   whenever eligible, no impression cap.
 * shouldShowOverageCreditUpsell — adds the 3-impression cap and
 *   hasVisitedExtraUsage dismiss. Use for promotional surfaces
 *   (welcome feed, tips).
 */
// 文件头注释说明：是否展示完全由后端 GET /overage_credit_grant 的返回决定，CLI 不重复做层级/阈值/角色的判定；Team 非管理员后端会直接返回 available:false。
export function isEligibleForOverageCreditGrant(): boolean {
  const info = getCachedOverageCreditGrant();
  if (!info || !info.available || info.granted) return false;
  return formatGrantAmount(info) !== null;
}
// isEligibleForOverageCreditGrant 只看后端资格：有可用额度且还没发放、且能格式化成金额时才算合格，用于 /usage 这类持久界面（无曝光上限）。
export function shouldShowOverageCreditUpsell(): boolean {
  if (!isEligibleForOverageCreditGrant()) return false;
  const config = getGlobalConfig();
  if (config.hasVisitedExtraUsage) return false;
  if ((config.overageCreditUpsellSeenCount ?? 0) >= MAX_IMPRESSIONS) return false;
  return true;
}
// shouldShowOverageCreditUpsell 在资格之上再加两道闸：用户访问过 /extra-usage 之后不再弹，且曝光次数达到 3 次上限后也不再弹，用于欢迎流等推广界面。

/**
 * Kick off a background fetch if the cache is empty. Safe to call
 * unconditionally on mount — it no-ops if cache is fresh.
 */
// maybeRefreshOverageCreditCache 的注释说明：缓存为空时后台拉取一次，挂载时无条件调用也安全（缓存新鲜就空操作）。
export function maybeRefreshOverageCreditCache(): void {
  if (getCachedOverageCreditGrant() !== null) return;
  void refreshOverageCreditGrantCache();
}
// maybeRefreshOverageCreditCache 仅在缓存为空时触发后台刷新，否则直接返回。
export function useShowOverageCreditUpsell() {
  const [show] = useState(_temp);
  return show;
}
// useShowOverageCreditUpsell 用 useState 的惰性初始化，挂载即决定是否展示。
function _temp() {
  maybeRefreshOverageCreditCache();
  return shouldShowOverageCreditUpsell();
}
// _temp 先确保缓存刷新过，再返回 shouldShowOverageCreditUpsell 的判定结果。
export function incrementOverageCreditUpsellSeenCount(): void {
  let newCount = 0;
  saveGlobalConfig(prev => {
    newCount = (prev.overageCreditUpsellSeenCount ?? 0) + 1;
    return {
      ...prev,
      overageCreditUpsellSeenCount: newCount
    };
  });
  logEvent('tengu_overage_credit_upsell_shown', {
    seen_count: newCount
  });
}
// incrementOverageCreditUpsellSeenCount 把已展示次数加一并落盘，同时打 tengu_overage_credit_upsell_shown 埋点带上次数。

// Copy from "OC & Bulk Overages copy" doc (#6 — CLI /usage)
// getUsageText 的文案直接照搬产品文档（OC & Bulk Overages），用于 CLI /usage 界面。
function getUsageText(amount: string): string {
  return `${amount} in extra usage for third-party apps · /extra-usage`;
}
// getUsageText 返回「<金额> in extra usage for third-party apps · /extra-usage」的提示串。

// Copy from "OC & Bulk Overages copy" doc (#4 — CLI Welcome screen).
// Char budgets: title ≤19, subtitle ≤48.
// FEED_SUBTITLE 等常量也来自同一份产品文档，并标注了字符预算：标题 ≤19、副标题 ≤48。
const FEED_SUBTITLE = 'On us. Works on third-party apps · /extra-usage';
// FEED_SUBTITLE 是首页 feed 的副标题文案。
function getFeedTitle(amount: string): string {
  return `${amount} in extra usage`;
}
// getFeedTitle 把金额拼成「<金额> in extra usage」作为 feed 标题。
type Props = {
  maxWidth?: number;
  twoLine?: boolean;
};
// Props 只有一个可选 maxWidth（截断宽度）和 twoLine（是否两行显示）开关。
export function OverageCreditUpsell(t0) {
  const $ = _c(8);
  const {
    maxWidth,
    twoLine
  } = t0;
  let t1;
  let t2;
  if ($[0] !== maxWidth || $[1] !== twoLine) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const info = getCachedOverageCreditGrant();
      if (!info) {
        t2 = null;
        break bb0;
      }
      const amount = formatGrantAmount(info);
      if (!amount) {
        t2 = null;
        break bb0;
      }
      if (twoLine) {
        const title = getFeedTitle(amount);
        let t3;
        if ($[4] !== maxWidth) {
          t3 = maxWidth ? truncate(FEED_SUBTITLE, maxWidth) : FEED_SUBTITLE;
          $[4] = maxWidth;
          $[5] = t3;
        } else {
          t3 = $[5];
        }
        let t4;
        if ($[6] !== t3) {
          t4 = <Text dimColor={true}>{t3}</Text>;
          $[6] = t3;
          $[7] = t4;
        } else {
          t4 = $[7];
        }
        t2 = <><Text color="claude">{maxWidth ? truncate(title, maxWidth) : title}</Text>{t4}</>;
        break bb0;
      }
      const text = getUsageText(amount);
      const display = maxWidth ? truncate(text, maxWidth) : text;
      const highlightLen = Math.min(getFeedTitle(amount).length, display.length);
      t1 = <Text dimColor={true}><Text color="claude">{display.slice(0, highlightLen)}</Text>{display.slice(highlightLen)}</Text>;
    }
    $[0] = maxWidth;
    $[1] = twoLine;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  return t1;
}
// OverageCreditUpsell 组件先取缓存额度，没有或金额空就返回 null；twoLine 模式显示标题加副标题两行，否则显示单行带高亮前缀的用量文案。

/**
 * Feed config for the homescreen rotating feed. Mirrors
 * createGuestPassesFeed in feedConfigs.tsx.
 *
 * Copy from "OC & Bulk Overages copy" doc (#4 — CLI Welcome screen).
 * Char budgets: title ≤19, subtitle ≤48.
 */
// createOverageCreditFeed 的注释说明它镜像 feedConfigs.tsx 里的 createGuestPassesFeed，同样遵循字符预算。
export function createOverageCreditFeed(): FeedConfig {
  const info = getCachedOverageCreditGrant();
  const amount = info ? formatGrantAmount(info) : null;
  const title = amount ? getFeedTitle(amount) : 'extra usage credit';
  return {
    title,
    lines: [],
    customContent: {
      content: <Text dimColor>{FEED_SUBTITLE}</Text>,
      width: Math.max(title.length, FEED_SUBTITLE.length)
    }
  };
}
// createOverageCreditFeed 返回首页轮播 feed 配置：标题取金额或兜底文案，customContent 放暗色副标题，宽度取标题与副标题的较长者。
// 原文件此处有一行 12992 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。