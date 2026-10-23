import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import { getRateLimitWarning, getUsingOverageText } from 'src/services/claudeAiLimits.js';
import { useClaudeAiLimits } from 'src/services/claudeAiLimitsHook.js';
import { getSubscriptionType } from 'src/utils/auth.js';
import { hasClaudeAiBillingAccess } from 'src/utils/billing.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
export function useRateLimitWarningNotification(model) {
// 两个独立通知：超额使用（isUsingOverage）一次性提示；
// 限流警告（rateLimitWarning）按文案去重提示。都走
// claudeAiLimits hook 拉取的限额数据。
  const $ = _c(17);
  const {
    addNotification
  } = useNotifications();
  const claudeAiLimits = useClaudeAiLimits();
  let t0;
  if ($[0] !== claudeAiLimits || $[1] !== model) {
    t0 = getRateLimitWarning(claudeAiLimits, model);
    $[0] = claudeAiLimits;
    $[1] = model;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const rateLimitWarning = t0;
  let t1;
  if ($[3] !== claudeAiLimits) {
    t1 = getUsingOverageText(claudeAiLimits);
    $[3] = claudeAiLimits;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const usingOverageText = t1;
// 已示警告 ref：同一条限流文案不重复弹
// （与 useDeprecationWarningNotification 同一模式）。
  const shownWarningRef = useRef(null);
  let t2;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getSubscriptionType();
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const subscriptionType = t2;
// 订阅类型只读一次（memo 缓存，不随渲染更新）——
// 判断是否需要展示超额提示用，一次会话内不会变。
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = hasClaudeAiBillingAccess();
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const hasBillingAccess = t3;
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
// team/enterprise 账号默认不弹超额提示，
// 除非有独立的计费访问权（hasBillingAccess）。
  const [hasShownOverageNotification, setHasShownOverageNotification] = useState(false);
  let t4;
  let t5;
  if ($[7] !== addNotification || $[8] !== claudeAiLimits.isUsingOverage || $[9] !== hasShownOverageNotification || $[10] !== usingOverageText) {
    t4 = () => {
      if (getIsRemoteMode()) {
        return;
      }
// 三条件才提示：正在超额 + 本次会话没提示过 +
// （非 team/enterprise 或有计费权）。state 标记保证只弹一次。
      if (claudeAiLimits.isUsingOverage && !hasShownOverageNotification && (!isTeamOrEnterprise || hasBillingAccess)) {
        addNotification({
          key: "limit-reached",
          text: usingOverageText,
          priority: "immediate"
        });
// 一次性标记置位；回到非超额状态时复位，
// 下次超额可再次提示。
        setHasShownOverageNotification(true);
      } else {
        if (!claudeAiLimits.isUsingOverage && hasShownOverageNotification) {
          setHasShownOverageNotification(false);
        }
      }
    };
    t5 = [claudeAiLimits.isUsingOverage, usingOverageText, hasShownOverageNotification, addNotification, hasBillingAccess, isTeamOrEnterprise];
    $[7] = addNotification;
    $[8] = claudeAiLimits.isUsingOverage;
    $[9] = hasShownOverageNotification;
    $[10] = usingOverageText;
    $[11] = t4;
    $[12] = t5;
  } else {
    t4 = $[11];
    t5 = $[12];
  }
  useEffect(t4, t5);
  let t6;
  let t7;
  if ($[13] !== addNotification || $[14] !== rateLimitWarning) {
    t6 = () => {
      if (getIsRemoteMode()) {
        return;
      }
// 警告文案变化才提示（ref 记录上一条文案）——
// 渲染抖动导致同文案重复计算不会刷屏。
      if (rateLimitWarning && rateLimitWarning !== shownWarningRef.current) {
        shownWarningRef.current = rateLimitWarning;
        addNotification({
          key: "rate-limit-warning",
          jsx: <Text><Text color="warning">{rateLimitWarning}</Text></Text>,
          priority: "high"
        });
      }
    };
    t7 = [rateLimitWarning, addNotification];
    $[13] = addNotification;
    $[14] = rateLimitWarning;
    $[15] = t6;
    $[16] = t7;
  } else {
    t6 = $[15];
    t7 = $[16];
  }
  useEffect(t6, t7);
}
// 原文件此处有一行 8696 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。