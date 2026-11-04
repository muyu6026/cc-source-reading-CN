import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { Text } from '../ink.js';
import { type AutoUpdaterResult, getLatestVersionFromGcs, getMaxVersion, shouldSkipVersion } from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getPackageManager, type PackageManager } from '../utils/nativeInstaller/packageManagers.js';
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
// PackageManagerAutoUpdater：走系统包管理器（brew、winget、apk）安装时的更新检查器。它只提示不自动升级——升级命令交给用户执行。Props 里的 isUpdating 等回调解耦自更早版本，本实现未用到，接口比实现宽。
export function PackageManagerAutoUpdater(t0) {
  const $ = _c(10);
  const {
    verbose
  } = t0;
// 两个状态：updateAvailable 控制是否渲染提示，packageManager 决定给出哪家的升级命令。
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [packageManager, setPackageManager] = useState("unknown");
  let t1;
// checkForUpdates 进哨兵槽（整个生命周期同一引用，供 useInterval 稳定轮询）：禁用即返回；渠道与包管理器并行获取；再查 GCS 上的最新版本。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = async () => {
// false 或 false 恒为假的死代码——编译器内联 feature flag 的残迹，原来源代码里是某个发布渠道的条件判断。
      false || false;
      if (isAutoUpdaterDisabled()) {
        return;
      }
      const [channel, pm] = await Promise.all([Promise.resolve(getInitialSettings()?.autoUpdatesChannel ?? "latest"), getPackageManager()]);
      setPackageManager(pm);
      let latest = await getLatestVersionFromGcs(channel);
      const maxVersion = await getMaxVersion();
// maxVersion 封顶逻辑：配置了版本上限且最新版超过上限时，把目标压到上限；若当前版本已达上限则直接跳过——企业环境用 maxVersion 锁版本，自动更新不得越界。
      if (maxVersion && latest && gt(latest, maxVersion)) {
        logForDebugging(`PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`);
        if (gte(MACRO.VERSION, maxVersion)) {
          logForDebugging(`PackageManagerAutoUpdater: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`);
          setUpdateAvailable(false);
          return;
        }
        latest = maxVersion;
      }
// hasUpdate 三条件：有最新版、当前版本严格小于它、且不在跳过名单（shouldSkipVersion 屏蔽已知有问题的版本）。
      const hasUpdate = latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest);
      setUpdateAvailable(!!hasUpdate);
      if (hasUpdate) {
        logForDebugging(`PackageManagerAutoUpdater: Update available ${MACRO.VERSION} -> ${latest}`);
      }
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const checkForUpdates = t1;
  let t2;
  let t3;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      checkForUpdates();
    };
    t3 = [checkForUpdates];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
// useEffect 首次检查加 useInterval 每 30 分钟轮询——检查是轻量的版本号比对，30 分钟一次对用户无感。
  React.useEffect(t2, t3);
  useInterval(checkForUpdates, 1800000);
  if (!updateAvailable) {
    return null;
  }
// 升级命令按包管理器三分支：homebrew、winget、apk 各自的确切命令，未知管理器给通用文案兜底——宁可说「用你的包管理器更新」也不给错误命令。
  const updateCommand = packageManager === "homebrew" ? "brew upgrade claude-code" : packageManager === "winget" ? "winget upgrade Anthropic.ClaudeCode" : packageManager === "apk" ? "apk upgrade claude-code" : "your package manager update command";
  let t4;
  if ($[3] !== verbose) {
    t4 = verbose && <Text dimColor={true} wrap="truncate">currentVersion: {MACRO.VERSION}</Text>;
    $[3] = verbose;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] !== updateCommand) {
// 提示行 warning 色加 truncate 换行裁剪——长命令在窄终端下截断而不换行，避免撑乱布局。
    t5 = <Text color="warning" wrap="truncate">Update available! Run: <Text bold={true}>{updateCommand}</Text></Text>;
    $[5] = updateCommand;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== t4 || $[8] !== t5) {
    t6 = <>{t4}{t5}</>;
    $[7] = t4;
    $[8] = t5;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  return t6;
}
// 原文件此处有一行 10284 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。