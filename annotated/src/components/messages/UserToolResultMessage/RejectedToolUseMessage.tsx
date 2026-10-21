// 【整个文件 15 行：一句灰字「Tool use rejected」】
//
//  它是「用户拒绝了这次调用」的**通用**版本，用在工具没有提供
//  自己的 renderToolUseRejectedMessage 时。
//
//  一个组件、一句话、一个 sentinel 槽（$[0]）—— 因为它没有任何输入，
//  永远返回同一个节点。这是 Compiler 缓存的最理想情况：
//  **零依赖、永久复用。**
//
//  顺便说一个观察：本目录里有四个「一句话组件」
//  （这个、UserToolCanceledMessage、AssistantRedactedThinkingMessage、
//  CompactBoundaryMessage）。它们的共同做法是：
//  · 不抽成「传 text 的通用组件」，而是各自一个函数
//  · 因为通用化会引入一个 text prop，让每个调用点的文案变成数据
//  而**文案留在组件里，搜索「Tool use rejected」就能直接找到定义处**。
//  这是一条可维护性上的取舍：宁可组件多，不要文案散在调用点。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Text } from '../../../ink.js';
import { MessageResponse } from '../../MessageResponse.js';
export function RejectedToolUseMessage() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <MessageResponse height={1}><Text dimColor={true}>Tool use rejected</Text></MessageResponse>;
// 【MessageResponse height={1} 包一层：那一行左侧会有一条竖线】
//
//  height={1} 保证即使文本只有几个字，竖线也保持一行高度。
//
//  竖线的作用是「这是对上面那条消息的回应」——
//  在消息流里，工具调用在上、结果在下，这条线把两者连起来。
//
//  所以这个组件虽然只有一句话，它的**视觉位置**仍然是有信息量的。
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIlRleHQiLCJNZXNzYWdlUmVzcG9uc2UiLCJSZWplY3RlZFRvb2xVc2VNZXNzYWdlIiwiJCIsIl9jIiwidDAiLCJTeW1ib2wiLCJmb3IiXSwic291cmNlcyI6WyJSZWplY3RlZFRvb2xVc2VNZXNzYWdlLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBSZWFjdCBmcm9tICdyZWFjdCdcbmltcG9ydCB7IFRleHQgfSBmcm9tICcuLi8uLi8uLi9pbmsuanMnXG5pbXBvcnQgeyBNZXNzYWdlUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9NZXNzYWdlUmVzcG9uc2UuanMnXG5cbmV4cG9ydCBmdW5jdGlvbiBSZWplY3RlZFRvb2xVc2VNZXNzYWdlKCk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gIHJldHVybiAoXG4gICAgPE1lc3NhZ2VSZXNwb25zZSBoZWlnaHQ9ezF9PlxuICAgICAgPFRleHQgZGltQ29sb3I+VG9vbCB1c2UgcmVqZWN0ZWQ8L1RleHQ+XG4gICAgPC9NZXNzYWdlUmVzcG9uc2U+XG4gIClcbn1cbiJdLCJtYXBwaW5ncyI6IjtBQUFBLE9BQU8sS0FBS0EsS0FBSyxNQUFNLE9BQU87QUFDOUIsU0FBU0MsSUFBSSxRQUFRLGlCQUFpQjtBQUN0QyxTQUFTQyxlQUFlLFFBQVEsMEJBQTBCO0FBRTFELE9BQU8sU0FBQUMsdUJBQUE7RUFBQSxNQUFBQyxDQUFBLEdBQUFDLEVBQUE7RUFBQSxJQUFBQyxFQUFBO0VBQUEsSUFBQUYsQ0FBQSxRQUFBRyxNQUFBLENBQUFDLEdBQUE7SUFFSEYsRUFBQSxJQUFDLGVBQWUsQ0FBUyxNQUFDLENBQUQsR0FBQyxDQUN4QixDQUFDLElBQUksQ0FBQyxRQUFRLENBQVIsS0FBTyxDQUFDLENBQUMsaUJBQWlCLEVBQS9CLElBQUksQ0FDUCxFQUZDLGVBQWUsQ0FFRTtJQUFBRixDQUFBLE1BQUFFLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFGLENBQUE7RUFBQTtFQUFBLE9BRmxCRSxFQUVrQjtBQUFBIiwiaWdub3JlTGlzdCI6W119