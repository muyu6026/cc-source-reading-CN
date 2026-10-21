# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【用户把计划拒了，计划正文还要显示出来】
//
//  为什么？因为用户拒绝之后，模型会看到「用户拒绝了，理由是…」，
//  然后去改计划。这时候屏幕上必须留着**被拒的那一版**，
//  否则用户没法比对「这次和上次差在哪」。
//
//  所以这段不是「错误提示」，是**存档**。它的边框用 planMode 色
//  （和提交计划时的 UserPlanMessage 同一个颜色），视觉上呼应。'''),

    (23, 'before', '''// 【`overflow="hidden"` 上有一行注释：`Necessary for Windows Terminal to render properly`】
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
//  就知道这是踩过坑之后加的，别当冗余属性删。'''),

    (26, 'before', '''// 【标题文字是「User rejected Claude's plan」—— 主语是 User】
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
//  这是一条很容易被忽略的写作原则：**同一件事，给不同人看要用不同主语。**'''),
]
