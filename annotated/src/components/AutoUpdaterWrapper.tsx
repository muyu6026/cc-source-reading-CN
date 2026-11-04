import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { AutoUpdater } from './AutoUpdater.js';
import { NativeAutoUpdater } from './NativeAutoUpdater.js';
import { PackageManagerAutoUpdater } from './PackageManagerAutoUpdater.js';
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
// 自动更新器包装：检测安装类型后分派三个更新器之一（包管理器/原生/标准）
export function AutoUpdaterWrapper(t0) {
  const $ = _c(17);
  const {
    isUpdating,
    onChangeIsUpdating,
    onAutoUpdaterResult,
    autoUpdaterResult,
    showSuccessMessage,
    verbose
  } = t0;
  const [useNativeInstaller, setUseNativeInstaller] = React.useState(null);
// 两个状态初始为 null：null 表示「还没检测完」，区别于 false 的「检测完不是」——三态设计
  const [isPackageManager, setIsPackageManager] = React.useState(null);
  let t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      const checkInstallation = async function checkInstallation() {
        if (feature("SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED") && isAutoUpdaterDisabled()) {
// feature flag「SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED」是构建期内联常量 + isAutoUpdaterDisabled 运行时判断组合：用户显式禁用自动更新时跳过检测
          logForDebugging("AutoUpdaterWrapper: Skipping detection, auto-updates disabled");
          return;
        }
        const installationType = await getCurrentInstallationType();
// getCurrentInstallationType 异步检测：native 则 setUseNativeInstaller(true)，package-manager 则 setIsPackageManager(true)，两者都 false 走标准 AutoUpdater
        logForDebugging(`AutoUpdaterWrapper: Installation type: ${installationType}`);
        setUseNativeInstaller(installationType === "native");
        setIsPackageManager(installationType === "package-manager");
      };
      checkInstallation();
    };
    t2 = [];
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  React.useEffect(t1, t2);
  if (useNativeInstaller === null || isPackageManager === null) {
// 检测未完成（任一仍为 null）渲染 null：避免闪现错误的更新器
    return null;
  }
// 包管理器安装优先分派 PackageManagerAutoUpdater
  if (isPackageManager) {
    let t3;
    if ($[2] !== autoUpdaterResult || $[3] !== isUpdating || $[4] !== onAutoUpdaterResult || $[5] !== onChangeIsUpdating || $[6] !== showSuccessMessage || $[7] !== verbose) {
      t3 = <PackageManagerAutoUpdater verbose={verbose} onAutoUpdaterResult={onAutoUpdaterResult} autoUpdaterResult={autoUpdaterResult} isUpdating={isUpdating} onChangeIsUpdating={onChangeIsUpdating} showSuccessMessage={showSuccessMessage} />;
      $[2] = autoUpdaterResult;
      $[3] = isUpdating;
      $[4] = onAutoUpdaterResult;
      $[5] = onChangeIsUpdating;
      $[6] = showSuccessMessage;
      $[7] = verbose;
      $[8] = t3;
    } else {
      t3 = $[8];
    }
    return t3;
  }
  const Updater = useNativeInstaller ? NativeAutoUpdater : AutoUpdater;
// 非包管理器时按 useNativeInstaller 选 Native 或标准更新器——变量命名 Updater 首字母大写以便作为 JSX 组件使用
  let t3;
  if ($[9] !== Updater || $[10] !== autoUpdaterResult || $[11] !== isUpdating || $[12] !== onAutoUpdaterResult || $[13] !== onChangeIsUpdating || $[14] !== showSuccessMessage || $[15] !== verbose) {
    t3 = <Updater verbose={verbose} onAutoUpdaterResult={onAutoUpdaterResult} autoUpdaterResult={autoUpdaterResult} isUpdating={isUpdating} onChangeIsUpdating={onChangeIsUpdating} showSuccessMessage={showSuccessMessage} />;
// 三个更新器共享同一组 props：更新状态回调接口统一，包装层只负责选型
    $[9] = Updater;
    $[10] = autoUpdaterResult;
    $[11] = isUpdating;
    $[12] = onAutoUpdaterResult;
    $[13] = onChangeIsUpdating;
    $[14] = showSuccessMessage;
    $[15] = verbose;
    $[16] = t3;
  } else {
    t3 = $[16];
  }
  return t3;
}
// 原文件此处有一行 8420 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。