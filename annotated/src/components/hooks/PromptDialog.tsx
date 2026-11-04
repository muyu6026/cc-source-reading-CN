import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { PromptRequest } from '../../types/hooks.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type Props = {
  title: string;
  toolInputSummary?: string | null;
  request: PromptRequest;
  onRespond: (key: string) => void;
  onAbort: () => void;
};
// hook 权限询问对话框：复用 PermissionDialog 外壳加 Select 选项列表
export function PromptDialog(t0) {
  const $ = _c(15);
  const {
    title,
    toolInputSummary,
    request,
    onRespond,
    onAbort
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// isActive:true 哨兵缓存：app:interrupt 键绑定始终激活，可随时中止询问
    t1 = {
      isActive: true
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("app:interrupt", onAbort, t1);
  let t2;
  if ($[1] !== request.options) {
    t2 = request.options.map(_temp);
// 选项映射 _temp 提取为顶层函数：把 PromptRequest 的 key/label/description 转成 Select 需要的 value/label/description——注意 key 与 value 的字段名转换
    $[1] = request.options;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const options = t2;
  let t3;
  if ($[3] !== toolInputSummary) {
    t3 = toolInputSummary ? <Text dimColor={true}>{toolInputSummary}</Text> : undefined;
// toolInputSummary 可选：有则显示在标题右侧（dim 色），没有则 undefined
    $[3] = toolInputSummary;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== onRespond) {
    t4 = value => {
// onRespond 包一层箭头：编译器为依赖变化重建回调的常规缓存模式
      onRespond(value);
    };
    $[5] = onRespond;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== options || $[8] !== t4) {
    t5 = <Box flexDirection="column" paddingY={1}><Select options={options} onChange={t4} /></Box>;
// Select 外包 paddingY=1 的 column Box：与 PermissionDialog 内容区留白对齐
    $[7] = options;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== request.message || $[11] !== t3 || $[12] !== t5 || $[13] !== title) {
    t6 = <PermissionDialog title={title} subtitle={request.message} titleRight={t3}>{t5}</PermissionDialog>;
// 组装：title + subtitle（request.message）+ titleRight（工具输入摘要）+ Select 主体
    $[10] = request.message;
    $[11] = t3;
    $[12] = t5;
    $[13] = title;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
// _temp 即选项映射函数：label/value/description 三字段的搬运
function _temp(opt) {
  return {
    label: opt.label,
    value: opt.key,
    description: opt.description
  };
}
// 原文件此处有一行 5372 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。