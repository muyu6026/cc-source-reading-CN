import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, Text } from '../ink.js';
import { type AutoUpdaterResult, getLatestVersion, getMaxVersion, type InstallStatus, installGlobalPackage, shouldSkipVersion } from '../utils/autoUpdater.js';
import { getGlobalConfig, isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { installOrUpdateClaudePackage, localInstallationExists } from '../utils/localInstaller.js';
import { removeInstalledSymlink } from '../utils/nativeInstaller/index.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
// Props 类型：暴露是否正在更新、成功提示开关、verbose 等控制项。
export function AutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    global?: string | null;
    latest?: string | null;
  }>({});
  const [hasLocalInstall, setHasLocalInstall] = useState(false);
// versions 保存当前与最新版本号（可能为空），hasLocalInstall 标记是否存在本地安装。
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);
  useEffect(() => {
    void localInstallationExists().then(setHasLocalInstall);
  }, []);

  // Track latest isUpdating value in a ref so the memoized checkForUpdates
  // callback always sees the current value. Without this, the 30-minute
  // interval fires with a stale closure where isUpdating is false, allowing
  // a concurrent installGlobalPackage() to run while one is already in
  // progress.
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
// 用 ref 保存最新的 isUpdating，让记忆化的 checkForUpdates 总是读到当前值，
// 避免 30 分钟定时触发时拿到陈旧闭包而并发启动第二次安装。
  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }
    if ("production" === 'test' || "production" === 'development') {
      logForDebugging('AutoUpdater: Skipping update check in test/dev environment');
      return;
    }
    const currentVersion = MACRO.VERSION;
    const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';
    let latestVersion = await getLatestVersion(channel);
    const isDisabled = isAutoUpdaterDisabled();

    // Check if max version is set (server-side kill switch for auto-updates)
    const maxVersion = await getMaxVersion();
    if (maxVersion && latestVersion && gt(latestVersion, maxVersion)) {
      logForDebugging(`AutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latestVersion} to ${maxVersion}`);
      if (gte(currentVersion, maxVersion)) {
        logForDebugging(`AutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`);
        setVersions({
          global: currentVersion,
          latest: latestVersion
        });
        return;
      }
      latestVersion = maxVersion;
    }
    setVersions({
      global: currentVersion,
      latest: latestVersion
    });

    // Check if update needed and perform update
    if (!isDisabled && currentVersion && latestVersion && !gte(currentVersion, latestVersion) && !shouldSkipVersion(latestVersion)) {
      const startTime = Date.now();
      onChangeIsUpdating(true);

      // Remove native installer symlink since we're using JS-based updates
      // But only if user hasn't migrated to native installation
      const config = getGlobalConfig();
      if (config.installMethod !== 'native') {
        await removeInstalledSymlink();
      }

      // Detect actual running installation type
      const installationType = await getCurrentInstallationType();
      logForDebugging(`AutoUpdater: Detected installation type: ${installationType}`);

      // Skip update for development builds
      if (installationType === 'development') {
        logForDebugging('AutoUpdater: Cannot auto-update development build');
        onChangeIsUpdating(false);
        return;
      }

      // Choose the appropriate update method based on what's actually running
      let installStatus: InstallStatus;
      let updateMethod: 'local' | 'global';
      if (installationType === 'npm-local') {
        // Use local update for local installations
        logForDebugging('AutoUpdater: Using local update method');
        updateMethod = 'local';
        installStatus = await installOrUpdateClaudePackage(channel);
      } else if (installationType === 'npm-global') {
        // Use global update for global installations
        logForDebugging('AutoUpdater: Using global update method');
        updateMethod = 'global';
        installStatus = await installGlobalPackage();
      } else if (installationType === 'native') {
        // This shouldn't happen - native should use NativeAutoUpdater
        logForDebugging('AutoUpdater: Unexpected native installation in non-native updater');
        onChangeIsUpdating(false);
        return;
      } else {
        // Fallback to config-based detection for unknown types
        logForDebugging(`AutoUpdater: Unknown installation type, falling back to config`);
        const isMigrated = config.installMethod === 'local';
        updateMethod = isMigrated ? 'local' : 'global';
        if (isMigrated) {
          installStatus = await installOrUpdateClaudePackage(channel);
        } else {
          installStatus = await installGlobalPackage();
        }
      }
      onChangeIsUpdating(false);
      if (installStatus === 'success') {
        logEvent('tengu_auto_updater_success', {
          fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Date.now() - startTime,
          wasMigrated: updateMethod === 'local',
          installationType: installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      } else {
        logEvent('tengu_auto_updater_fail', {
          fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          attemptedVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          status: installStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Date.now() - startTime,
          wasMigrated: updateMethod === 'local',
          installationType: installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
      onAutoUpdaterResult({
        version: latestVersion,
        status: installStatus
      });
    }
    // isUpdating intentionally omitted from deps; we read isUpdatingRef
    // instead so the guard is always current without changing callback
    // identity (which would re-trigger the initial-check useEffect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: isUpdating read via ref
  }, [onAutoUpdaterResult]);
// checkForUpdates 核心：读取版本与通道，处理服务端最大版本封顶（kill switch），
// 按检测到的安装类型选择本地或全局更新方式，并记录成功/失败事件。

  // Initial check
  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000);
// 每 30 分钟检查一次更新。
  if (!autoUpdaterResult?.version && (!versions.global || !versions.latest)) {
    return null;
  }
  if (!autoUpdaterResult?.version && !isUpdating) {
    return null;
  }
  return <Box flexDirection="row" gap={1}>
      {verbose && <Text dimColor wrap="truncate">
          globalVersion: {versions.global} &middot; latestVersion:{' '}
          {versions.latest}
        </Text>}
      {isUpdating ? <>
          <Box>
            <Text color="text" dimColor wrap="truncate">
              Auto-updating…
            </Text>
          </Box>
        </> : autoUpdaterResult?.status === 'success' && showSuccessMessage && updateSemver && <Text color="success" wrap="truncate">
            ✓ Update installed · Restart to apply
          </Text>}
      {(autoUpdaterResult?.status === 'install_failed' || autoUpdaterResult?.status === 'no_permissions') && <Text color="error" wrap="truncate">
          ✗ Auto-update failed &middot; Try <Text bold>claude doctor</Text> or{' '}
          <Text bold>
            {hasLocalInstall ? `cd ~/.claude/local && npm update ${MACRO.PACKAGE_URL}` : `npm i -g ${MACRO.PACKAGE_URL}`}
          </Text>
        </Text>}
    </Box>;
}
// 组件返回状态展示：检测中、安装成功、或失败（提示 claude doctor / npm 命令）。
// 原文件此处有一行 21964 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。