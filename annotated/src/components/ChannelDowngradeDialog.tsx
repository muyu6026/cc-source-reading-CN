import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Text } from '../ink.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
// ChannelDowngradeChoice 三值：downgrade 接受可能降级、stay 留在当前版本等 stable 追上、cancel 取消切换。
export type ChannelDowngradeChoice = 'downgrade' | 'stay' | 'cancel';
type Props = {
  currentVersion: string;
  onChoice: (choice: ChannelDowngradeChoice) => void;
};

/**
 * Dialog shown when switching from latest to stable channel.
 * Allows user to choose whether to downgrade or stay on current version.
 */
// ChannelDowngradeDialog：从 latest 渠道切到 stable 时的确认——stable 版本可能比当前运行的旧，直接切等于降级，必须明说并让用户选。
export function ChannelDowngradeDialog(t0) {
  const $ = _c(17);
  const {
    currentVersion,
    onChoice
  } = t0;
  let t1;
  if ($[0] !== onChoice) {
// handleSelect 透传 onChoice；handleCancel 映射为 cancel——Esc 不默认接受降级也不默认留下，交回上层决定。
    t1 = function handleSelect(value) {
      onChoice(value);
    };
    $[0] = onChoice;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleSelect = t1;
  let t2;
  if ($[2] !== onChoice) {
    t2 = function handleCancel() {
      onChoice("cancel");
    };
    $[2] = onChoice;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleCancel = t2;
  let t3;
  if ($[4] !== currentVersion) {
// 风险说明依赖 currentVersion 单值缓存：明确告诉用户 stable 可能比当前版本旧，括号里是当前版本号——用户能自己判断差距多大。
    t3 = <Text>The stable channel may have an older version than what you're currently running ({currentVersion}).</Text>;
    $[4] = currentVersion;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text dimColor={true}>How would you like to handle this?</Text>;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// 选项数组两进两出：第一项（允许降级）进哨兵槽；第二项的 label 动态拼当前版本号，依赖版本单值缓存。stay 文案精确描述了后果——版本不回退，只是停更到 stable 追上。
    t5 = {
      label: "Allow possible downgrade to stable version",
      value: "downgrade" as ChannelDowngradeChoice
    };
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const t6 = `Stay on current version (${currentVersion}) until stable catches up`;
  let t7;
  if ($[8] !== t6) {
    t7 = [t5, {
      label: t6,
      value: "stay" as ChannelDowngradeChoice
    }];
    $[8] = t6;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
  if ($[10] !== handleSelect || $[11] !== t7) {
    t8 = <Select options={t7} onChange={handleSelect} />;
    $[10] = handleSelect;
    $[11] = t7;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
  if ($[13] !== handleCancel || $[14] !== t3 || $[15] !== t8) {
// Dialog permission 色、隐藏边框与输入引导——这是嵌在渠道切换流程里的确认步骤，不是独立弹窗，装饰层全去掉。
    t9 = <Dialog title="Switch to Stable Channel" onCancel={handleCancel} color="permission" hideBorder={true} hideInputGuide={true}>{t3}{t4}{t8}</Dialog>;
    $[13] = handleCancel;
    $[14] = t3;
    $[15] = t8;
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  return t9;
}
// 原文件此处有一行 5728 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。