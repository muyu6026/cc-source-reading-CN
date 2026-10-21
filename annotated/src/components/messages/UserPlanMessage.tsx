// 【用户按 ExitPlanMode 交上来的计划，在对话里长什么样】
//
//  它走的是「用户消息」通道（UserPlanMessage），因为计划是**用户**提交的 ——
//  哪怕内容是模型写的。这个区分很重要，后面 UserTextMessage 靠
//  有没有 planContent 来决定走这个渲染器（见 UserTextMessage 第 42 行）。
//
//  视觉上是一个 planMode 色的圆角框：边框 + 加粗标题 + Markdown 正文。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { Markdown } from '../Markdown.js';
type Props = {
  addMargin: boolean;
  planContent: string;
};
export function UserPlanMessage(t0) {
  const $ = _c(6);
  const {
    addMargin,
    planContent
  } = t0;
// 【`borderColor="planMode"` 不是一个具体颜色，是一个语义色名】
//
//  全仓的颜色名分两类：
//    · 语义色  planMode / success / error / warning / subtle / suggestion / text
//    · 具体色  若干终端 16 色名（cyan / red …）
//
//  语义色由主题（ThemeName）映射成实际颜色，所以用户在 /config 里换主题时，
//  plan 模式的框会一起变。具体色名不会变。
//
//  写组件时优先用语义色 —— 这是这套 UI 能做到「一处理解成一套主题」的原因。
  const t1 = addMargin ? 1 : 0;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 【第 17 行的静态标题节点用了 sentinel，第 23 行的正文跟着 planContent 变】
//
//  注意 t2（标题）在 $[0]，t3（正文）在 $[1]/$[2]，最后 $[3]/$[4]/$[5] 存整框。
//  三层缓存对应三个变化频率：
//
//      标题      永不重算（sentinel）
//      正文      只在 planContent 变时重算（Markdown 解析很贵）
//      整框      在 marginTop 或正文变时重算
//
//  **Markdown 是这里最贵的一步**：一次 parse 要跑完整的 tokenizer。
//  缓存的关键作用就是「滚动时不要重新解析同一个 plan」。
    t2 = <Box marginBottom={1}><Text bold={true} color="planMode">Plan to implement</Text></Box>;
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  let t3;
  if ($[1] !== planContent) {
    t3 = <Markdown>{planContent}</Markdown>;
    $[1] = planContent;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] !== t1 || $[4] !== t3) {
    t4 = <Box flexDirection="column" borderStyle="round" borderColor="planMode" marginTop={t1} paddingX={1}>{t2}{t3}</Box>;
    $[3] = t1;
    $[4] = t3;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  return t4;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkJveCIsIlRleHQiLCJNYXJrZG93biIsIlByb3BzIiwiYWRkTWFyZ2luIiwicGxhbkNvbnRlbnQiLCJVc2VyUGxhbk1lc3NhZ2UiLCJ0MCIsIiQiLCJfYyIsInQxIiwidDIiLCJTeW1ib2wiLCJmb3IiLCJ0MyIsInQ0Il0sInNvdXJjZXMiOlsiVXNlclBsYW5NZXNzYWdlLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBSZWFjdCBmcm9tICdyZWFjdCdcbmltcG9ydCB7IEJveCwgVGV4dCB9IGZyb20gJy4uLy4uL2luay5qcydcbmltcG9ydCB7IE1hcmtkb3duIH0gZnJvbSAnLi4vTWFya2Rvd24uanMnXG5cbnR5cGUgUHJvcHMgPSB7XG4gIGFkZE1hcmdpbjogYm9vbGVhblxuICBwbGFuQ29udGVudDogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBVc2VyUGxhbk1lc3NhZ2Uoe1xuICBhZGRNYXJnaW4sXG4gIHBsYW5Db250ZW50LFxufTogUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICByZXR1cm4gKFxuICAgIDxCb3hcbiAgICAgIGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIlxuICAgICAgYm9yZGVyU3R5bGU9XCJyb3VuZFwiXG4gICAgICBib3JkZXJDb2xvcj1cInBsYW5Nb2RlXCJcbiAgICAgIG1hcmdpblRvcD17YWRkTWFyZ2luID8gMSA6IDB9XG4gICAgICBwYWRkaW5nWD17MX1cbiAgICA+XG4gICAgICA8Qm94IG1hcmdpbkJvdHRvbT17MX0+XG4gICAgICAgIDxUZXh0IGJvbGQgY29sb3I9XCJwbGFuTW9kZVwiPlxuICAgICAgICAgIFBsYW4gdG8gaW1wbGVtZW50XG4gICAgICAgIDwvVGV4dD5cbiAgICAgIDwvQm94PlxuICAgICAgPE1hcmtkb3duPntwbGFuQ29udGVudH08L01hcmtkb3duPlxuICAgIDwvQm94PlxuICApXG59XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxPQUFPLEtBQUtBLEtBQUssTUFBTSxPQUFPO0FBQzlCLFNBQVNDLEdBQUcsRUFBRUMsSUFBSSxRQUFRLGNBQWM7QUFDeEMsU0FBU0MsUUFBUSxRQUFRLGdCQUFnQjtBQUV6QyxLQUFLQyxLQUFLLEdBQUc7RUFDWEMsU0FBUyxFQUFFLE9BQU87RUFDbEJDLFdBQVcsRUFBRSxNQUFNO0FBQ3JCLENBQUM7QUFFRCxPQUFPLFNBQUFDLGdCQUFBQyxFQUFBO0VBQUEsTUFBQUMsQ0FBQSxHQUFBQyxFQUFBO0VBQXlCO0lBQUFMLFNBQUE7SUFBQUM7RUFBQSxJQUFBRSxFQUd4QjtFQU1TLE1BQUFHLEVBQUEsR0FBQU4sU0FBUyxHQUFULENBQWlCLEdBQWpCLENBQWlCO0VBQUEsSUFBQU8sRUFBQTtFQUFBLElBQUFILENBQUEsUUFBQUksTUFBQSxDQUFBQyxHQUFBO0lBRzVCRixFQUFBLElBQUMsR0FBRyxDQUFlLFlBQUMsQ0FBRCxHQUFDLENBQ2xCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBSixLQUFHLENBQUMsQ0FBTyxLQUFVLENBQVYsVUFBVSxDQUFDLGlCQUU1QixFQUZDLElBQUksQ0FHUCxFQUpDLEdBQUcsQ0FJRTtJQUFBSCxDQUFBLE1BQUFHLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFILENBQUE7RUFBQTtFQUFBLElBQUFNLEVBQUE7RUFBQSxJQUFBTixDQUFBLFFBQUFILFdBQUE7SUFDTlMsRUFBQSxJQUFDLFFBQVEsQ0FBRVQsWUFBVSxDQUFFLEVBQXRCLFFBQVEsQ0FBeUI7SUFBQUcsQ0FBQSxNQUFBSCxXQUFBO0lBQUFHLENBQUEsTUFBQU0sRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQU4sQ0FBQTtFQUFBO0VBQUEsSUFBQU8sRUFBQTtFQUFBLElBQUFQLENBQUEsUUFBQUUsRUFBQSxJQUFBRixDQUFBLFFBQUFNLEVBQUE7SUFacENDLEVBQUEsSUFBQyxHQUFHLENBQ1ksYUFBUSxDQUFSLFFBQVEsQ0FDVixXQUFPLENBQVAsT0FBTyxDQUNQLFdBQVUsQ0FBVixVQUFVLENBQ1gsU0FBaUIsQ0FBakIsQ0FBQUwsRUFBZ0IsQ0FBQyxDQUNsQixRQUFDLENBQUQsR0FBQyxDQUVYLENBQUFDLEVBSUssQ0FDTCxDQUFBRyxFQUFpQyxDQUNuQyxFQWJDLEdBQUcsQ0FhRTtJQUFBTixDQUFBLE1BQUFFLEVBQUE7SUFBQUYsQ0FBQSxNQUFBTSxFQUFBO0lBQUFOLENBQUEsTUFBQU8sRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQVAsQ0FBQTtFQUFBO0VBQUEsT0FiTk8sRUFhTTtBQUFBIiwiaWdub3JlTGlzdCI6W119