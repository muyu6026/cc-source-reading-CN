import { c as _c } from "react/compiler-runtime";
// ShowInIDEPrompt 是编辑文件前的权限确认弹窗：显示文件名、符号链接警告，并给出接受/拒绝以及补充反馈的选项。
import { basename, relative } from 'path';
import React from 'react';
import { Box, Text } from '../ink.js';
import { getCwd } from '../utils/cwd.js';
import { isSupportedVSCodeTerminal } from '../utils/ide.js';
import { Select } from './CustomSelect/index.js';
import { Pane } from './design-system/Pane.js';
import type { PermissionOption, PermissionOptionWithLabel } from './permissions/FilePermissionDialog/permissionOptions.js';
type Props<A> = {
  filePath: string;
  input: A;
  onChange: (option: PermissionOption, args: A, feedback?: string) => void;
  options: PermissionOptionWithLabel[];
  ideName: string;
  symlinkTarget?: string | null;
  rejectFeedback: string;
  acceptFeedback: string;
  setFocusedOption: (value: string) => void;
  onInputModeToggle: (value: string) => void;
  focusedOption: string;
  yesInputMode: boolean;
  noInputMode: boolean;
};
// Props 是泛型 A：onChange 把选中的权限选项和原始输入、可选反馈一起回传；ideName、symlinkTarget 等用于展示。
export function ShowInIDEPrompt(t0) {
  const $ = _c(36);
  const {
    onChange,
    options,
    input,
    filePath,
    ideName,
    symlinkTarget,
    rejectFeedback,
    acceptFeedback,
    setFocusedOption,
    onInputModeToggle,
    focusedOption,
    yesInputMode,
    noInputMode
  } = t0;
// 组件先用编译器缓存 $ 解构出全部 props，随后每个派生 UI 片段都按依赖做记忆化重建。
  let t1;
  if ($[0] !== ideName) {
    t1 = <Text bold={true} color="permission">Opened changes in {ideName} ⧉</Text>;
    $[0] = ideName;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// t1 是已在 ideName 中打开改动的提示文本，仅在 ideName 变化时重建。
  let t2;
  if ($[2] !== symlinkTarget) {
    t2 = symlinkTarget && <Text color="warning">{relative(getCwd(), symlinkTarget).startsWith("..") ? `This will modify ${symlinkTarget} (outside working directory) via a symlink` : `Symlink target: ${symlinkTarget}`}</Text>;
    $[2] = symlinkTarget;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
// 如果文件是符号链接且目标在 cwd 之外，会额外提示将通过符号链接修改目录外的文件，提醒用户注意越界写入。
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = isSupportedVSCodeTerminal() && <Text dimColor={true}>Save file to continue…</Text>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
// 当检测到是受支持的 VSCode 终端时，提示保存文件以继续，引导用户先落地改动。
  let t4;
  if ($[5] !== filePath) {
    t4 = basename(filePath);
    $[5] = filePath;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
// 用 basename 取出文件名用于提问，避免把完整路径直接塞进一句问话里。
  let t5;
  if ($[7] !== t4) {
    t5 = <Text>Do you want to make this edit to{" "}<Text bold={true}>{t4}</Text>?</Text>;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
// t5 是核心问句：Do you want to make this edit to <文件名>?，文件名加粗强调。
  let t6;
  if ($[9] !== acceptFeedback || $[10] !== input || $[11] !== onChange || $[12] !== options || $[13] !== rejectFeedback) {
    t6 = value => {
      const selected = options.find(opt => opt.value === value);
      if (selected) {
        if (selected.option.type === "reject") {
          const trimmedFeedback = rejectFeedback.trim();
          onChange(selected.option, input, trimmedFeedback || undefined);
          return;
        }
        if (selected.option.type === "accept-once") {
          const trimmedFeedback_0 = acceptFeedback.trim();
          onChange(selected.option, input, trimmedFeedback_0 || undefined);
          return;
        }
        onChange(selected.option, input);
      }
    };
    $[9] = acceptFeedback;
    $[10] = input;
    $[11] = onChange;
    $[12] = options;
    $[13] = rejectFeedback;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
// onChange 回调里按选项类型分发：reject / accept-once 会带上用户填写的反馈文本（trim 后为空则传 undefined），其余情况只回传选项本身。
  let t7;
  if ($[15] !== input || $[16] !== onChange) {
    t7 = () => onChange({
      type: "reject"
    }, input);
    $[15] = input;
    $[16] = onChange;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
// 没选任何选项时（Esc 取消）统一回传一个 type: reject 的空反馈，等价于拒绝。
  let t8;
  if ($[18] !== setFocusedOption) {
    t8 = value_0 => setFocusedOption(value_0);
    $[18] = setFocusedOption;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
// setFocusedOption 透传给 Select，用于记录当前高亮项。
  let t9;
  if ($[20] !== onInputModeToggle || $[21] !== options || $[22] !== t6 || $[23] !== t7 || $[24] !== t8) {
    t9 = <Select options={options} inlineDescriptions={true} onChange={t6} onCancel={t7} onFocus={t8} onInputModeToggle={onInputModeToggle} />;
    $[20] = onInputModeToggle;
    $[21] = options;
    $[22] = t6;
    $[23] = t7;
    $[24] = t8;
    $[25] = t9;
  } else {
    t9 = $[25];
  }
// Select 是内联选择组件：inlineDescriptions 让每个选项描述直接显示，onChange / onCancel / onFocus / onInputModeToggle 分别接上对应回调。
  let t10;
  if ($[26] !== t5 || $[27] !== t9) {
    t10 = <Box flexDirection="column">{t5}{t9}</Box>;
    $[26] = t5;
    $[27] = t9;
    $[28] = t10;
  } else {
    t10 = $[28];
  }
// t10 把问句和选择器竖排组合进一个 Box。
  const t11 = (focusedOption === "yes" && !yesInputMode || focusedOption === "no" && !noInputMode) && " \xB7 Tab to amend";
  let t12;
  if ($[29] !== t11) {
    t12 = <Box marginTop={1}><Text dimColor={true}>Esc to cancel{t11}</Text></Box>;
    $[29] = t11;
    $[30] = t12;
  } else {
    t12 = $[30];
  }
// t12 是底部提示条：Esc 取消；当焦点在 yes/no 且未进入输入模式时，追加 Tab to amend 提示。
  let t13;
  if ($[31] !== t1 || $[32] !== t10 || $[33] !== t12 || $[34] !== t2) {
    t13 = <Pane color="permission"><Box flexDirection="column" gap={1}>{t1}{t2}{t3}{t10}{t12}</Box></Pane>;
    $[31] = t1;
    $[32] = t10;
    $[33] = t12;
    $[34] = t2;
    $[35] = t13;
  } else {
    t13 = $[35];
  }
// 最外层用 Pane 把图标、符号链接警告、保存提示、问句、选择器、底部条整体包成一个权限色块的对话框。
  return t13;
// 组件最终返回拼装好的 Pane。
}
// 原文件此处有一行 12476 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。