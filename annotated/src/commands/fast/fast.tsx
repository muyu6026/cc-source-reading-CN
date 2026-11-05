// /fast 命令：快速模式（高速低延迟）开关与选择器 UI。开启后切换到高速模型并以溢价计费，受组织级开关与速率限制约束。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { FastIcon, getFastIconString } from '../../components/FastIcon.js';
import { Box, Link, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { type AppState, useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { clearFastModeCooldown, FAST_MODE_MODEL_DISPLAY, getFastModeModel, getFastModeRuntimeState, getFastModeUnavailableReason, isFastModeEnabled, isFastModeSupportedByModel, prefetchFastModeStatus } from '../../utils/fastMode.js';
import { formatDuration } from '../../utils/format.js';
import { formatModelPricing, getOpus46CostTier } from '../../utils/modelCost.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
function applyFastMode(enable: boolean, setAppState: (f: (prev: AppState) => AppState) => void): void {
  clearFastModeCooldown();
  updateSettingsForSource('userSettings', {
    fastMode: enable ? true : undefined
  });
  if (enable) {
    setAppState(prev => {
      // Only switch model if current model doesn't support fast mode
      const needsModelSwitch = !isFastModeSupportedByModel(prev.mainLoopModel);
      return {
        ...prev,
        ...(needsModelSwitch ? {
          mainLoopModel: getFastModeModel(),
          mainLoopModelForSession: null
        } : {}),
        fastMode: true
      };
    });
  } else {
    setAppState(prev => ({
      ...prev,
      fastMode: false
    }));
  }
}
// applyFastMode：实际切换逻辑。先清冷却，再写 userSettings.fastMode；开启时若当前模型不支持快速模式才切到快速模型，避免无故改模型。
export function FastModePicker(t0) {
  const $ = _c(30);
  const {
    onDone,
    unavailableReason
  } = t0;
  const model = useAppState(_temp);
  const initialFastMode = useAppState(_temp2);
  const setAppState = useSetAppState();
  const [enableFastMode, setEnableFastMode] = useState(initialFastMode ?? false);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getFastModeRuntimeState();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const runtimeState = t1;
// runtimeState：从快速模式运行时状态读取（cooldown / overloaded / 限流重置时刻等）。
  const isCooldown = runtimeState.status === "cooldown";
  const isUnavailable = unavailableReason !== null;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = formatModelPricing(getOpus46CostTier(true));
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const pricing = t2;
// pricing：预格式化 Opus 4.6 的计价展示串，用于 UI 提示。
  let t3;
  if ($[2] !== enableFastMode || $[3] !== isUnavailable || $[4] !== model || $[5] !== onDone || $[6] !== setAppState) {
    t3 = function handleConfirm() {
      if (isUnavailable) {
        return;
      }
      applyFastMode(enableFastMode, setAppState);
      logEvent("tengu_fast_mode_toggled", {
        enabled: enableFastMode,
        source: "picker" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (enableFastMode) {
        const fastIcon = getFastIconString(enableFastMode);
        const modelUpdated = !isFastModeSupportedByModel(model) ? ` · model set to ${FAST_MODE_MODEL_DISPLAY}` : "";
        onDone(`${fastIcon} Fast mode ON${modelUpdated} · ${pricing}`);
      } else {
        setAppState(_temp3);
        onDone("Fast mode OFF");
      }
    };
    $[2] = enableFastMode;
    $[3] = isUnavailable;
    $[4] = model;
    $[5] = onDone;
    $[6] = setAppState;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const handleConfirm = t3;
// handleConfirm：确认开启/关闭并记 tengu_fast_mode_toggled 事件；开启时拼出图标与模型更新提示。
  let t4;
  if ($[8] !== initialFastMode || $[9] !== isUnavailable || $[10] !== onDone || $[11] !== setAppState) {
    t4 = function handleCancel() {
      if (isUnavailable) {
        if (initialFastMode) {
          applyFastMode(false, setAppState);
        }
        onDone("Fast mode OFF", {
          display: "system"
        });
        return;
      }
      const message = initialFastMode ? `${getFastIconString()} Kept Fast mode ON` : "Kept Fast mode OFF";
      onDone(message, {
        display: "system"
      });
    };
    $[8] = initialFastMode;
    $[9] = isUnavailable;
    $[10] = onDone;
    $[11] = setAppState;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  const handleCancel = t4;
// handleCancel：取消处理；若原本开着且当前不可用则回退关掉，否则保持原状。
  let t5;
  if ($[13] !== isUnavailable) {
    t5 = function handleToggle() {
      if (isUnavailable) {
        return;
      }
      setEnableFastMode(_temp4);
    };
    $[13] = isUnavailable;
    $[14] = t5;
  } else {
    t5 = $[14];
  }
  const handleToggle = t5;
// handleToggle：切换开关的辅助函数。
  let t6;
  if ($[15] !== handleConfirm || $[16] !== handleToggle) {
    t6 = {
      "confirm:yes": handleConfirm,
      "confirm:nextField": handleToggle,
      "confirm:next": handleToggle,
      "confirm:previous": handleToggle,
      "confirm:cycleMode": handleToggle,
      "confirm:toggle": handleToggle
    };
    $[15] = handleConfirm;
    $[16] = handleToggle;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  let t7;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      context: "Confirmation"
    };
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  useKeybindings(t6, t7);
// useKeybindings：把 confirm 系列键位映射到 handleConfirm / handleToggle（确认、下一字段、循环、切换等）。
  let t8;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text><FastIcon cooldown={isCooldown} /> Fast mode (research preview)</Text>;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  const title = t8;
// title：标题栏文案（带冷却图标的快速模式提示）。
  let t9;
  if ($[20] !== isUnavailable) {
    t9 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : isUnavailable ? <Text>Esc to cancel</Text> : <Text>Tab to toggle · Enter to confirm · Esc to cancel</Text>;
    $[20] = isUnavailable;
    $[21] = t9;
  } else {
    t9 = $[21];
  }
  let t10;
// 主显示区 t10：根据是否不可用展示错误，否则展示开关状态与计价；冷却态额外展示限流原因与重置倒计时。
  if ($[22] !== enableFastMode || $[23] !== unavailableReason) {
    t10 = unavailableReason ? <Box marginLeft={2}><Text color="error">{unavailableReason}</Text></Box> : <><Box flexDirection="column" gap={0} marginLeft={2}><Box flexDirection="row" gap={2}><Text bold={true}>Fast mode</Text><Text color={enableFastMode ? "fastMode" : undefined} bold={enableFastMode}>{enableFastMode ? "ON " : "OFF"}</Text><Text dimColor={true}>{pricing}</Text></Box></Box>{isCooldown && runtimeState.status === "cooldown" && <Box marginLeft={2}><Text color="warning">{runtimeState.reason === "overloaded" ? "Fast mode overloaded and is temporarily unavailable" : "You've hit your fast limit"}{" \xB7 resets in "}{formatDuration(runtimeState.resetAt - Date.now(), {
            hideTrailingZeros: true
          })}</Text></Box>}</>;
    $[22] = enableFastMode;
    $[23] = unavailableReason;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  let t11;
  if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text dimColor={true}>Learn more:{" "}<Link url="https://code.claude.com/docs/en/fast-mode">https://code.claude.com/docs/en/fast-mode</Link></Text>;
    $[25] = t11;
  } else {
    t11 = $[25];
  }
// learn more 链接：指向官方快速模式文档。
  let t12;
  if ($[26] !== handleCancel || $[27] !== t10 || $[28] !== t9) {
    t12 = <Dialog title={title} subtitle={`High-speed mode for ${FAST_MODE_MODEL_DISPLAY}. Billed as extra usage at a premium rate. Separate rate limits apply.`} onCancel={handleCancel} color="fastMode" inputGuide={t9}>{t10}{t11}</Dialog>;
    $[26] = handleCancel;
    $[27] = t10;
    $[28] = t9;
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  return t12;
}
// FastModePicker 组件收尾：把标题、副标题、取消回调与内容组装进 Dialog 返回。
function _temp4(prev_0) {
  return !prev_0;
}
function _temp3(prev) {
  return {
    ...prev,
    fastMode: false
  };
}
function _temp2(s_0) {
  return s_0.fastMode;
}
function _temp(s) {
  return s.mainLoopModel;
}
async function handleFastModeShortcut(enable: boolean, getAppState: () => AppState, setAppState: (f: (prev: AppState) => AppState) => void): Promise<string> {
  const unavailableReason = getFastModeUnavailableReason();
  if (unavailableReason) {
    return `Fast mode unavailable: ${unavailableReason}`;
  }
  const {
    mainLoopModel
  } = getAppState();
  applyFastMode(enable, setAppState);
  logEvent('tengu_fast_mode_toggled', {
    enabled: enable,
    source: 'shortcut' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  if (enable) {
    const fastIcon = getFastIconString(true);
    const modelUpdated = !isFastModeSupportedByModel(mainLoopModel) ? ` · model set to ${FAST_MODE_MODEL_DISPLAY}` : '';
    const pricing = formatModelPricing(getOpus46CostTier(true));
    return `${fastIcon} Fast mode ON${modelUpdated} · ${pricing}`;
  } else {
    return `Fast mode OFF`;
  }
}
// handleFastModeShortcut：快捷键直接开关的底层实现，返回结果串；不可用时直接报错，成功时拼出图标与模型/计价信息。
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode | null> {
  if (!isFastModeEnabled()) {
    return null;
  }

  // Fetch org fast mode status before showing the picker. We must know
  // whether the org has disabled fast mode before allowing any toggle.
  // If a startup prefetch is already in flight, this awaits it.
  await prefetchFastModeStatus();
// call 入口：先拉取组织级快速模式状态（若启动期预取在飞则等待），再按 on/off 走快捷键或渲染选择器；功能未启用时返回 null。
  const arg = args?.trim().toLowerCase();
  if (arg === 'on' || arg === 'off') {
    const result = await handleFastModeShortcut(arg === 'on', context.getAppState, context.setAppState);
    onDone(result);
    return null;
  }
  const unavailableReason = getFastModeUnavailableReason();
  logEvent('tengu_fast_mode_picker_shown', {
    unavailable_reason: (unavailableReason ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  return <FastModePicker onDone={onDone} unavailableReason={unavailableReason} />;
}
// call 收尾。
// 原文件此处有一行 24356 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。