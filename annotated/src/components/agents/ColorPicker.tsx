import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useState } from 'react';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { AGENT_COLOR_TO_THEME_COLOR, AGENT_COLORS, type AgentColorName } from '../../tools/AgentTool/agentColorManager.js';
import { capitalize } from '../../utils/stringUtils.js';
type ColorOption = AgentColorName | 'automatic';
// COLOR_OPTIONS：automatic 排第一，后接全部内置代理色。automatic 是「让系统按代理名哈希自动分配」，确认时要映射回 undefined。
const COLOR_OPTIONS: ColorOption[] = ['automatic', ...AGENT_COLORS];
type Props = {
  agentName: string;
  currentColor?: AgentColorName | 'automatic';
  onConfirm: (color: AgentColorName | undefined) => void;
};
// ColorPicker：给代理挑标识色的自绘列表。不用通用 Select 是因为每个选项要渲染真实色块预览，通用选项行装不下。
export function ColorPicker(t0) {
  const $ = _c(17);
  const {
    agentName,
    currentColor: t1,
    onConfirm
  } = t0;
// currentColor 的 undefined 归一成 automatic：props 缺省与「用户选了自动」在内部是同一个状态，确认时再逆向映射回 undefined。
  const currentColor = t1 === undefined ? "automatic" : t1;
  let t2;
// 初始下标由当前色查找得到，Math.max 防 findIndex 返回 -1——找不到就从第一项开始，绝不带负下标进场。
  if ($[0] !== currentColor) {
    t2 = COLOR_OPTIONS.findIndex(opt => opt === currentColor);
    $[0] = currentColor;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, t2));
  let t3;
  if ($[2] !== onConfirm || $[3] !== selectedIndex) {
// 自绘键盘处理：up、down 循环移动（钳制函数见文件尾 _temp 系列，到头绕回另一端），return 确认。preventDefault 防止按键继续冒泡。
    t3 = e => {
      if (e.key === "up") {
        e.preventDefault();
        setSelectedIndex(_temp);
      } else {
        if (e.key === "down") {
          e.preventDefault();
          setSelectedIndex(_temp2);
        } else {
          if (e.key === "return") {
            e.preventDefault();
            const selected = COLOR_OPTIONS[selectedIndex];
// 确认时 automatic 映射回 undefined：存储层里 undefined 才是「未指定、自动分配」的表示，列表层的 automatic 只是它的展示名。
            onConfirm(selected === "automatic" ? undefined : selected);
          }
        }
      }
    };
    $[2] = onConfirm;
    $[3] = selectedIndex;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const handleKeyDown = t3;
  const selectedValue = COLOR_OPTIONS[selectedIndex];
  let t4;
  if ($[5] !== selectedIndex) {
    t4 = COLOR_OPTIONS.map((option, index) => {
      const isSelected = index === selectedIndex;
// 列表渲染：选中行前是箭头指针否则空格对齐；automatic 加粗显示；具体颜色渲染一个背景色空格色块加首字母大写的颜色名——色块用真实主题色，所见即所得。
      return <Box key={option} flexDirection="row" gap={1}><Text color={isSelected ? "suggestion" : undefined}>{isSelected ? figures.pointer : " "}</Text>{option === "automatic" ? <Text bold={isSelected}>Automatic color</Text> : <Box gap={1}><Text backgroundColor={AGENT_COLOR_TO_THEME_COLOR[option]} color="inverseText">{" "}</Text><Text bold={isSelected}>{capitalize(option)}</Text></Box>}</Box>;
    });
    $[5] = selectedIndex;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== t4) {
    t5 = <Box flexDirection="column">{t4}</Box>;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text>Preview: </Text>;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== agentName || $[11] !== selectedValue) {
// 预览行：用实际的 @代理名 加选中背景色渲染——挑色时看到的就是聊天里将出现的样子。automatic 用反色白底。
    t7 = <Box marginTop={1}>{t6}{selectedValue === undefined || selectedValue === "automatic" ? <Text inverse={true} bold={true}>{" "}@{agentName}{" "}</Text> : <Text backgroundColor={AGENT_COLOR_TO_THEME_COLOR[selectedValue]} color="inverseText" bold={true}>{" "}@{agentName}{" "}</Text>}</Box>;
    $[10] = agentName;
    $[11] = selectedValue;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] !== handleKeyDown || $[14] !== t5 || $[15] !== t7) {
// 容器 tabIndex 为 0 且 autoFocus：获得焦点后 onKeyDown 才生效。自绘列表的键盘焦点管理完全落在这一层，与 Select 体系并行。
    t8 = <Box flexDirection="column" gap={1} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t5}{t7}</Box>;
    $[13] = handleKeyDown;
    $[14] = t5;
    $[15] = t7;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  return t8;
}
// 两个环形钳制：down 到尾绕回头、up 到头绕回尾。提取为模块级函数让 setSelectedIndex 的更新器引用稳定。
function _temp2(prev_0) {
  return prev_0 < COLOR_OPTIONS.length - 1 ? prev_0 + 1 : 0;
}
function _temp(prev) {
  return prev > 0 ? prev - 1 : COLOR_OPTIONS.length - 1;
}
// 原文件此处有一行 10536 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。