import { c as _c } from "react/compiler-runtime";
import React, { useCallback } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Link, Newline, Text } from '../ink.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  onAccept(): void;
};
// 危险模式（Bypass Permissions）确认弹窗：进入前必须显式接受全部责任
export function BypassPermissionsModeDialog(t0) {
  const $ = _c(7);
  const {
    onAccept
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp, t1);
// 挂载即打点 shown：空依赖只求值一次，对应漏斗的「展示」环节
  let t2;
  if ($[1] !== onAccept) {
    t2 = function onChange(value) {
// onChange 写成命名函数便于编译器缓存；参数被收窄成 accept 与 decline 两值
      bb3: switch (value) {
        case "accept":
          {
            logEvent("tengu_bypass_permissions_mode_dialog_accept", {});
// accept 路径三步：打点、写 userSettings 的 skipDangerousModePermissionPrompt、回调 onAccept——接受后不再重复警告
            updateSettingsForSource("userSettings", {
              skipDangerousModePermissionPrompt: true
            });
            onAccept();
            break bb3;
          }
        case "decline":
          {
            gracefulShutdownSync(1);
// decline 直接 gracefulShutdownSync(1)：拒绝就以退出码 1 退出进程，不提供「稍后再说」
          }
      }
    };
    $[1] = onAccept;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const onChange = t2;
  const handleEscape = _temp2;
// Esc 走 _temp2 用退出码 0：与选 decline 的退出码 1 区分开，便于区分主动退出与拒绝
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column" gap={1}><Text>In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.<Newline />This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.</Text><Text>By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.</Text><Link url="https://code.claude.com/docs/en/security" /></Box>;
// 警告文案三段递进：不询问就执行危险命令 / 只应在网络受限且可恢复的沙箱里用 / 后果自负，末尾挂安全文档链接
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
// 选项顺序 No 在前 Yes 在后：危险操作的默认光标落在安全项上
      label: "No, exit",
      value: "decline"
    }, {
      label: "Yes, I accept",
      value: "accept"
    }];
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] !== onChange) {
    t5 = <Dialog title="WARNING: Claude Code running in Bypass Permissions mode" color="error" onCancel={handleEscape}>{t3}<Select options={t4} onChange={value_0 => onChange(value_0 as 'accept' | 'decline')} /></Dialog>;
// value_0 as accept|decline：Select 回调参数是 string，这里做一次类型断言收窄
    $[5] = onChange;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  return t5;
}
function _temp2() {
  gracefulShutdownSync(0);
}
function _temp() {
  logEvent("tengu_bypass_permissions_mode_dialog_shown", {});
}
// 原文件此处有一行 6452 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。