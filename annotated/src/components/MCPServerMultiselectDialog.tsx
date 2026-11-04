// React Compiler 运行时入口。
import { c as _c } from "react/compiler-runtime";
// `partition` 来自 lodash-es，把服务器数组按「是否被选中」拆成 `[approved, rejected]` 两部分。
import partition from 'lodash-es/partition.js';
import React, { useCallback } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Text } from '../ink.js';
// 引入已废弃的设置读写：`getSettings_DEPRECATED` 读当前设置，`updateSettingsForSource` 写 localSettings（.mcp.json 的启用/禁用列表）。
import { getSettings_DEPRECATED, updateSettingsForSource } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { SelectMulti } from './CustomSelect/SelectMulti.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js';
// Props：待确认的服务器名数组 `serverNames` 与完成回调 `onDone`。
type Props = {
  serverNames: string[];
  onDone(): void;
};
// MCPServerMultiselectDialog 在发现 `.mcp.json` 里有新的 MCP 服务器时，让用户多选启用或禁用。
export function MCPServerMultiselectDialog(t0) {
// `_c(21)` 申请 21 个记忆槽位。
  const $ = _c(21);
  const {
    serverNames,
    onDone
  } = t0;
  let t1;
// 记忆 `onSubmit`：把选中的服务器拆成批准/拒绝两组，分别并入 localSettings 的启用/禁用列表（用 Set 去重），最后回调 `onDone`。
  if ($[0] !== onDone || $[1] !== serverNames) {
    t1 = function onSubmit(selectedServers) {
      const currentSettings = getSettings_DEPRECATED() || {};
      const enabledServers = currentSettings.enabledMcpjsonServers || [];
      const disabledServers = currentSettings.disabledMcpjsonServers || [];
      const [approvedServers, rejectedServers] = partition(serverNames, server => selectedServers.includes(server));
      logEvent("tengu_mcp_multidialog_choice", {
        approved: approvedServers.length,
        rejected: rejectedServers.length
      });
      if (approvedServers.length > 0) {
        const newEnabledServers = [...new Set([...enabledServers, ...approvedServers])];
        updateSettingsForSource("localSettings", {
          enabledMcpjsonServers: newEnabledServers
        });
      }
      if (rejectedServers.length > 0) {
        const newDisabledServers = [...new Set([...disabledServers, ...rejectedServers])];
        updateSettingsForSource("localSettings", {
          disabledMcpjsonServers: newDisabledServers
        });
      }
      onDone();
    };
    $[0] = onDone;
    $[1] = serverNames;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const onSubmit = t1;
  let t2;
// 记忆 `handleEscRejectAll`：Esc 时把全部 `serverNames` 标记为禁用并回调 `onDone`，即「一键拒绝所有」。
  if ($[3] !== onDone || $[4] !== serverNames) {
    t2 = () => {
      const currentSettings_0 = getSettings_DEPRECATED() || {};
      const disabledServers_0 = currentSettings_0.disabledMcpjsonServers || [];
      const newDisabledServers_0 = [...new Set([...disabledServers_0, ...serverNames])];
      updateSettingsForSource("localSettings", {
        disabledMcpjsonServers: newDisabledServers_0
      });
      onDone();
    };
    $[3] = onDone;
    $[4] = serverNames;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const handleEscRejectAll = t2;
// `t3` 是标题文案：`N new MCP servers found in .mcp.json`，用模板字符串拼出数量。
  const t3 = `${serverNames.length} new MCP servers found in .mcp.json`;
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <MCPServerDialogCopy />;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
// 用哨兵记忆每个选项（服务器名作 label 与 value），供 `SelectMulti` 渲染。
  if ($[7] !== serverNames) {
    t5 = serverNames.map(_temp);
    $[7] = serverNames;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
// 记忆 `SelectMulti`：默认全选，提交走 `onSubmit`，取消走 `handleEscRejectAll`，隐藏索引列。
  let t6;
  if ($[9] !== handleEscRejectAll || $[10] !== onSubmit || $[11] !== serverNames || $[12] !== t5) {
    t6 = <SelectMulti options={t5} defaultValue={serverNames} onSubmit={onSubmit} onCancel={handleEscRejectAll} hideIndexes={true} />;
    $[9] = handleEscRejectAll;
    $[10] = onSubmit;
    $[11] = serverNames;
    $[12] = t5;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
// 记忆外层 `Dialog`：标题为 `t3`，副标题提示「选择要启用的」，颜色为 warning。
  let t7;
  if ($[14] !== handleEscRejectAll || $[15] !== t3 || $[16] !== t6) {
    t7 = <Dialog title={t3} subtitle="Select any you wish to enable." color="warning" onCancel={handleEscRejectAll} hideInputGuide={true}>{t4}{t6}</Dialog>;
    $[14] = handleEscRejectAll;
    $[15] = t3;
    $[16] = t6;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  let t8;
// 用哨兵记忆底部快捷键提示：空格选择、回车确认、Esc 拒绝全部。
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box paddingX={1}><Text dimColor={true} italic={true}><Byline><KeyboardShortcutHint shortcut="Space" action="select" /><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="reject all" /></Byline></Text></Box>;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  let t9;
  if ($[19] !== t7) {
    t9 = <>{t7}{t8}</>;
    $[19] = t7;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  return t9;
}
// `_temp` 把单个服务器名映射成 `{label, value}`，供选项渲染。
function _temp(server_0) {
  return {
    label: server_0,
    value: server_0
  };
}
// 原文件此处有一行 11596 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。