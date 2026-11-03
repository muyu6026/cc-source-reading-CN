import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Text } from '../ink.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';

// NOTE: This copy is legally reviewed — do not modify without Legal team approval.
export const AUTO_MODE_DESCRIPTION = "Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky actions and prompt injection before executing. Actions Claude identifies as safe are executed, while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.";
// 法务审阅过的自动模式说明常量：上方 NOTE 标明清经法务批准才能改，故这段文案（含选项措辞）不得随意改动
type Props = {
  onAccept(): void;
  onDecline(): void;
  // Startup gate: decline exits the process, so relabel accordingly.
  declineExits?: boolean;
};
// 自动模式启用确认弹窗：给用户选择「启用并设为默认 / 仅本次启用 / 退出」，并把选择落到设置与回调
export function AutoModeOptInDialog(t0) {
  const $ = _c(18);
  const {
    onAccept,
    onDecline,
    declineExits
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp, t1);
// 挂载即上报「对话框已展示」事件（tengu_auto_mode_opt_in_dialog_shown），用于漏斗统计
  let t2;
  if ($[1] !== onAccept || $[2] !== onDecline) {
    t2 = function onChange(value) {
      bb3: switch (value) {
// 变更分发用带标签的 switch（标签 bb3）：按用户选择 accept / accept-default / decline 走不同分支
        case "accept":
          {
            logEvent("tengu_auto_mode_opt_in_dialog_accept", {});
            updateSettingsForSource("userSettings", {
              skipAutoPermissionPrompt: true
            });
            onAccept();
            break bb3;
          }
// accept / accept-default 都写入 `skipAutoPermissionPrompt: true`；后者额外把默认模式设为 auto
        case "accept-default":
          {
            logEvent("tengu_auto_mode_opt_in_dialog_accept_default", {});
            updateSettingsForSource("userSettings", {
              skipAutoPermissionPrompt: true,
              permissions: {
                defaultMode: "auto"
              }
            });
            onAccept();
            break bb3;
          }
        case "decline":
          {
            logEvent("tengu_auto_mode_opt_in_dialog_decline", {});
            onDecline();
          }
// decline 分支只上报事件并调用 `onDecline`，不写任何设置
      }
    };
    $[1] = onAccept;
    $[2] = onDecline;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const onChange = t2;
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column" gap={1}><Text>{AUTO_MODE_DESCRIPTION}</Text><Link url="https://code.claude.com/docs/en/security" /></Box>;
// 主体：上方说明文案 + 一个安全文档链接（code.claude.com/docs/en/security）
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = true ? [{
      label: "Yes, and make it my default mode",
      value: "accept-default" as const
    }] : [];
    $[5] = t4;
  } else {
    t4 = $[5];
  }
// 「设为默认」选项：用恒真三元构造，值为 accept-default
  let t5;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      label: "Yes, enable auto mode",
      value: "accept" as const
    };
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  const t6 = declineExits ? "No, exit" : "No, go back";
// 拒绝文案随场景变化：启动门（decline 退出进程）显示「No, exit」，否则显示「No, go back」
  let t7;
  if ($[7] !== t6) {
    t7 = [...t4, t5, {
      label: t6,
      value: "decline" as const
    }];
    $[7] = t6;
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  let t8;
  if ($[9] !== onChange) {
    t8 = value_0 => onChange(value_0 as 'accept' | 'accept-default' | 'decline');
// 把选项值包一层类型断言回调，提交时转成 accept/accept-default/decline 之一
    $[9] = onChange;
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  let t9;
  if ($[11] !== onDecline || $[12] !== t7 || $[13] !== t8) {
    t9 = <Select options={t7} onChange={t8} onCancel={onDecline} />;
    $[11] = onDecline;
    $[12] = t7;
    $[13] = t8;
    $[14] = t9;
  } else {
    t9 = $[14];
  }
  let t10;
  if ($[15] !== onDecline || $[16] !== t9) {
    t10 = <Dialog title="Enable auto mode?" color="warning" onCancel={onDecline}>{t3}{t9}</Dialog>;
// 最外层 Dialog：标题「Enable auto mode?」，警告配色，取消键等价于 decline
    $[15] = onDecline;
    $[16] = t9;
    $[17] = t10;
  } else {
    t10 = $[17];
  }
  return t10;
}
function _temp() {
  logEvent("tengu_auto_mode_opt_in_dialog_shown", {});
}
// 原文件此处有一行 9156 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。