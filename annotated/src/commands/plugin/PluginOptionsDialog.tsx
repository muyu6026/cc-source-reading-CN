import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useCallback, useState } from 'react';
import { Dialog } from '../../components/design-system/Dialog.js';
import { stringWidth } from '../../ink/stringWidth.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text input for config dialog
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import type { PluginOptionSchema, PluginOptionValues } from '../../utils/plugins/pluginOptionsStorage.js';

/**
 * Build the onSave payload from collected string inputs.
 *
 * Sensitive fields are never prepopulated in the text buffer (security), so
 * by the time the user reaches the last field every sensitive field they
 * stepped through contains '' in collected. To avoid silently wiping saved
 * secrets on reconfigure: if a sensitive field is '' AND initialValues has
 * a value for it, OMIT the key entirely. savePluginOptions only writes keys
 * it receives, so omitting = keep existing.
 *
 * Exported for unit testing.
 */
// 从收集到的文本输入拼出最终保存值；敏感字段不在明文缓冲区里预填，所以重配置时留空代表「保留旧值」
export function buildFinalValues(fields: string[], collected: Record<string, string>, configSchema: PluginOptionSchema, initialValues: PluginOptionValues | undefined): PluginOptionValues {
  const finalValues: PluginOptionValues = {};
  for (const fieldKey of fields) {
    const schema = configSchema[fieldKey];
    const value = collected[fieldKey] ?? '';
// 敏感字段留空且有旧值时整键省略：保存逻辑只写收到的键，省略即保留，避免静默抹掉已存密钥
    if (schema?.sensitive === true && value === '' && initialValues?.[fieldKey] !== undefined) {
      continue;
    }
    if (schema?.type === 'number') {
// 数字字段空白时不写，避免 Number() 变成 0 骗过必填校验
      // Number('') returns 0, not NaN — omit blank number inputs so
      // validateUserConfig's required check actually catches them.
      if (value.trim() === '') continue;
      const num = Number(value);
      finalValues[fieldKey] = Number.isNaN(num) ? value : num;
    } else if (schema?.type === 'boolean') {
// 布尔字段按环境真假解析，其余一律当字符串原样保存
      finalValues[fieldKey] = isEnvTruthy(value);
    } else {
      finalValues[fieldKey] = value;
    }
  }
  return finalValues;
}
// buildFinalValues 收尾：所有字段遍历完返回最终值对象
type Props = {
  title: string;
  subtitle: string;
  configSchema: PluginOptionSchema;
  /** Pre-fill fields when reconfiguring. Sensitive fields are not prepopulated. */
  initialValues?: PluginOptionValues;
  onSave: (config: PluginOptionValues) => void;
  onCancel: () => void;
};
// 配置对话框组件：逐字段收集输入，走到最后一个字段提交时回调 onSave
export function PluginOptionsDialog(t0) {
  const $ = _c(70);
  const {
    title,
    subtitle,
    configSchema,
    initialValues,
    onSave,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== configSchema) {
    t1 = Object.keys(configSchema);
    $[0] = configSchema;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const fields = t1;
  let t2;
  if ($[2] !== configSchema || $[3] !== initialValues) {
    t2 = key => {
      if (configSchema[key]?.sensitive === true) {
        return "";
      }
      const v = initialValues?.[key];
      return v === undefined ? "" : String(v);
    };
    $[2] = configSchema;
    $[3] = initialValues;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const initialFor = t2;
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
// 当前字段下标与输入值都是 React 状态，切换字段时整体搬移
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {};
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const [values, setValues] = useState(t3);
  let t4;
  if ($[6] !== fields[0] || $[7] !== initialFor) {
    t4 = () => fields[0] ? initialFor(fields[0]) : "";
    $[6] = fields[0];
    $[7] = initialFor;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const [currentInput, setCurrentInput] = useState(t4);
// 当前输入值也是状态，初始值取第一个字段的预填内容
  const currentField = fields[currentFieldIndex];
  const fieldSchema = currentField ? configSchema[currentField] : null;
  let t5;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      context: "Settings"
    };
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  useKeybinding("confirm:no", onCancel, t5);
// confirm:no 键绑定到取消，上下文标成「设置」便于和其他对话框区分
  let t6;
  if ($[10] !== currentField || $[11] !== currentFieldIndex || $[12] !== currentInput || $[13] !== fields || $[14] !== initialFor) {
    t6 = () => {
      if (currentFieldIndex < fields.length - 1 && currentField) {
        setValues(prev => ({
          ...prev,
          [currentField]: currentInput
        }));
        setCurrentFieldIndex(_temp);
        const nextKey = fields[currentFieldIndex + 1];
        setCurrentInput(nextKey ? initialFor(nextKey) : "");
      }
    };
    $[10] = currentField;
    $[11] = currentFieldIndex;
    $[12] = currentInput;
    $[13] = fields;
    $[14] = initialFor;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  const handleNextField = t6;
  let t7;
  if ($[16] !== configSchema || $[17] !== currentField || $[18] !== currentFieldIndex || $[19] !== currentInput || $[20] !== fields || $[21] !== initialFor || $[22] !== initialValues || $[23] !== onSave || $[24] !== values) {
    t7 = () => {
      if (!currentField) {
        return;
      }
      const newValues = {
        ...values,
        [currentField]: currentInput
      };
      if (currentFieldIndex === fields.length - 1) {
        onSave(buildFinalValues(fields, newValues, configSchema, initialValues));
      } else {
        setValues(newValues);
        setCurrentFieldIndex(_temp2);
        const nextKey_0 = fields[currentFieldIndex + 1];
        setCurrentInput(nextKey_0 ? initialFor(nextKey_0) : "");
      }
    };
    $[16] = configSchema;
    $[17] = currentField;
    $[18] = currentFieldIndex;
    $[19] = currentInput;
    $[20] = fields;
    $[21] = initialFor;
    $[22] = initialValues;
    $[23] = onSave;
    $[24] = values;
    $[25] = t7;
  } else {
    t7 = $[25];
  }
  const handleConfirm = t7;
// handleConfirm 取自缓存槽，负责在末字段保存、否则存值并前进
  let t8;
  if ($[26] !== handleConfirm || $[27] !== handleNextField) {
    t8 = {
      "confirm:nextField": handleNextField,
      "confirm:yes": handleConfirm
    };
    $[26] = handleConfirm;
    $[27] = handleNextField;
    $[28] = t8;
  } else {
    t8 = $[28];
  }
  let t9;
  if ($[29] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "Confirmation"
    };
    $[29] = t9;
  } else {
    t9 = $[29];
  }
  useKeybindings(t8, t9);
// 把前进与确认两个处理函数注册成键绑定：nextField 与 confirm:yes 分别触发
  let t10;
  if ($[30] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = (char, key_0) => {
      if (key_0.backspace || key_0.delete) {
        setCurrentInput(_temp3);
        return;
      }
      if (char && !key_0.ctrl && !key_0.meta && !key_0.tab && !key_0.return) {
        setCurrentInput(prev_3 => prev_3 + char);
      }
    };
    $[30] = t10;
  } else {
    t10 = $[30];
  }
  useInput(t10);
// 用 useInput 接管字符输入：退格删除、可打印字符累加
  if (!fieldSchema || !currentField) {
    return null;
// 字段或 schema 缺失时直接返回 null，不渲染任何东西
  }
  const isSensitive = fieldSchema.sensitive === true;
// 敏感字段输入时用星号按显示宽度遮盖，普通字段直接显示明文
  const isRequired = fieldSchema.required === true;
  let t11;
  if ($[31] !== currentInput || $[32] !== isSensitive) {
    t11 = isSensitive ? "*".repeat(stringWidth(currentInput)) : currentInput;
    $[31] = currentInput;
    $[32] = isSensitive;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  const displayValue = t11;
  const t12 = fieldSchema.title || currentField;
  let t13;
  if ($[34] !== isRequired) {
    t13 = isRequired && <Text color="error"> *</Text>;
    $[34] = isRequired;
    $[35] = t13;
  } else {
    t13 = $[35];
  }
  let t14;
  if ($[36] !== t12 || $[37] !== t13) {
    t14 = <Text bold={true}>{t12}{t13}</Text>;
    $[36] = t12;
    $[37] = t13;
    $[38] = t14;
  } else {
    t14 = $[38];
  }
  let t15;
  if ($[39] !== fieldSchema.description) {
    t15 = fieldSchema.description && <Text dimColor={true}>{fieldSchema.description}</Text>;
    $[39] = fieldSchema.description;
    $[40] = t15;
  } else {
    t15 = $[40];
  }
  let t16;
  if ($[41] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <Text>{figures.pointerSmall} </Text>;
    $[41] = t16;
  } else {
    t16 = $[41];
  }
  let t17;
  if ($[42] !== displayValue) {
    t17 = <Text>{displayValue}</Text>;
    $[42] = displayValue;
    $[43] = t17;
  } else {
    t17 = $[43];
  }
  let t18;
  if ($[44] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text>█</Text>;
    $[44] = t18;
  } else {
    t18 = $[44];
  }
  let t19;
  if ($[45] !== t17) {
    t19 = <Box marginTop={1}>{t16}{t17}{t18}</Box>;
    $[45] = t17;
    $[46] = t19;
  } else {
    t19 = $[46];
  }
  let t20;
  if ($[47] !== t14 || $[48] !== t15 || $[49] !== t19) {
    t20 = <Box flexDirection="column">{t14}{t15}{t19}</Box>;
    $[47] = t14;
    $[48] = t15;
    $[49] = t19;
    $[50] = t20;
  } else {
    t20 = $[50];
  }
  const t21 = currentFieldIndex + 1;
  let t22;
  if ($[51] !== fields.length || $[52] !== t21) {
    t22 = <Text dimColor={true}>Field {t21} of {fields.length}</Text>;
    $[51] = fields.length;
    $[52] = t21;
    $[53] = t22;
  } else {
    t22 = $[53];
  }
  let t23;
  if ($[54] !== currentFieldIndex || $[55] !== fields.length) {
    t23 = currentFieldIndex < fields.length - 1 && <Text dimColor={true}>Tab: Next field · Enter: Save and continue</Text>;
    $[54] = currentFieldIndex;
    $[55] = fields.length;
    $[56] = t23;
  } else {
    t23 = $[56];
  }
  let t24;
  if ($[57] !== currentFieldIndex || $[58] !== fields.length) {
    t24 = currentFieldIndex === fields.length - 1 && <Text dimColor={true}>Enter: Save configuration</Text>;
    $[57] = currentFieldIndex;
    $[58] = fields.length;
    $[59] = t24;
  } else {
    t24 = $[59];
  }
  let t25;
  if ($[60] !== t22 || $[61] !== t23 || $[62] !== t24) {
    t25 = <Box flexDirection="column">{t22}{t23}{t24}</Box>;
    $[60] = t22;
    $[61] = t23;
    $[62] = t24;
    $[63] = t25;
  } else {
    t25 = $[63];
  }
  let t26;
  if ($[64] !== onCancel || $[65] !== subtitle || $[66] !== t20 || $[67] !== t25 || $[68] !== title) {
    t26 = <Dialog title={title} subtitle={subtitle} onCancel={onCancel} isCancelActive={false}>{t20}{t25}</Dialog>;
    $[64] = onCancel;
    $[65] = subtitle;
    $[66] = t20;
    $[67] = t25;
    $[68] = title;
    $[69] = t26;
  } else {
    t26 = $[69];
  }
  return t26;
// 组件收尾：返回最外层对话框元素，由缓存槽 t26 承载
}
// _temp3 是删除字符的回调：把当前输入裁掉最后一个字符
function _temp3(prev_2) {
  return prev_2.slice(0, -1);
}
// _temp2 是字段下标加一的回调，用于跳到下一个字段
function _temp2(prev_1) {
  return prev_1 + 1;
}
// _temp 同样是字段下标加一，配合自动前进使用
function _temp(prev_0) {
  return prev_0 + 1;
}
// 原文件此处有一行 24388 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。