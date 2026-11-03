import { c as _c } from "react/compiler-runtime";
// 导入 React 编译期缓存运行时
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { getDynamicConfig_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { Select } from '../CustomSelect/select.js';
import { DesktopHandoff } from '../DesktopHandoff.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type DesktopUpsellConfig = {
// 桌面端推广配置：是否显示快捷键提示与启动弹窗
  enable_shortcut_tip: boolean;
  enable_startup_dialog: boolean;
};
const DESKTOP_UPSELL_DEFAULT: DesktopUpsellConfig = {
// 推广配置默认值均为关闭
  enable_shortcut_tip: false,
  enable_startup_dialog: false
};
export function getDesktopUpsellConfig(): DesktopUpsellConfig {
// 读取动态配置决定是否启用推广
  return getDynamicConfig_CACHED_MAY_BE_STALE('tengu_desktop_upsell', DESKTOP_UPSELL_DEFAULT);
}
function isSupportedPlatform(): boolean {
// 仅支持 macOS 与 x64 Windows
  return process.platform === 'darwin' || process.platform === 'win32' && process.arch === 'x64';
}
export function shouldShowDesktopUpsellStartup(): boolean {
// 综合平台、配置、已 dismissal 与展示次数决定是否弹窗
  if (!isSupportedPlatform()) return false;
  if (!getDesktopUpsellConfig().enable_startup_dialog) return false;
  const config = getGlobalConfig();
  if (config.desktopUpsellDismissed) return false;
  if ((config.desktopUpsellSeenCount ?? 0) >= 3) return false;
  return true;
}
type DesktopUpsellSelection = 'try' | 'not-now' | 'never';
// 用户选择：试用 / 暂不开 / 不再询问
type Props = {
  onDone: () => void;
};
export function DesktopUpsellStartup(t0) {
// 桌面端推广启动弹窗组件
  const $ = _c(14);
  const {
    onDone
  } = t0;
  const [showHandoff, setShowHandoff] = useState(false);
// 是否展示桌面交接（handoff）界面
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useEffect(_temp, t1);
// 挂载时记录本次展示次数并上报事件
  if (showHandoff) {
// 选择试用后切换到 DesktopHandoff
    let t2;
    if ($[1] !== onDone) {
      t2 = <DesktopHandoff onDone={() => onDone()} />;
      $[1] = onDone;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    return t2;
  }
  let t2;
  if ($[3] !== onDone) {
    t2 = function handleSelect(value) {
// 根据选择执行试用、永久关闭或暂不开
      switch (value) {
        case "try":
          {
            setShowHandoff(true);
            return;
          }
        case "never":
          {
            saveGlobalConfig(_temp2);
            onDone();
            return;
          }
        case "not-now":
          {
            onDone();
            return;
          }
      }
    };
    $[3] = onDone;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelect = t2;
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
// 试用选项文案
      label: "Open in Claude Code Desktop",
      value: "try" as const
    };
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      label: "Not now",
      value: "not-now" as const
    };
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = [t3, t4, {
      label: "Don't ask again",
      value: "never" as const
    }];
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const options = t5;
  let t6;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box marginBottom={1}><Text>Same Claude Code with visual diffs, live app preview, parallel sessions, and more.</Text></Box>;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== handleSelect) {
    t7 = () => handleSelect("not-now");
    $[9] = handleSelect;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== handleSelect || $[12] !== t7) {
    t8 = <PermissionDialog title="Try Claude Code Desktop"><Box flexDirection="column" paddingX={2} paddingY={1}>{t6}<Select options={options} onChange={handleSelect} onCancel={t7} /></Box></PermissionDialog>;
// 用 PermissionDialog 承载推广内容与选项
    $[11] = handleSelect;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
function _temp2(prev_0) {
  if (prev_0.desktopUpsellDismissed) {
    return prev_0;
  }
  return {
    ...prev_0,
    desktopUpsellDismissed: true
  };
}
function _temp() {
  const newCount = (getGlobalConfig().desktopUpsellSeenCount ?? 0) + 1;
  saveGlobalConfig(prev => {
    if ((prev.desktopUpsellSeenCount ?? 0) >= newCount) {
      return prev;
    }
    return {
      ...prev,
      desktopUpsellSeenCount: newCount
    };
  });
  logEvent("tengu_desktop_upsell_shown", {
    seen_count: newCount
  });
}
// 原文件此处有一行 11056 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。