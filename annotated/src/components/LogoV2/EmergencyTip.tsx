import * as React from 'react';
import { useEffect, useMemo } from 'react';
import { Box, Text } from 'src/ink.js';
import { getDynamicConfig_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';
const CONFIG_NAME = 'tengu-top-of-feed-tip';
// 紧急提示条：从动态配置取一条置顶提示，看过即写入全局配置不再重复展示。
export function EmergencyTip(): React.ReactNode {
  const tip = useMemo(getTipOfFeed, []);
  // Memoize to prevent re-reads after we save - we want the value at mount time
  const lastShownTip = useMemo(() => getGlobalConfig().lastShownEmergencyTip, []);

  // Only show if this is a new/different tip
  const shouldShow = tip.tip && tip.tip !== lastShownTip;
// 仅当本次提示存在且与上次展示的不相同时才显示。

  // Save the tip we're showing so we don't show it again
  useEffect(() => {
    if (shouldShow) {
      saveGlobalConfig(current => {
        if (current.lastShownEmergencyTip === tip.tip) return current;
        return {
          ...current,
          lastShownEmergencyTip: tip.tip
        };
      });
    }
  }, [shouldShow, tip.tip]);
  if (!shouldShow) {
    return null;
  }
  return <Box paddingLeft={2} flexDirection="column">
      <Text {...tip.color === 'warning' ? {
      color: 'warning'
    } : tip.color === 'error' ? {
      color: 'error'
    } : {
      dimColor: true
    }}>
        {tip.tip}
      </Text>
    </Box>;
}
type TipOfFeed = {
  tip: string;
  color?: 'dim' | 'warning' | 'error';
};
const DEFAULT_TIP: TipOfFeed = {
  tip: '',
  color: 'dim'
};

/**
 * Get the tip of the feed from dynamic config with caching
 * Returns cached value immediately, updates in background
 */
function getTipOfFeed(): TipOfFeed {
  return getDynamicConfig_CACHED_MAY_BE_STALE<TipOfFeed>(CONFIG_NAME, DEFAULT_TIP);
}
// getTipOfFeed 走带缓存的动态配置读取，立即返回缓存值、后台更新。
// 原文件此处有一行 4984 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。