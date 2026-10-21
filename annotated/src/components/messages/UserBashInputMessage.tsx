// 【`!命令` 这一行在历史里的样子：深色底 + 一个感叹号前缀】
//
//  配色和输入框的 bash 边框一致（bashBorder / bashMessageBackgroundColor），
//  这样用户在输入时和回看时看到的是同一套视觉语言。
//
//  整个文件只有 57 行，但它和 UserPromptMessage 是对称的一对：
//  同样是「用户说的话」，一个走聊天通道、一个走 bash 通道。
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
export function UserBashInputMessage(t0) {
  const $ = _c(8);
  const {
    param: t1,
    addMargin
  } = t0;
  const {
    text
  } = t1;
  let t2;
// 【extractTag 拿不到 bash-input 就返回 null】
//
//  这个 null 不是「出错了」，而是「这条消息不归我管」——
//  UserTextMessage 在分发时用的是 `param.text.includes('<bash-input>')`，
//  包含但抠不出来（比如只有开标签没有闭标签）时，宁可不渲染。
//
//  这是分发层的一贯做法：**判断用 includes（宽），渲染用 extractTag（严）**。
//  宽的那一步负责把消息送对地方，严的那一步负责在数据损坏时安静地失败。
  if ($[0] !== text) {
    t2 = extractTag(text, "bash-input");
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const input = t2;
  if (!input) {
    return null;
  }
  const t3 = addMargin ? 1 : 0;
  let t4;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
// 【静态的「! 」前缀节点用 sentinel，内容跟着 input 变】
//
//  注意 input 在这里已经是纯文本了，没有再做任何 Markdown 解析 ——
//  bash 命令按原样显示，连换行都保留。这是刻意的：
//  一条 shell 命令里 `*` `_` `#` 都是语法字符，走 Markdown 会被吃掉。
    t4 = <Text color="bashBorder">! </Text>;
    $[2] = t4;
  } else {
    t4 = $[2];
  }
  let t5;
  if ($[3] !== input) {
    t5 = <Text color="text">{input}</Text>;
    $[3] = input;
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  let t6;
  if ($[5] !== t3 || $[6] !== t5) {
    t6 = <Box flexDirection="row" marginTop={t3} backgroundColor="bashMessageBackgroundColor" paddingRight={1}>{t4}{t5}</Box>;
    $[5] = t3;
    $[6] = t5;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  return t6;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJUZXh0QmxvY2tQYXJhbSIsIlJlYWN0IiwiQm94IiwiVGV4dCIsImV4dHJhY3RUYWciLCJQcm9wcyIsImFkZE1hcmdpbiIsInBhcmFtIiwiVXNlckJhc2hJbnB1dE1lc3NhZ2UiLCJ0MCIsIiQiLCJfYyIsInQxIiwidGV4dCIsInQyIiwiaW5wdXQiLCJ0MyIsInQ0IiwiU3ltYm9sIiwiZm9yIiwidDUiLCJ0NiJdLCJzb3VyY2VzIjpbIlVzZXJCYXNoSW5wdXRNZXNzYWdlLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IFRleHRCbG9ja1BhcmFtIH0gZnJvbSAnQGFudGhyb3BpYy1haS9zZGsvcmVzb3VyY2VzL2luZGV4Lm1qcydcbmltcG9ydCAqIGFzIFJlYWN0IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgQm94LCBUZXh0IH0gZnJvbSAnLi4vLi4vaW5rLmpzJ1xuaW1wb3J0IHsgZXh0cmFjdFRhZyB9IGZyb20gJy4uLy4uL3V0aWxzL21lc3NhZ2VzLmpzJ1xuXG50eXBlIFByb3BzID0ge1xuICBhZGRNYXJnaW46IGJvb2xlYW5cbiAgcGFyYW06IFRleHRCbG9ja1BhcmFtXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBVc2VyQmFzaElucHV0TWVzc2FnZSh7XG4gIHBhcmFtOiB7IHRleHQgfSxcbiAgYWRkTWFyZ2luLFxufTogUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICBjb25zdCBpbnB1dCA9IGV4dHJhY3RUYWcodGV4dCwgJ2Jhc2gtaW5wdXQnKVxuICBpZiAoIWlucHV0KSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICByZXR1cm4gKFxuICAgIDxCb3hcbiAgICAgIGZsZXhEaXJlY3Rpb249XCJyb3dcIlxuICAgICAgbWFyZ2luVG9wPXthZGRNYXJnaW4gPyAxIDogMH1cbiAgICAgIGJhY2tncm91bmRDb2xvcj1cImJhc2hNZXNzYWdlQmFja2dyb3VuZENvbG9yXCJcbiAgICAgIHBhZGRpbmdSaWdodD17MX1cbiAgICA+XG4gICAgICA8VGV4dCBjb2xvcj1cImJhc2hCb3JkZXJcIj4hIDwvVGV4dD5cbiAgICAgIDxUZXh0IGNvbG9yPVwidGV4dFwiPntpbnB1dH08L1RleHQ+XG4gICAgPC9Cb3g+XG4gIClcbn1cbiJdLCJtYXBwaW5ncyI6IjtBQUFBLGNBQWNBLGNBQWMsUUFBUSx1Q0FBdUM7QUFDM0UsT0FBTyxLQUFLQyxLQUFLLE1BQU0sT0FBTztBQUM5QixTQUFTQyxHQUFHLEVBQUVDLElBQUksUUFBUSxjQUFjO0FBQ3hDLFNBQVNDLFVBQVUsUUFBUSx5QkFBeUI7QUFFcEQsS0FBS0MsS0FBSyxHQUFHO0VBQ1hDLFNBQVMsRUFBRSxPQUFPO0VBQ2xCQyxLQUFLLEVBQUVQLGNBQWM7QUFDdkIsQ0FBQztBQUVELE9BQU8sU0FBQVEscUJBQUFDLEVBQUE7RUFBQSxNQUFBQyxDQUFBLEdBQUFDLEVBQUE7RUFBOEI7SUFBQUosS0FBQSxFQUFBSyxFQUFBO0lBQUFOO0VBQUEsSUFBQUcsRUFHN0I7RUFGQztJQUFBSTtFQUFBLElBQUFELEVBQVE7RUFBQSxJQUFBRSxFQUFBO0VBQUEsSUFBQUosQ0FBQSxRQUFBRyxJQUFBO0lBR0RDLEVBQUEsR0FBQVYsVUFBVSxDQUFDUyxJQUFJLEVBQUUsWUFBWSxDQUFDO0lBQUFILENBQUEsTUFBQUcsSUFBQTtJQUFBSCxDQUFBLE1BQUFJLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFKLENBQUE7RUFBQTtFQUE1QyxNQUFBSyxLQUFBLEdBQWNELEVBQThCO0VBQzVDLElBQUksQ0FBQ0MsS0FBSztJQUFBLE9BQ0QsSUFBSTtFQUFBO0VBS0UsTUFBQUMsRUFBQSxHQUFBVixTQUFTLEdBQVQsQ0FBaUIsR0FBakIsQ0FBaUI7RUFBQSxJQUFBVyxFQUFBO0VBQUEsSUFBQVAsQ0FBQSxRQUFBUSxNQUFBLENBQUFDLEdBQUE7SUFJNUJGLEVBQUEsSUFBQyxJQUFJLENBQU8sS0FBWSxDQUFaLFlBQVksQ0FBQyxFQUFFLEVBQTFCLElBQUksQ0FBNkI7SUFBQVAsQ0FBQSxNQUFBTyxFQUFBO0VBQUE7SUFBQUEsRUFBQSxHQUFBUCxDQUFBO0VBQUE7RUFBQSxJQUFBVSxFQUFBO0VBQUEsSUFBQVYsQ0FBQSxRQUFBSyxLQUFBO0lBQ2xDSyxFQUFBLElBQUMsSUFBSSxDQUFPLEtBQU0sQ0FBTixNQUFNLENBQUVMLE1BQUksQ0FBRSxFQUF6QixJQUFJLENBQTRCO0lBQUFMLENBQUEsTUFBQUssS0FBQTtJQUFBTCxDQUFBLE1BQUFVLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFWLENBQUE7RUFBQTtFQUFBLElBQUFXLEVBQUE7RUFBQSxJQUFBWCxDQUFBLFFBQUFNLEVBQUEsSUFBQU4sQ0FBQSxRQUFBVSxFQUFBO0lBUG5DQyxFQUFBLElBQUMsR0FBRyxDQUNZLGFBQUssQ0FBTCxLQUFLLENBQ1IsU0FBaUIsQ0FBakIsQ0FBQUwsRUFBZ0IsQ0FBQyxDQUNaLGVBQTRCLENBQTVCLDRCQUE0QixDQUM5QixZQUFDLENBQUQsR0FBQyxDQUVmLENBQUFDLEVBQWlDLENBQ2pDLENBQUFHLEVBQWdDLENBQ2xDLEVBUkMsR0FBRyxDQVFFO0lBQUFWLENBQUEsTUFBQU0sRUFBQTtJQUFBTixDQUFBLE1BQUFVLEVBQUE7SUFBQVYsQ0FBQSxNQUFBVyxFQUFBO0VBQUE7SUFBQUEsRUFBQSxHQUFBWCxDQUFBO0VBQUE7RUFBQSxPQVJOVyxFQVFNO0FBQUEiLCJpZ25vcmVMaXN0IjpbXX0=