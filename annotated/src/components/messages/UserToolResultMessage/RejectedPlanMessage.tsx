// 【用户把计划拒了，计划正文还要显示出来】
//
//  为什么？因为用户拒绝之后，模型会看到「用户拒绝了，理由是…」，
//  然后去改计划。这时候屏幕上必须留着**被拒的那一版**，
//  否则用户没法比对「这次和上次差在哪」。
//
//  所以这段不是「错误提示」，是**存档**。它的边框用 planMode 色
//  （和提交计划时的 UserPlanMessage 同一个颜色），视觉上呼应。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Markdown } from 'src/components/Markdown.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Box, Text } from '../../../ink.js';
type Props = {
  plan: string;
};
export function RejectedPlanMessage(t0) {
  const $ = _c(3);
  const {
    plan
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text color="subtle">User rejected Claude's plan:</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== plan) {
// 【`overflow="hidden"` 上有一行注释：`Necessary for Windows Terminal to render properly`】
//
//  这是本批里第二处「为一个具体终端写特别代码」（第一处是 chalk 的 dim+bold bug）。
//
//  为什么需要它？因为 Markdown 可能渲染出比容器更宽的一行
//  （长 URL、长代码、表格），而 Windows Terminal 在遇到「内容超出
//  带边框的 Box」时，边框会错位 —— 边框字符被顶到下一行或者消失。
//
//  overflow="hidden" 让内容被裁掉而不是撑破容器。
//
//  这类补丁的共同特征：**注释里点名了终端名。**
//  看到 `Windows Terminal` / `iTerm` / `tmux` 这种具体名字，
//  就知道这是踩过坑之后加的，别当冗余属性删。
    t2 = <MessageResponse><Box flexDirection="column">{t1}<Box borderStyle="round" borderColor="planMode" paddingX={1} overflow="hidden"><Markdown>{plan}</Markdown></Box></Box></MessageResponse>;
    $[1] = plan;
    $[2] = t2;
// 【标题文字是「User rejected Claude's plan」—— 主语是 User】
//
//  对比同目录 PlanApprovalMessage 里的「✗ Plan Rejected by alice」，
//  两者说的是同一件事，但视角不同：
//
//      这里        「用户拒绝了 Claude 的计划」（Claude 是这条消息的发送方视角）
//      PlanApproval「alice 拒绝了计划」      （团队协作视角，要说清是谁）
//
//  文案的视角跟随**这条消息的读者**：单机模式下读者就是用户自己，
//  所以用「User rejected」；团队里读者是别的 agent，
//  所以必须点名是谁拒的。
//
//  这是一条很容易被忽略的写作原则：**同一件事，给不同人看要用不同主语。**
  } else {
    t2 = $[2];
  }
  return t2;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIk1hcmtkb3duIiwiTWVzc2FnZVJlc3BvbnNlIiwiQm94IiwiVGV4dCIsIlByb3BzIiwicGxhbiIsIlJlamVjdGVkUGxhbk1lc3NhZ2UiLCJ0MCIsIiQiLCJfYyIsInQxIiwiU3ltYm9sIiwiZm9yIiwidDIiXSwic291cmNlcyI6WyJSZWplY3RlZFBsYW5NZXNzYWdlLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBSZWFjdCBmcm9tICdyZWFjdCdcbmltcG9ydCB7IE1hcmtkb3duIH0gZnJvbSAnc3JjL2NvbXBvbmVudHMvTWFya2Rvd24uanMnXG5pbXBvcnQgeyBNZXNzYWdlUmVzcG9uc2UgfSBmcm9tICdzcmMvY29tcG9uZW50cy9NZXNzYWdlUmVzcG9uc2UuanMnXG5pbXBvcnQgeyBCb3gsIFRleHQgfSBmcm9tICcuLi8uLi8uLi9pbmsuanMnXG5cbnR5cGUgUHJvcHMgPSB7XG4gIHBsYW46IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gUmVqZWN0ZWRQbGFuTWVzc2FnZSh7IHBsYW4gfTogUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICByZXR1cm4gKFxuICAgIDxNZXNzYWdlUmVzcG9uc2U+XG4gICAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIj5cbiAgICAgICAgPFRleHQgY29sb3I9XCJzdWJ0bGVcIj5Vc2VyIHJlamVjdGVkIENsYXVkZSZhcG9zO3MgcGxhbjo8L1RleHQ+XG4gICAgICAgIDxCb3hcbiAgICAgICAgICBib3JkZXJTdHlsZT1cInJvdW5kXCJcbiAgICAgICAgICBib3JkZXJDb2xvcj1cInBsYW5Nb2RlXCJcbiAgICAgICAgICBwYWRkaW5nWD17MX1cbiAgICAgICAgICAvLyBOZWNlc3NhcnkgZm9yIFdpbmRvd3MgVGVybWluYWwgdG8gcmVuZGVyIHByb3Blcmx5XG4gICAgICAgICAgb3ZlcmZsb3c9XCJoaWRkZW5cIlxuICAgICAgICA+XG4gICAgICAgICAgPE1hcmtkb3duPntwbGFufTwvTWFya2Rvd24+XG4gICAgICAgIDwvQm94PlxuICAgICAgPC9Cb3g+XG4gICAgPC9NZXNzYWdlUmVzcG9uc2U+XG4gIClcbn1cbiJdLCJtYXBwaW5ncyI6IjtBQUFBLE9BQU8sS0FBS0EsS0FBSyxNQUFNLE9BQU87QUFDOUIsU0FBU0MsUUFBUSxRQUFRLDRCQUE0QjtBQUNyRCxTQUFTQyxlQUFlLFFBQVEsbUNBQW1DO0FBQ25FLFNBQVNDLEdBQUcsRUFBRUMsSUFBSSxRQUFRLGlCQUFpQjtBQUUzQyxLQUFLQyxLQUFLLEdBQUc7RUFDWEMsSUFBSSxFQUFFLE1BQU07QUFDZCxDQUFDO0FBRUQsT0FBTyxTQUFBQyxvQkFBQUMsRUFBQTtFQUFBLE1BQUFDLENBQUEsR0FBQUMsRUFBQTtFQUE2QjtJQUFBSjtFQUFBLElBQUFFLEVBQWU7RUFBQSxJQUFBRyxFQUFBO0VBQUEsSUFBQUYsQ0FBQSxRQUFBRyxNQUFBLENBQUFDLEdBQUE7SUFJM0NGLEVBQUEsSUFBQyxJQUFJLENBQU8sS0FBUSxDQUFSLFFBQVEsQ0FBQyw0QkFBaUMsRUFBckQsSUFBSSxDQUF3RDtJQUFBRixDQUFBLE1BQUFFLEVBQUE7RUFBQTtJQUFBQSxFQUFBLEdBQUFGLENBQUE7RUFBQTtFQUFBLElBQUFLLEVBQUE7RUFBQSxJQUFBTCxDQUFBLFFBQUFILElBQUE7SUFGakVRLEVBQUEsSUFBQyxlQUFlLENBQ2QsQ0FBQyxHQUFHLENBQWUsYUFBUSxDQUFSLFFBQVEsQ0FDekIsQ0FBQUgsRUFBNEQsQ0FDNUQsQ0FBQyxHQUFHLENBQ1UsV0FBTyxDQUFQLE9BQU8sQ0FDUCxXQUFVLENBQVYsVUFBVSxDQUNaLFFBQUMsQ0FBRCxHQUFDLENBRUYsUUFBUSxDQUFSLFFBQVEsQ0FFakIsQ0FBQyxRQUFRLENBQUVMLEtBQUcsQ0FBRSxFQUFmLFFBQVEsQ0FDWCxFQVJDLEdBQUcsQ0FTTixFQVhDLEdBQUcsQ0FZTixFQWJDLGVBQWUsQ0FhRTtJQUFBRyxDQUFBLE1BQUFILElBQUE7SUFBQUcsQ0FBQSxNQUFBSyxFQUFBO0VBQUE7SUFBQUEsRUFBQSxHQUFBTCxDQUFBO0VBQUE7RUFBQSxPQWJsQkssRUFha0I7QUFBQSIsImlnbm9yZUxpc3QiOltdfQ==