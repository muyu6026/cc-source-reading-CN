import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Text } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { ValidationErrorsList } from './ValidationErrorsList.js';
type Props = {
  settingsErrors: ValidationError[];
  onContinue: () => void;
  onExit: () => void;
};

// 设置文件校验失败弹窗：用户要么退出修复，要么跳过无效文件继续
/**
 * Dialog shown when settings files have validation errors.
 * User must choose to continue (skipping invalid files) or exit to fix them.
 */
// Dialog 用 warning 色：设置错误是警告级别而非致命 error
export function InvalidSettingsDialog(t0) {
  const $ = _c(13);
  const {
    settingsErrors,
    onContinue,
    onExit
  } = t0;
  let t1;
// handleSelect 的缓存依赖 onContinue/onExit 两个回调
  if ($[0] !== onContinue || $[1] !== onExit) {
    t1 = function handleSelect(value) {
// handleSelect 按 value 分派：exit 走 onExit，其他（continue）走 onContinue——编译器把内部函数提升为命名函数便于缓存
      if (value === "exit") {
        onExit();
      } else {
        onContinue();
      }
    };
    $[0] = onContinue;
    $[1] = onExit;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleSelect = t1;
  let t2;
  if ($[3] !== settingsErrors) {
    t2 = <ValidationErrorsList errors={settingsErrors} />;
// 错误列表复用 ValidationErrorsList 组件：错误渲染逻辑集中一处
    $[3] = settingsErrors;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true}>Files with errors are skipped entirely, not just the invalid settings.</Text>;
// 关键提示文案：整个文件被跳过而不只是无效的设置项——让用户知道影响范围比想象大
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
// 选项数组哨兵缓存：静态内容永久复用
      label: "Exit and fix manually",
      value: "exit"
    }, {
      label: "Continue without these settings",
      value: "continue"
    }];
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== handleSelect) {
    t5 = <Select options={t4} onChange={handleSelect} />;
    $[7] = handleSelect;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== onExit || $[10] !== t2 || $[11] !== t5) {
    t6 = <Dialog title="Settings Error" onCancel={onExit} color="warning">{t2}{t3}{t5}</Dialog>;
// onCancel 也指向 onExit：Esc 退出与选 exit 等价
    $[9] = onExit;
    $[10] = t2;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  return t6;
}
// 原文件此处有一行 4904 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。