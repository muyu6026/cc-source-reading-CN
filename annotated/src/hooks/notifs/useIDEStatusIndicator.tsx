import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useRef } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import type { MCPServerConnection } from 'src/services/mcp/types.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';
import { detectIDEs, type IDEExtensionInstallationStatus, isJetBrainsIde, isSupportedTerminal } from 'src/utils/ide.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useIdeConnectionStatus } from '../useIdeConnectionStatus.js';
import type { IDESelection } from '../useIdeSelection.js';
// 提示最多出现 5 次：hasShownHintRef 管本次会话，全局 config 的
// ideHintShownCount 管跨会话，双保险避免每次启动都弹。
const MAX_IDE_HINT_SHOW_COUNT = 5;
type Props = {
  ideInstallationStatus: IDEExtensionInstallationStatus | null;
  ideSelection: IDESelection | undefined;
  mcpClients: MCPServerConnection[];
};
export function useIDEStatusIndicator(t0) {
// IDE 状态指示器。四个 useEffect 各管一条通知，靠前置布尔量
// （shouldShowIdeSelection / shouldShowConnected / showIDEInstallError /
// showJetBrainsInfo）做互斥分流，每个 effect 内都是「条件不满足就
// removeNotification」的清理模式，不满足时自动撤通知。
  const $ = _c(26);
  const {
    ideSelection,
    mcpClients,
    ideInstallationStatus
  } = t0;
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  const {
    status: ideStatus,
    ideName
  } = useIdeConnectionStatus(mcpClients);
  const hasShownHintRef = useRef(false);
  let t1;
  if ($[0] !== ideInstallationStatus) {
    t1 = ideInstallationStatus ? isJetBrainsIde(ideInstallationStatus?.ideType) : false;
    $[0] = ideInstallationStatus;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const isJetBrains = t1;
// JetBrains 系 IDE 单独一路：它们的连接状态不能靠 MCP 客户端判断，
// 走 ideInstallationStatus.ideType 识别，文案也不同。
  const showIDEInstallErrorOrJetBrainsInfo = ideInstallationStatus?.error || isJetBrains;
// 有选中文件或有选中文本行时才显示「当前选区」，
// 否则退化为单纯的「已连接」状态。
  const shouldShowIdeSelection = ideStatus === "connected" && (ideSelection?.filePath || ideSelection?.text && ideSelection.lineCount > 0);
  const shouldShowConnected = ideStatus === "connected" && !shouldShowIdeSelection;
  const showIDEInstallError = showIDEInstallErrorOrJetBrainsInfo && !isJetBrains && !shouldShowConnected && !shouldShowIdeSelection;
  const showJetBrainsInfo = showIDEInstallErrorOrJetBrainsInfo && isJetBrains && !shouldShowConnected && !shouldShowIdeSelection;
  let t2;
  let t3;
  if ($[2] !== addNotification || $[3] !== ideStatus || $[4] !== removeNotification || $[5] !== showJetBrainsInfo) {
    t2 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (isSupportedTerminal() || ideStatus !== null || showJetBrainsInfo) {
        removeNotification("ide-status-hint");
        return;
      }
// 双重去重：会话内 ref 防同一挂载周期重复弹，
// 全局计数防跨会话每天启动都骚扰。
      if (hasShownHintRef.current || (getGlobalConfig().ideHintShownCount ?? 0) >= MAX_IDE_HINT_SHOW_COUNT) {
        return;
      }
// setTimeout 用参数透传而非闭包捕获——闭包会引用当轮渲染的
// addNotification/hasShownHintRef，3 秒后闭包里的引用可能过期；
// 传参写法拿到的始终是最初那份，与 effect 清理 clearTimeout 配对。
      const timeoutId = setTimeout(_temp2, 3000, hasShownHintRef, addNotification);
      return () => clearTimeout(timeoutId);
    };
    t3 = [addNotification, removeNotification, ideStatus, showJetBrainsInfo];
    $[2] = addNotification;
    $[3] = ideStatus;
    $[4] = removeNotification;
    $[5] = showJetBrainsInfo;
    $[6] = t2;
    $[7] = t3;
  } else {
    t2 = $[6];
    t3 = $[7];
  }
  useEffect(t2, t3);
  let t4;
  let t5;
  if ($[8] !== addNotification || $[9] !== ideName || $[10] !== ideStatus || $[11] !== removeNotification || $[12] !== showIDEInstallError || $[13] !== showJetBrainsInfo) {
    t4 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (showIDEInstallError || showJetBrainsInfo || ideStatus !== "disconnected" || !ideName) {
        removeNotification("ide-status-disconnected");
        return;
      }
      addNotification({
        key: "ide-status-disconnected",
        text: `${ideName} disconnected`,
        color: "error",
        priority: "medium"
      });
    };
    t5 = [addNotification, removeNotification, ideStatus, ideName, showIDEInstallError, showJetBrainsInfo];
    $[8] = addNotification;
    $[9] = ideName;
    $[10] = ideStatus;
    $[11] = removeNotification;
    $[12] = showIDEInstallError;
    $[13] = showJetBrainsInfo;
    $[14] = t4;
    $[15] = t5;
  } else {
    t4 = $[14];
    t5 = $[15];
  }
  useEffect(t4, t5);
  let t6;
  let t7;
  if ($[16] !== addNotification || $[17] !== removeNotification || $[18] !== showJetBrainsInfo) {
    t6 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!showJetBrainsInfo) {
        removeNotification("ide-status-jetbrains-disconnected");
        return;
      }
      addNotification({
        key: "ide-status-jetbrains-disconnected",
        text: "IDE plugin not connected \xB7 /status for info",
        priority: "medium"
      });
    };
    t7 = [addNotification, removeNotification, showJetBrainsInfo];
    $[16] = addNotification;
    $[17] = removeNotification;
    $[18] = showJetBrainsInfo;
    $[19] = t6;
    $[20] = t7;
  } else {
    t6 = $[19];
    t7 = $[20];
  }
  useEffect(t6, t7);
  let t8;
  let t9;
  if ($[21] !== addNotification || $[22] !== removeNotification || $[23] !== showIDEInstallError) {
    t8 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!showIDEInstallError) {
        removeNotification("ide-status-install-error");
        return;
      }
      addNotification({
        key: "ide-status-install-error",
        text: "IDE extension install failed (see /status for info)",
        color: "error",
        priority: "medium"
      });
    };
    t9 = [addNotification, removeNotification, showIDEInstallError];
    $[21] = addNotification;
    $[22] = removeNotification;
    $[23] = showIDEInstallError;
    $[24] = t8;
    $[25] = t9;
  } else {
    t8 = $[24];
    t9 = $[25];
  }
  useEffect(t8, t9);
}
function _temp2(hasShownHintRef_0, addNotification_0) {
  detectIDEs(true).then(infos => {
    const ideName_0 = infos[0]?.name;
    if (ideName_0 && !hasShownHintRef_0.current) {
      hasShownHintRef_0.current = true;
      saveGlobalConfig(_temp);
      addNotification_0({
        key: "ide-status-hint",
// 提示本体：JSX 通知，低优先级（low），不自动倒计时消失。
        jsx: <Text dimColor={true}>/ide for <Text color="ide">{ideName_0}</Text></Text>,
        priority: "low"
      });
    }
  });
}
// 每次真正展示后把全局计数 +1（config 更新用 immutable 展开）。
function _temp(current) {
  return {
    ...current,
    ideHintShownCount: (current.ideHintShownCount ?? 0) + 1
  };
}
// 原文件此处有一行 14748 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。