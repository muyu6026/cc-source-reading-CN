# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  PlanApprovalMessage：计划审批请求 / 结果
// ═══════════════════════════════════════════════════════════════
//
//  四个阶段，两两成对：
//      请求    planMode 色圆角框 + 计划正文 + 计划文件路径
//      批准    绿色框 + 「现在可以实施了」
//      拒绝    红色框 + 反馈 + 「改完再调一次 ExitPlanMode」
//
//  这个文件除了渲染器，还提供 formatTeammateMessageContent ——
//  一个把「任意 teammate 消息」压成一行摘要的总入口。
//  它把本目录另外两个文件（ShutdownMessage / TaskAssignmentMessage）
//  的摘要函数串起来，顺序即优先级。'''),

    (32, 'before', '''// 【两条虚线（dashed）只留上下边框，因为 `borderLeft={false} borderRight={false}`】
//
//  这个组合在目录里出现三次：
//      PlanApprovalRequest 的计划正文
//      PlanApprovalResponse 的反馈
//      ShutdownRejected    的原因
//
//  视觉效果是「上下各一条虚线，像引用块」。为什么不用引号？
//  因为终端里的引号不产生缩进，读者分不清哪里是引用结束。
//  上下两条线能明确圈出范围。'''),

    (72, 'before', '''// 【`if (response.approved)` 分成两条完全独立的返回路径】
//
//  批准和拒绝的 JSX 几乎没有共享部分：
//
//      批准    green 边框、两行文字、没有反馈块
//      拒绝    error 边框、可能有反馈块、末尾还有一句「请修改」
//
//  硬塞进一个组件加三元，会让两边都变得难读。
//  这里的选择是：**两个视觉上不同的东西，就写两遍。**
//
//  代价是重复的 Box 外壳（borderStyle / paddingX / paddingY 都一样）。
//  在这份代码里，重复被容忍，因为「一眼看完一条分支」比「少写六行」重要。'''),

    (116, 'before', '''// 【拒绝态的最后一句是一条**指令**，不是安慰】
//
//      Please revise your plan based on the feedback and call ExitPlanMode again.
//
//  它明确告诉模型下一步该做什么（改完再调 ExitPlanMode）。
//  在 agent 类产品里，**给人看的文案往往同时是给模型看的提示** ——
//  尤其当这条消息最终会回到模型的上下文里时。
//
//  这也是为什么这条文案写得像一个动作序列，而不是「您的计划未通过审批」。'''),

    (137, 'before', '''// 【这个 try 函数接了两个参数 —— senderName 是显示名，不是会员 id】
//
//  因为渲染时需要说「Approved by alice」，
//  而上游手里只有 teammateId。显示名由调用方算好传进来
//  （UserTeammateMessage 用 getDisplayName 处理 leader 这个特例）。
//
//  把「显示名解析」放在调用方，是为了让这个渲染器保持纯函数 ——
//  它不需要知道团队结构，只负责画。'''),

    (190, 'before', '''// 【formatTeammateMessageContent：本目录里唯一一个「总摘要入口」】
//
//  它的职责是：给一段任意的 teammate 消息文本，返回一行能放进列表的描述。
//  四级串联，顺序即优先级：
//
//      plan approval → shutdown → idle → task assignment → teammate_terminated
//
//  最后一行 `return content` 是兜底：认不出来的就原样返回。
//  这样调用方永远拿到一个字符串，不用处理 null。
//
//  ⚠️ 注意这个顺序和 UserTeammateMessage 里的渲染顺序**不完全一致**：
//  渲染那边是 plan → shutdown → task，摘要是 plan → shutdown → idle → task。
//  也就是说 idle 在这里被**当成有内容**（会返回「Agent idle · Last DM: …」），
//  而在渲染那边是**直接不显示**。
//
//  这不是 bug：摘要用在「收件箱里列出有哪些消息」，
//  idle 也是一条消息，得让用户知道；而对话流里它只是噪音。
//  **同一个对象在两种视图里可以有不同的可见性。**'''),

    (209, 'before', '''// 【try/catch 里 jsonParse，catch 里什么都不做】
//
//  注释只写了 `Not JSON`。这是一处**有意的静默**：
//  绝大多数 teammate 消息不是 JSON，走别人的分支是正常的，
//  为「不是 JSON」打日志会把日志淹掉。
//
//  判断标准：**「预期内的失败」不打日志，「不该发生的失败」才打。**
//  对照 AttachmentMessage 那边的 Line 组件、UserPromptMessage 的空文本 ——
//  那里 logError 是因为空文本不该存在。'''),
]
