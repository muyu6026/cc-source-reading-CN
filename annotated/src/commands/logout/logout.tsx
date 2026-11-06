// 导入 React 与登出所需的一批清理 / 缓存失效函数
import * as React from 'react';
import { clearTrustedDeviceTokenCache } from '../../bridge/trustedDevice.js';
import { Text } from '../../ink.js';
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js';
import { getGroveNoticeConfig, getGroveSettings } from '../../services/api/grove.js';
import { clearPolicyLimitsCache } from '../../services/policyLimits/index.js';
// flushTelemetry is loaded lazily to avoid pulling in ~1.1MB of OpenTelemetry at startup
// 延迟加载 flushTelemetry，避免启动期拉入约 1.1MB OpenTelemetry
import { clearRemoteManagedSettingsCache } from '../../services/remoteManagedSettings/index.js';
import { getClaudeAIOAuthTokens, removeApiKey } from '../../utils/auth.js';
import { clearBetasCaches } from '../../utils/betas.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { getSecureStorage } from '../../utils/secureStorage/index.js';
import { clearToolSchemaCache } from '../../utils/toolSchemaCache.js';
import { resetUserCache } from '../../utils/user.js';
export async function performLogout({
// performLogout：真正执行登出（可选清引导态）
  clearOnboarding = false
}): Promise<void> {
  // Flush telemetry BEFORE clearing credentials to prevent org data leakage
// 先冲刷遥测再清凭据，防止组织数据随令牌一起泄露
  const {
    flushTelemetry
  } = await import('../../utils/telemetry/instrumentation.js');
  await flushTelemetry();
  await removeApiKey();
// 移除本地保存的 API Key

  // Wipe all secure storage data on logout
  const secureStorage = getSecureStorage();
// 删除安全存储中的全部数据
  secureStorage.delete();
  await clearAuthRelatedCaches();
  saveGlobalConfig(current => {
// 改写全局配置：按需重置引导 / 订阅 / 自定义 Key 等
    const updated = {
      ...current
    };
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false;
      updated.subscriptionNoticeCount = 0;
      updated.hasAvailableSubscription = false;
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: []
        };
      }
    }
    updated.oauthAccount = undefined;
    return updated;
  });
}

// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {
// clearAuthRelatedCaches：失效一切随用户 / 会话 / 鉴权变化需刷新的记忆化数据
  // Clear the OAuth token cache
  getClaudeAIOAuthTokens.cache?.clear?.();
// 清 OAuth 令牌缓存与可信设备令牌
  clearTrustedDeviceTokenCache();
  clearBetasCaches();
  clearToolSchemaCache();

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
  resetUserCache();
// 先清用户缓存再刷 GrowthBook，使其拿到新凭据
  refreshGrowthBookAfterAuthChange();

  // Clear Grove config cache
  getGroveNoticeConfig.cache?.clear?.();
  getGroveSettings.cache?.clear?.();

  // Clear remotely managed settings cache
  await clearRemoteManagedSettingsCache();
// 清远端托管设置缓存

  // Clear policy limits cache
  await clearPolicyLimitsCache();
// 清策略上限缓存
}
export async function call(): Promise<React.ReactNode> {
// call：执行登出并在 200ms 后优雅退出进程
  await performLogout({
    clearOnboarding: true
  });
  const message = <Text>Successfully logged out from your Anthropic account.</Text>;
// 构造登出成功提示文本
  setTimeout(() => {
    gracefulShutdownSync(0, 'logout');
  }, 200);
  return message;
// 返回提示并触发定时退出
}
// 原文件此处有一行 7728 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。