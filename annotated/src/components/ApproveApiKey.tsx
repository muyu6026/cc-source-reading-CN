import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Text } from '../ink.js';
import { saveGlobalConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
// Props：customApiKeyTruncated 是脱敏后的密钥尾部（sk-ant 开头加末几位），用于展示与配置记录；onDone 把 yes 与 no 归一成布尔回调。
type Props = {
  customApiKeyTruncated: string;
  onDone(approved: boolean): void;
};
// 环境变量里检测到自定义 API key 时的确认弹窗。默认选项是拒绝——弹窗的色彩也用了 warning。整个组件就是一个 Dialog 加一个双选项 Select。
export function ApproveApiKey(t0) {
  const $ = _c(17);
  const {
    customApiKeyTruncated,
    onDone
  } = t0;
  let t1;
// onChange 依赖两个 props，被编译器包进记忆槽：只有密钥或回调变化才重建函数。函数体内按选择写全局配置。
  if ($[0] !== customApiKeyTruncated || $[1] !== onDone) {
    t1 = function onChange(value) {
// bb2 标签块：编译器把 switch 的 break 重写成 break bb2（跳出带标签的块），不是业务代码里的标签语法——与前批 DiffDialog 里的 bb0 同源，读反编译产物时的固定套路。
      bb2: switch (value) {
        case "yes":
          {
// 同意分支：把脱敏密钥追加进全局配置的 approved 数组。saveGlobalConfig 接收函数式更新器，基于当前值展开追加，避免读改写竞态。
            saveGlobalConfig(current_0 => ({
              ...current_0,
              customApiKeyResponses: {
                ...current_0.customApiKeyResponses,
                approved: [...(current_0.customApiKeyResponses?.approved ?? []), customApiKeyTruncated]
              }
            }));
            onDone(true);
            break bb2;
          }
        case "no":
          {
// 拒绝分支：结构对称，密钥进 rejected 数组。approved 与 rejected 两个列表后续用于跳过对同一密钥的重复询问。
            saveGlobalConfig(current => ({
              ...current,
              customApiKeyResponses: {
                ...current.customApiKeyResponses,
                rejected: [...(current.customApiKeyResponses?.rejected ?? []), customApiKeyTruncated]
              }
            }));
            onDone(false);
          }
      }
    };
    $[0] = customApiKeyTruncated;
    $[1] = onDone;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const onChange = t1;
  let t2;
  if ($[3] !== onChange) {
// onCancel 也走 no：Esc 关闭弹窗等价于拒绝，不留下「没回答」的第三态。t2 在第 55 行先于 Select 构造，供 Dialog 的 onCancel 复用。
    t2 = () => onChange("no");
    $[3] = onChange;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text bold={true}>ANTHROPIC_API_KEY</Text>;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== customApiKeyTruncated) {
    t4 = <Text>{t3}<Text>: sk-ant-...{customApiKeyTruncated}</Text></Text>;
    $[6] = customApiKeyTruncated;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>Do you want to use this API key?</Text>;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
// 选项数组进常量槽（sentinel 判断后只建一次）：两个选项对象在组件生命周期内不变。
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      label: "Yes",
      value: "yes"
    };
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = [t6, {
// No 选项标注 recommended 加粗：产品立场是默认不信环境变量里的密钥——用户需要显式确认才启用，且每次问询的答案都被记进配置不再重复问。
      label: <Text>No (<Text bold={true}>recommended</Text>)</Text>,
      value: "no"
    }];
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== onChange) {
// defaultValue 与 defaultFocusValue 都设为 no：初始选中与初始焦点都在拒绝项上，直接回车即拒绝。onCancel 走同一 onChange，与第 55 行呼应。
    t8 = <Select defaultValue="no" defaultFocusValue="no" options={t7} onChange={value_0 => onChange(value_0 as 'yes' | 'no')} onCancel={() => onChange("no")} />;
    $[11] = onChange;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
  if ($[13] !== t2 || $[14] !== t4 || $[15] !== t8) {
    t9 = <Dialog title="Detected a custom API key in your environment" color="warning" onCancel={t2}>{t4}{t5}{t8}</Dialog>;
    $[13] = t2;
    $[14] = t4;
    $[15] = t8;
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  return t9;
}
// 原文件此处有一行 7488 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。