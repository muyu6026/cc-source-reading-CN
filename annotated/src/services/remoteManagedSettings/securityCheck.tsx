import React from 'react';
import { getIsInteractive } from '../../bootstrap/state.js';
import { ManagedSettingsSecurityDialog } from '../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';
import { extractDangerousSettings, hasDangerousSettings, hasDangerousSettingsChanged } from '../../components/ManagedSettingsSecurityDialog/utils.js';
import { render } from '../../ink.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../../state/AppState.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { getBaseRenderOptions } from '../../utils/renderOptions.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { logEvent } from '../analytics/index.js';
export type SecurityCheckResult = 'approved' | 'rejected' | 'no_check_needed';
// 三值结果类型：approved（用户批准）/ rejected（用户拒绝）/ no_check_needed（无需检查）。
// 第三种不是失败态——大多数拉取根本走不到对话框（没有危险设置、或危险设置没变）。

/**
 * Check if new remote managed settings contain dangerous settings that require user approval.
 * Shows a blocking dialog if dangerous settings have changed or been added.
 *
 * @param cachedSettings The current cached settings (may be null for first run)
 * @param newSettings The new settings fetched from the API
 * @returns 'approved' if user accepts, 'rejected' if user declines, 'no_check_needed' if no dangerous changes
 */
// checkManagedSettingsSecurity 是「远程设置应用到本地前」的最后一道人工闸门。
// 它只回答一个问题：这批新设置里有没有**新出现或新变化**的危险项（权限、env 一类）需要用户点头。
// 注意它不阻止「不危险的设置」自动生效——只有危险变更才弹窗。
export async function checkManagedSettingsSecurity(cachedSettings: SettingsJson | null, newSettings: SettingsJson | null): Promise<SecurityCheckResult> {
  // If new settings don't have dangerous settings, no check needed
  if (!newSettings || !hasDangerousSettings(extractDangerousSettings(newSettings))) {
    return 'no_check_needed';
  }

  // If dangerous settings haven't changed, no check needed
  if (!hasDangerousSettingsChanged(cachedSettings, newSettings)) {
    return 'no_check_needed';
  }
// 三道短路，任何一道命中就不弹窗：
// 1) 新设置里没有危险项；
// 2) 有危险项但和缓存里的完全一样（没变）——每次启动都重弹同一个对话框是骚扰；
// 3) 非交互模式（-p、管道、CI）——没人能点按钮，弹也白弹（与 trust dialog 行为保持一致）。

  // Skip dialog in non-interactive mode (consistent with trust dialog behavior)
  if (!getIsInteractive()) {
    return 'no_check_needed';
  }

  // Log that dialog is being shown
  logEvent('tengu_managed_settings_security_dialog_shown', {});
// 弹窗前发遥测 tengu_managed_settings_security_dialog_shown。接受/拒绝各自也有事件（见下）——
// 三个事件凑一起才能算「弹了 N 次、用户接受了多少」的转化率。

  // Show blocking dialog
  return new Promise<SecurityCheckResult>(resolve => {
    void (async () => {
      const {
        unmount
      } = await render(<AppStateProvider>
          <KeybindingSetup>
            <ManagedSettingsSecurityDialog settings={newSettings} onAccept={() => {
            logEvent('tengu_managed_settings_security_dialog_accepted', {});
            unmount();
            void resolve('approved');
          }} onReject={() => {
            logEvent('tengu_managed_settings_security_dialog_rejected', {});
            unmount();
            void resolve('rejected');
          }} />
          </KeybindingSetup>
        </AppStateProvider>, getBaseRenderOptions(false));
    })();
  });
}
// 阻塞对话框用 render() 同步起一棵临时 Ink 树：AppStateProvider（读当前状态）→
// KeybindingSetup（对话框要响应按键）→ ManagedSettingsSecurityDialog。
// 两层 render 嵌套是因为要等 render 返回 unmount 才能在 onAccept/onReject 里拆树——
// 所以外层包了个 async IIFE，resolve 走 void（fire-and-forget）。
// getBaseRenderOptions(false) 传入表示不全屏。

/**
 * Handle the security check result by exiting if rejected
 * Returns true if we should continue, false if we should stop
 */
export function handleSecurityCheckResult(result: SecurityCheckResult): boolean {
  if (result === 'rejected') {
    gracefulShutdownSync(1);
    return false;
  }
  return true;
}
// handleSecurityCheckResult 是 index.ts 里那个 if (!handle...) 的判断：
// 用户拒绝 → gracefulShutdownSync(1) 直接退出进程（远程推送了危险设置且用户不认，
// 继续跑等于违反用户意愿），返回 false 让调用方也别 apply。
// approved 和 no_check_needed 都返回 true 放行。
// （文件末尾的 sourcemap 注释是编译产物，本项目有意省略不批注。）
// 原文件此处有一行 7412 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。