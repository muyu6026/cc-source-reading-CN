import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getAllOutputStyles, OUTPUT_STYLE_CONFIG, type OutputStyleConfig } from '../constants/outputStyles.js';
import { Box, Text } from '../ink.js';
import type { OutputStyle } from '../utils/config.js';
import { getCwd } from '../utils/cwd.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { Select } from './CustomSelect/select.js';
import { Dialog } from './design-system/Dialog.js';
// 默认样式的名称与描述常量：自定义样式目录里缺配置的条目回退到这两个值——选项列表永远不出现空 label。
const DEFAULT_OUTPUT_STYLE_LABEL = 'Default';
const DEFAULT_OUTPUT_STYLE_DESCRIPTION = 'Claude completes coding tasks efficiently and provides concise responses';
// mapConfigsToOptions：把样式配置表转成 Select 选项。config 为 null 的条目（目录里有文件但解析失败或无元数据）就地回退默认文案，不让一个坏文件拖垮整个列表。
function mapConfigsToOptions(styles: {
  [styleName: string]: OutputStyleConfig | null;
}): OptionWithDescription[] {
  return Object.entries(styles).map(([style, config]) => ({
    label: config?.name ?? DEFAULT_OUTPUT_STYLE_LABEL,
    value: style,
    description: config?.description ?? DEFAULT_OUTPUT_STYLE_DESCRIPTION
  }));
}
export type OutputStylePickerProps = {
  initialStyle: OutputStyle;
  onComplete: (style: OutputStyle) => void;
  onCancel: () => void;
  isStandaloneCommand?: boolean;
};
// OutputStylePicker：选择 Claude 的输出风格（简洁代码向、解释型等）。既可嵌在设置菜单里也可作为独立命令，isStandaloneCommand 区分两种形态。
export function OutputStylePicker(t0) {
  const $ = _c(16);
  const {
    initialStyle,
    onComplete,
    onCancel,
    isStandaloneCommand
  } = t0;
  let t1;
// styleOptions 初始空数组进哨兵槽：所有渲染里的空数组共用同一引用，配合 isLoading 的加载文案，列表为空期间 Select 不渲染。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const [styleOptions, setStyleOptions] = useState(t1);
  const [isLoading, setIsLoading] = useState(true);
  let t2;
  let t3;
// 挂载加载与依赖数组一起进哨兵槽：getAllOutputStyles 按当前工作目录扫描自定义样式；失败回退内置 OUTPUT_STYLE_CONFIG——扫描出错也要能选内置风格，catch 里同样收尾 loading。
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      getAllOutputStyles(getCwd()).then(allStyles => {
        const options = mapConfigsToOptions(allStyles);
        setStyleOptions(options);
        setIsLoading(false);
      }).catch(() => {
        const builtInOptions = mapConfigsToOptions(OUTPUT_STYLE_CONFIG);
        setStyleOptions(builtInOptions);
        setIsLoading(false);
      });
    };
    t3 = [];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
  let t4;
// handleStyleSelect 依赖 onComplete 记忆化：值直接透传为 OutputStyle，无转换。
  if ($[3] !== onComplete) {
    t4 = style => {
      const outputStyle = style as OutputStyle;
      onComplete(outputStyle);
    };
    $[3] = onComplete;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const handleStyleSelect = t4;
// 两个布尔在渲染体里算两次（t5 与 t6 同值）：非独立命令时隐藏输入引导与边框——嵌在菜单里的选择器要去掉弹窗的装饰层，两个 hide 参数各自取值，编译器不合并。
  const t5 = !isStandaloneCommand;
  const t6 = !isStandaloneCommand;
  let t7;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box marginTop={1}><Text dimColor={true}>This changes how Claude Code communicates with you</Text></Box>;
    $[5] = t7;
  } else {
    t7 = $[5];
  }
  let t8;
  if ($[6] !== handleStyleSelect || $[7] !== initialStyle || $[8] !== isLoading || $[9] !== styleOptions) {
// 主体：加载中显示暗色文案，就绪后渲染 Select。visibleOptionCount 为 10：样式多时列表内部滚动，弹窗高度封顶。defaultValue 用 initialStyle 回显当前选择。
    t8 = <Box flexDirection="column" gap={1}>{t7}{isLoading ? <Text dimColor={true}>Loading output styles…</Text> : <Select options={styleOptions} onChange={handleStyleSelect} visibleOptionCount={10} defaultValue={initialStyle} />}</Box>;
    $[6] = handleStyleSelect;
    $[7] = initialStyle;
    $[8] = isLoading;
    $[9] = styleOptions;
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  let t9;
  if ($[11] !== onCancel || $[12] !== t5 || $[13] !== t6 || $[14] !== t8) {
// Dialog：onCancel 原样透传。标题 Preferred output style——输出风格改的是 Claude 与你交流的方式，不是代码行为。
    t9 = <Dialog title="Preferred output style" onCancel={onCancel} hideInputGuide={t5} hideBorder={t6}>{t8}</Dialog>;
    $[11] = onCancel;
    $[12] = t5;
    $[13] = t6;
    $[14] = t8;
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  return t9;
}
// 原文件此处有一行 9668 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。