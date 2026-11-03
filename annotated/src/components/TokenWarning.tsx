import { c as _c } from "react/compiler-runtime";
// 导入 React 编译期缓存运行时
import { feature } from 'bun:bundle';
// bun:bundle 的 feature 开关，用于条件启用实验特性
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { Box, Text } from '../ink.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { calculateTokenWarningState, getEffectiveContextWindowSize, isAutoCompactEnabled } from '../services/compact/autoCompact.js';
import { useCompactWarningSuppression } from '../services/compact/compactWarningHook.js';
import { getUpgradeMessage } from '../utils/model/contextWindowUpgradeCheck.js';
type Props = {
  tokenUsage: number;
  model: string;
};

/**
 * Live collapse progress: "x / y summarized". Sub-component so
 * useSyncExternalStore can subscribe to store mutations unconditionally
 * (hooks-in-conditionals would violate React rules). The parent only
 * renders this when feature('CONTEXT_COLLAPSE') + isContextCollapseEnabled().
 */
function CollapseLabel(t0) {
// 折叠进度子组件，注释说明用 useSyncExternalStore 订阅存储变更
  const $ = _c(8);
  const {
    upgradeMessage
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = require("../services/contextCollapse/index.js");
// 延迟加载 contextCollapse 模块
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const {
    getStats,
    subscribe
  } = t1 as typeof import('../services/contextCollapse/index.js');
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      const s = getStats();
      const idleWarn = s.health.emptySpawnWarningEmitted ? 1 : 0;
      return `${s.collapsedSpans}|${s.stagedSpans}|${s.health.totalErrors}|${s.health.totalEmptySpawns}|${idleWarn}`;
    };
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const snapshot = useSyncExternalStore(subscribe, t2);
// 订阅折叠统计存储，获取实时折叠指标
  let t3;
  if ($[2] !== snapshot) {
    t3 = snapshot.split("|").map(Number);
    $[2] = snapshot;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const [collapsed, staged, errors, emptySpawns, idleWarn_0] = t3 as [number, number, number, number, number];
  const total = collapsed + staged;
  if (errors > 0 || idleWarn_0) {
// 存在错误或空闲告警时显示问题摘要
    const problem = errors > 0 ? `collapse errors: ${errors}` : `collapse idle (${emptySpawns} empty runs)`;
    const t4 = total > 0 ? `${collapsed} / ${total} summarized \u00b7 ${problem}` : problem;
    let t5;
    if ($[4] !== t4) {
      t5 = <Text color="warning" wrap="truncate">{t4}</Text>;
      $[4] = t4;
      $[5] = t5;
    } else {
      t5 = $[5];
    }
    return t5;
  }
  if (total === 0) {
    return null;
  }
  const label = `${collapsed} / ${total} summarized`;
// 正常时显示已折叠/总计 的进度文本
  const t4 = upgradeMessage ? `${label} \u00b7 ${upgradeMessage}` : label;
  let t5;
  if ($[6] !== t4) {
    t5 = <Text dimColor={true} wrap="truncate">{t4}</Text>;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  return t5;
}
export function TokenWarning(t0) {
// token 用量告警主组件
  const $ = _c(13);
  const {
    tokenUsage,
    model
  } = t0;
  let t1;
  if ($[0] !== model || $[1] !== tokenUsage) {
// 依据用量与模型计算告警阈值与剩余百分比
    t1 = calculateTokenWarningState(tokenUsage, model);
    $[0] = model;
    $[1] = tokenUsage;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold
  } = t1;
  const suppressWarning = useCompactWarningSuppression();
// 是否因用户抑制而不显示告警
  if (!isAboveWarningThreshold || suppressWarning) {
    return null;
  }
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = isAutoCompactEnabled();
// 读取自动压缩是否启用
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const showAutoCompactWarning = t2;
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = getUpgradeMessage("warning");
// 获取升级提示文案
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const upgradeMessage = t3;
  let displayPercentLeft = percentLeft;
  let reactiveOnlyMode = false;
  let collapseMode = false;
  if (feature("REACTIVE_COMPACT")) {
// REACTIVE_COMPACT 实验：可能启用纯响应式压缩模式
    if (getFeatureValue_CACHED_MAY_BE_STALE("tengu_cobalt_raccoon", false)) {
      reactiveOnlyMode = true;
    }
  }
  if (feature("CONTEXT_COLLAPSE")) {
// CONTEXT_COLLAPSE 实验：可能启用上下文折叠模式
    const {
      isContextCollapseEnabled
    } = require("../services/contextCollapse/index.js") as typeof import('../services/contextCollapse/index.js');
    if (isContextCollapseEnabled()) {
      collapseMode = true;
    }
  }
  if (reactiveOnlyMode || collapseMode) {
    const effectiveWindow = getEffectiveContextWindowSize(model);
// 折叠模式下按有效窗口计算剩余百分比
    let t4;
    if ($[5] !== effectiveWindow || $[6] !== tokenUsage) {
      t4 = Math.round((effectiveWindow - tokenUsage) / effectiveWindow * 100);
      $[5] = effectiveWindow;
      $[6] = tokenUsage;
      $[7] = t4;
    } else {
      t4 = $[7];
    }
    displayPercentLeft = Math.max(0, t4);
  }
  if (collapseMode && feature("CONTEXT_COLLAPSE")) {
// 折叠模式额外渲染实时折叠进度标签
    let t4;
    if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Box flexDirection="row"><CollapseLabel upgradeMessage={upgradeMessage} /></Box>;
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    return t4;
  }
  const autocompactLabel = reactiveOnlyMode ? `${100 - displayPercentLeft}% context used` : `${displayPercentLeft}% until auto-compact`;
// 普通模式根据阈值显示剩余百分比或低上下文告警
  let t4;
  if ($[9] !== autocompactLabel || $[10] !== isAboveErrorThreshold || $[11] !== percentLeft) {
    t4 = <Box flexDirection="row">{showAutoCompactWarning ? <Text dimColor={true} wrap="truncate">{upgradeMessage ? `${autocompactLabel} \u00b7 ${upgradeMessage}` : autocompactLabel}</Text> : <Text color={isAboveErrorThreshold ? "error" : "warning"} wrap="truncate">{upgradeMessage ? `Context low (${percentLeft}% remaining) \u00b7 ${upgradeMessage}` : `Context low (${percentLeft}% remaining) \u00b7 Run /compact to compact & continue`}</Text>}</Box>;
    $[9] = autocompactLabel;
    $[10] = isAboveErrorThreshold;
    $[11] = percentLeft;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  return t4;
}
// 原文件此处有一行 15752 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。