import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { logForDebugging } from 'src/utils/debug.js';
import { logError } from 'src/utils/log.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, Text } from '../ink.js';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { getMaxVersion, getMaxVersionMessage } from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { installLatest } from '../utils/nativeInstaller/index.js';
import { gt } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';

/**
 * Categorize error messages for analytics
 */
function getErrorType(errorMessage: string): string {
  if (errorMessage.includes('timeout')) {
    return 'timeout';
  }
  if (errorMessage.includes('Checksum mismatch')) {
    return 'checksum_mismatch';
  }
  if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
    return 'not_found';
  }
  if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
    return 'permission_denied';
  }
  if (errorMessage.includes('ENOSPC')) {
    return 'disk_full';
  }
  if (errorMessage.includes('npm')) {
    return 'npm_error';
  }
  if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
    return 'network_error';
  }
  return 'unknown';
}
// getErrorType 按错误信息关键字把更新失败归类（超时、校验和、权限、磁盘、网络等），方便埋点区分。
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
// Props 类型与 AutoUpdater 一致：暴露更新状态、结果、成功提示与 verbose 开关。
export function NativeAutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    current?: string | null;
    latest?: string | null;
  }>({});
  const [maxVersionIssue, setMaxVersionIssue] = useState<string | null>(null);
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);
  const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';

  // Track latest isUpdating value in a ref so the memoized checkForUpdates
  // callback always sees the current value without changing callback identity
  // (which would re-trigger the initial-check useEffect below and cause
  // repeated downloads on remount — the upstream trigger for #22413).
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }
    if ("production" === 'test' || "production" === 'development') {
      logForDebugging('NativeAutoUpdater: Skipping update check in test/dev environment');
      return;
    }
    if (isAutoUpdaterDisabled()) {
      return;
    }
    onChangeIsUpdating(true);
    const startTime = Date.now();

    // Log the start of an auto-update check for funnel analysis
    logEvent('tengu_native_auto_updater_start', {});
    try {
      // Check if current version is above the max allowed version
      const maxVersion = await getMaxVersion();
      if (maxVersion && gt(MACRO.VERSION, maxVersion)) {
        const msg = await getMaxVersionMessage();
        setMaxVersionIssue(msg ?? 'affects your version');
// 若当前版本已超过服务端最大允许版本，记录提示信息（maxVersionIssue）并展示警告横幅。
      }
      const result = await installLatest(channel);
      const currentVersion = MACRO.VERSION;
      const latencyMs = Date.now() - startTime;

      // Handle lock contention gracefully - just return without treating as error
      if (result.lockFailed) {
        logEvent('tengu_native_auto_updater_lock_contention', {
          latency_ms: latencyMs
        });
        return; // Silently skip this update check, will try again later
      }

      // Update versions for display
      setVersions({
        current: currentVersion,
        latest: result.latestVersion
      });
      if (result.wasUpdated) {
        logEvent('tengu_native_auto_updater_success', {
          latency_ms: latencyMs
        });
        onAutoUpdaterResult({
          version: result.latestVersion,
          status: 'success'
        });
      } else {
        // Already up to date
        logEvent('tengu_native_auto_updater_up_to_date', {
          latency_ms: latencyMs
        });
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(error);
      const errorType = getErrorType(errorMessage);
      logEvent('tengu_native_auto_updater_fail', {
        latency_ms: latencyMs,
        error_timeout: errorType === 'timeout',
        error_checksum: errorType === 'checksum_mismatch',
        error_not_found: errorType === 'not_found',
        error_permission: errorType === 'permission_denied',
        error_disk_full: errorType === 'disk_full',
        error_npm: errorType === 'npm_error',
        error_network: errorType === 'network_error'
      });
      onAutoUpdaterResult({
        version: null,
        status: 'install_failed'
      });
    } finally {
      onChangeIsUpdating(false);
    }
    // isUpdating intentionally omitted from deps; we read isUpdatingRef
    // instead so the guard is always current without changing callback
    // identity (which would re-trigger the initial-check useEffect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: isUpdating read via ref
  }, [onAutoUpdaterResult, channel]);
// checkForUpdates 调用原生安装器 installLatest 完成更新：
// 处理锁竞争（lockFailed 静默跳过）、记录成功/最新/失败事件，finally 中复位 isUpdating。

  // Initial check
  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000);
// 每 30 分钟检查一次更新。
  const hasUpdateResult = !!autoUpdaterResult?.version;
  const hasVersionInfo = !!versions.current && !!versions.latest;
  // Show the component when:
  // - warning banner needed (above max version), or
  // - there's an update result to display (success/error), or
  // - actively checking and we have version info to show
  const shouldRender = !!maxVersionIssue || hasUpdateResult || isUpdating && hasVersionInfo;
  if (!shouldRender) {
    return null;
  }
  return <Box flexDirection="row" gap={1}>
      {verbose && <Text dimColor wrap="truncate">
          current: {versions.current} &middot; {channel}: {versions.latest}
        </Text>}
      {isUpdating ? <Box>
          <Text dimColor wrap="truncate">
            Checking for updates
          </Text>
        </Box> : autoUpdaterResult?.status === 'success' && showSuccessMessage && updateSemver && <Text color="success" wrap="truncate">
            ✓ Update installed · Restart to update
          </Text>}
      {autoUpdaterResult?.status === 'install_failed' && <Text color="error" wrap="truncate">
          ✗ Auto-update failed &middot; Try <Text bold>/status</Text>
        </Text>}
      {maxVersionIssue && "external" === 'ant' && <Text color="warning">
          ⚠ Known issue: {maxVersionIssue} &middot; Run{' '}
          <Text bold>claude rollback --safe</Text> to downgrade
        </Text>}
    </Box>;
}
// 组件返回状态展示：检测中、安装成功、失败提示，以及超过最大版本时的回滚提醒。
// 原文件此处有一行 19156 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。