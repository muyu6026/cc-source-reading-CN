import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { getSettings_DEPRECATED, updateSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js';
// Props：serverName 加 onDone。项目 .mcp.json 里发现新服务器时的首次确认弹窗——把信任决定落进本地设置，之后不再询问。
type Props = {
  serverName: string;
  onDone(): void;
};
// MCPServerApprovalDialog：三选项（全部允许、仅此服务器、不使用），Dialog 用 warning 色。
export function MCPServerApprovalDialog(t0) {
  const $ = _c(13);
  const {
    serverName,
    onDone
  } = t0;
  let t1;
// onChange 依赖 serverName 与 onDone 两值记忆化。函数体先打点记录用户选择，再按选择写设置。
  if ($[0] !== onDone || $[1] !== serverName) {
    t1 = function onChange(value) {
      logEvent("tengu_mcp_dialog_choice", {
        choice: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
// bb2 标签块：编译器把 switch 的 break 重写为 break bb2（跳出带标签块），与前批 ApproveApiKey 同源，是读反编译产物的固定套路。
      bb2: switch (value) {
        case "yes":
        case "yes_all":
          {
// yes 与 yes_all 共享分支：先把服务器名追加进 enabledMcpjsonServers（includes 判重防重复写入）。读设置用 DEPRECATED 接口——此处只需要同步快照，不需要订阅变更。
            const currentSettings_0 = getSettings_DEPRECATED() || {};
            const enabledServers = currentSettings_0.enabledMcpjsonServers || [];
            if (!enabledServers.includes(serverName)) {
              updateSettingsForSource("localSettings", {
                enabledMcpjsonServers: [...enabledServers, serverName]
              });
            }
// yes_all 额外写 enableAllProjectMcpServers：此后本项目所有新 MCP 服务器自动启用，不再逐个询问——这是信任级别的跃迁，所以单独一个选项。
            if (value === "yes_all") {
              updateSettingsForSource("localSettings", {
                enableAllProjectMcpServers: true
              });
            }
            onDone();
            break bb2;
          }
        case "no":
          {
// no 分支对称：服务器名进 disabledMcpjsonServers。拒绝也落盘——下次遇到同一服务器不再重复弹窗，静默跳过。
            const currentSettings = getSettings_DEPRECATED() || {};
            const disabledServers = currentSettings.disabledMcpjsonServers || [];
            if (!disabledServers.includes(serverName)) {
              updateSettingsForSource("localSettings", {
                disabledMcpjsonServers: [...disabledServers, serverName]
              });
            }
            onDone();
          }
      }
    };
    $[0] = onDone;
    $[1] = serverName;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const onChange = t1;
// 标题动态拼接 serverName：t2 不进缓存槽（每次渲染重建字符串），因为依赖的 serverName 本身已参与 onChange 的缓存判断。
  const t2 = `New MCP server found in .mcp.json: ${serverName}`;
  let t3;
  if ($[3] !== onChange) {
    t3 = () => onChange("no");
    $[3] = onChange;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
// MCPServerDialogCopy 静态文案进常量槽：MCP 服务器的风险说明（第三方工具可执行任意代码之类），单独成组件便于复用到其他 MCP 弹窗。
    t4 = <MCPServerDialogCopy />;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
// 三选项数组进常量槽。yes_all 排第一、no 排最后：弹窗的默认焦点在第一项，产品倾向是引导启用但把「全部允许」放在「仅此服务器」前面需要用户看清再选；onCancel 兜底映射为 no。
    t5 = [{
      label: "Use this and all future MCP servers in this project",
      value: "yes_all"
    }, {
      label: "Use this MCP server",
      value: "yes"
    }, {
      label: "Continue without using this MCP server",
      value: "no"
    }];
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== onChange) {
    t6 = <Select options={t5} onChange={value_0 => onChange(value_0 as 'yes_all' | 'yes' | 'no')} onCancel={() => onChange("no")} />;
    $[7] = onChange;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== t2 || $[10] !== t3 || $[11] !== t6) {
    t7 = <Dialog title={t2} color="warning" onCancel={t3}>{t4}{t6}</Dialog>;
    $[9] = t2;
    $[10] = t3;
    $[11] = t6;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  return t7;
}
// 原文件此处有一行 8248 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。