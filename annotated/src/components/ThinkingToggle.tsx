import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Pane } from './design-system/Pane.js';
export type Props = {
  currentValue: boolean;
  onSelect: (enabled: boolean) => void;
  onCancel?: () => void;
  isMidConversation?: boolean;
};
// 组件入口：编译器运行时把入参解构成 `t0`，并调用 `_c(27)` 预留 27 个记忆化缓存槽（对应下文每个 `$[n]`）
export function ThinkingToggle(t0) {
  const $ = _c(27);
  const {
    currentValue,
    onSelect,
    onCancel,
    isMidConversation
  } = t0;
  const exitState = useExitOnCtrlCDWithKeybindings();
  const [confirmationPending, setConfirmationPending] = useState(null);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [{
      value: "true",
      label: "Enabled",
      description: "Claude will think before responding"
    }, {
      value: "false",
      label: "Disabled",
      description: "Claude will respond without extended thinking"
    }];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const options = t1;
// 思考模式的两个选项：value 用字符串 `true`/`false` 而非布尔，是为了和 `Select` 组件的选项值类型对齐
  let t2;
  if ($[1] !== confirmationPending || $[2] !== onCancel) {
    t2 = () => {
      if (confirmationPending !== null) {
        setConfirmationPending(null);
      } else {
        onCancel?.();
      }
    };
    $[1] = confirmationPending;
    $[2] = onCancel;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      context: "Confirmation"
    };
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  useKeybinding("confirm:no", t2, t3);
// 绑定 confirm:no 键：触发 `t2` 回调，在确认态下收起、否则调用 `onCancel`；context 设为 Confirmation 以便与确认键区分
  let t4;
  if ($[5] !== confirmationPending || $[6] !== onSelect) {
    t4 = () => {
      if (confirmationPending !== null) {
        onSelect(confirmationPending);
      }
    };
    $[5] = confirmationPending;
    $[6] = onSelect;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const t5 = confirmationPending !== null;
  let t6;
  if ($[8] !== t5) {
    t6 = {
      context: "Confirmation",
      isActive: t5
    };
    $[8] = t5;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  useKeybinding("confirm:yes", t4, t6);
// 绑定 confirm:yes 键：仅当处于确认态时把当前选择提交给 `onSelect`，避免中途误触直接提交
  let t7;
  if ($[10] !== currentValue || $[11] !== isMidConversation || $[12] !== onSelect) {
    t7 = function handleSelectChange(value) {
      const selected = value === "true";
      if (isMidConversation && selected !== currentValue) {
        setConfirmationPending(selected);
      } else {
        onSelect(selected);
      }
    };
    $[10] = currentValue;
    $[11] = isMidConversation;
    $[12] = onSelect;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  const handleSelectChange = t7;
  let t8;
// 主标题与说明：用 `flexDirection='column'` 纵向排布「切换思考模式」标题与一句话描述
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginBottom={1} flexDirection="column"><Text color="remember" bold={true}>Toggle thinking mode</Text><Text dimColor={true}>Enable or disable thinking for this session.</Text></Box>;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] !== confirmationPending || $[16] !== currentValue || $[17] !== handleSelectChange || $[18] !== onCancel) {
    t9 = <Box flexDirection="column">{t8}{confirmationPending !== null ? <Box flexDirection="column" marginBottom={1} gap={1}><Text color="warning">Changing thinking mode mid-conversation will increase latency and may reduce quality. For best results, set this at the start of a session.</Text><Text color="warning">Do you want to proceed?</Text></Box> : <Box flexDirection="column" marginBottom={1}><Select defaultValue={currentValue ? "true" : "false"} defaultFocusValue={currentValue ? "true" : "false"} options={options} onChange={handleSelectChange} onCancel={onCancel ?? _temp} visibleOptionCount={2} /></Box>}</Box>;
// 确认态分支：若用户中途切换思考模式，先提示会增加延迟并可能降低质量；否则直接渲染 `Select` 让用户选启用或停用
    $[15] = confirmationPending;
    $[16] = currentValue;
    $[17] = handleSelectChange;
    $[18] = onCancel;
    $[19] = t9;
  } else {
    t9 = $[19];
  }
  let t10;
  if ($[20] !== confirmationPending || $[21] !== exitState.keyName || $[22] !== exitState.pending) {
    t10 = <Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : confirmationPending !== null ? <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="exit" /></Byline>}</Text>;
// 底部提示条：根据是否处于确认态、是否等待退出，显示不同的快捷键引导（Enter 确认 / Esc 退出）
    $[20] = confirmationPending;
    $[21] = exitState.keyName;
    $[22] = exitState.pending;
    $[23] = t10;
  } else {
    t10 = $[23];
  }
  let t11;
  if ($[24] !== t10 || $[25] !== t9) {
    t11 = <Pane color="permission">{t9}{t10}</Pane>;
// 把标题区 `t9` 与提示区 `t10` 包进 `Pane`，整体以权限对话框风格（permission 配色）呈现
    $[24] = t10;
    $[25] = t9;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  return t11;
}
function _temp() {}
// 原文件此处有一行 13032 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。