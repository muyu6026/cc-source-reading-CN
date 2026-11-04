import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useMemo } from 'react';
import { type Command, formatDescriptionWithSource } from '../../commands.js';
import { Box, Text } from '../../ink.js';
import { truncate } from '../../utils/format.js';
import { Select } from '../CustomSelect/select.js';
import { useTabHeaderFocus } from '../design-system/Tabs.js';
type Props = {
  commands: Command[];
  maxHeight: number;
  columns: number;
  title: string;
  onCancel: () => void;
  emptyMessage?: string;
};
// 帮助页的命令清单：宽度固定，可见条数按终端高度换算
export function Commands(t0) {
  const $ = _c(14);
  const {
    commands,
    maxHeight,
    columns,
    title,
    onCancel,
    emptyMessage
  } = t0;
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  const maxWidth = Math.max(1, columns - 10);
// maxWidth 等于 columns 减 10：给行首缩进与图标留出固定宽度
  const visibleCount = Math.max(1, Math.floor((maxHeight - 10) / 2));
// visibleCount 由高度算：maxHeight 减 10 再除 2 向下取整——每条命令占两行（名字与描述）
  let t1;
  if ($[0] !== commands || $[1] !== maxWidth) {
    const seen = new Set();
// 用 Set 去重：源码注释说明自定义命令可能在用户级与项目级同名出现，只保留第一条
    let t2;
    if ($[3] !== maxWidth) {
      t2 = cmd_0 => ({
        label: `/${cmd_0.name}`,
        value: cmd_0.name,
        description: truncate(formatDescriptionWithSource(cmd_0), maxWidth, true)
// 描述用 truncate 并按显示宽度截断（第三参为 true）：中英混排时按字符数截会错位
      });
      $[3] = maxWidth;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    t1 = commands.filter(cmd => {
      if (seen.has(cmd.name)) {
        return false;
      }
      seen.add(cmd.name);
      return true;
    }).sort(_temp).map(t2);
// 先去重、再按名字 localeCompare 排序，最后映射成 Select 选项
    $[0] = commands;
    $[1] = maxWidth;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const options = t1;
  let t2;
// 渲染的缓存依赖把八个输入逐个列出：清单里任何一项变化都要重算
  if ($[5] !== commands.length || $[6] !== emptyMessage || $[7] !== focusHeader || $[8] !== headerFocused || $[9] !== onCancel || $[10] !== options || $[11] !== title || $[12] !== visibleCount) {
    t2 = <Box flexDirection="column" paddingY={1}>{commands.length === 0 && emptyMessage ? <Text dimColor={true}>{emptyMessage}</Text> : <><Text>{title}</Text><Box marginTop={1}><Select options={options} visibleOptionCount={visibleCount} onCancel={onCancel} disableSelection={true} hideIndexes={true} layout="compact-vertical" onUpFromFirstItem={focusHeader} isDisabled={headerFocused} /></Box></>}</Box>;
// 空清单只显示 emptyMessage；否则标题加 Select，并开 disableSelection/hideIndexes/compact-vertical 把它当纯展示列表用
    $[5] = commands.length;
    $[6] = emptyMessage;
    $[7] = focusHeader;
    $[8] = headerFocused;
    $[9] = onCancel;
    $[10] = options;
    $[11] = title;
    $[12] = visibleCount;
    $[13] = t2;
  } else {
    t2 = $[13];
  }
  return t2;
}
// _temp 即按命令名排序的比较器
function _temp(a, b) {
  return a.name.localeCompare(b.name);
}
// 原文件此处有一行 7264 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。