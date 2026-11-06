// /login 命令的 React 组件与各类刷新依赖。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { resetCostState } from '../../bootstrap/state.js';
import { clearTrustedDeviceToken, enrollTrustedDevice } from '../../bridge/trustedDevice.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { Text } from '../../ink.js';
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js';
import { refreshPolicyLimits } from '../../services/policyLimits/index.js';
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { stripSignatureBlocks } from '../../utils/messages.js';
import { checkAndDisableAutoModeIfNeeded, checkAndDisableBypassPermissionsIfNeeded, resetAutoModeGateCheck, resetBypassPermissionsCheck } from '../../utils/permissions/bypassPermissionsKillswitch.js';
import { resetUserCache } from '../../utils/user.js';
// call：/login 入口，渲染登录弹窗并在成功后刷新状态。
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <Login onDone={async success => {
    context.onChangeAPIKey();
    // Signature-bearing blocks (thinking, connector_text) are bound to the API key —
    // strip them so the new key doesn't reject stale signatures.
    context.setMessages(stripSignatureBlocks);
// 换 key 后剥离旧签名块，避免新 key 拒收过期签名。
    if (success) {
      // Post-login refresh logic. Keep in sync with onboarding in src/interactiveHelpers.tsx
      // Reset cost state when switching accounts
      resetCostState();
// 登录成功后重置费用统计状态。
      // Refresh remotely managed settings after login (non-blocking)
      void refreshRemoteManagedSettings();
// 非阻塞刷新远端托管设置。
      // Refresh policy limits after login (non-blocking)
      void refreshPolicyLimits();
      // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
      resetUserCache();
// 先清用户缓存再刷 GrowthBook，让凭据及时生效。
      // Refresh GrowthBook after login to get updated feature flags (e.g., for claude.ai MCPs)
      refreshGrowthBookAfterAuthChange();
      // Clear any stale trusted device token from a previous account before
      // re-enrolling — prevents sending the old token on bridge calls while
      // the async enrollTrustedDevice() is in-flight.
      clearTrustedDeviceToken();
// 清除上一账号遗留的可信设备令牌再重新注册。
      // Enroll as a trusted device for Remote Control (10-min fresh-session window)
      void enrollTrustedDevice();
      // Reset killswitch gate checks and re-run with new org
// 重置权限绕过熔断闸门并按新组织重算。
      resetBypassPermissionsCheck();
      const appState = context.getAppState();
      void checkAndDisableBypassPermissionsIfNeeded(appState.toolPermissionContext, context.setAppState);
      if (feature('TRANSCRIPT_CLASSIFIER')) {
        resetAutoModeGateCheck();
        void checkAndDisableAutoModeIfNeeded(appState.toolPermissionContext, context.setAppState, appState.fastMode);
      }
      // Increment authVersion to trigger re-fetching of auth-dependent data in hooks (e.g., MCP servers)
      context.setAppState(prev => ({
// 递增 authVersion 触发依赖鉴权的数据（如 MCP）重新拉取。
        ...prev,
        authVersion: prev.authVersion + 1
      }));
    }
    onDone(success ? 'Login successful' : 'Login interrupted');
  }} />;
}
// Login：登录对话框组件，封装 OAuth 与确认流程。
export function Login(props) {
  const $ = _c(12);
  const mainLoopModel = useMainLoopModel();
  let t0;
  if ($[0] !== mainLoopModel || $[1] !== props) {
    t0 = () => props.onDone(false, mainLoopModel);
    $[0] = mainLoopModel;
    $[1] = props;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  let t1;
  if ($[3] !== mainLoopModel || $[4] !== props) {
    t1 = () => props.onDone(true, mainLoopModel);
    $[3] = mainLoopModel;
    $[4] = props;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  let t2;
  if ($[6] !== props.startingMessage || $[7] !== t1) {
    t2 = <ConsoleOAuthFlow onDone={t1} startingMessage={props.startingMessage} />;
    $[6] = props.startingMessage;
    $[7] = t1;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  let t3;
  if ($[9] !== t0 || $[10] !== t2) {
    t3 = <Dialog title="Login" onCancel={t0} color="permission" inputGuide={_temp}>{t2}</Dialog>;
    $[9] = t0;
    $[10] = t2;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  return t3;
}
// _temp：退出确认快捷键的提示文案。
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />;
}
// 原文件此处有一行 11440 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。