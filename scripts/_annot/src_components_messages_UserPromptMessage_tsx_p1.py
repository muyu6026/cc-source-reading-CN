# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  UserPromptMessage：用户说的话，默认渲染器（也是最长的一条注释）
// ═══════════════════════════════════════════════════════════════
//
//  这个文件只有 79 行，但第 20-30 行那段注释是全批最有价值的一段：
//  它解释了**为什么必须把用户输入截断到一万字符**，而且理由不是
//  「太长不好看」，是一个具体的性能事故：
//
//    `cat 一个一万一千行的文件 | claude`
//    → 变成一条超长的用户消息
//    → 全屏模式下 Ink 每一帧都要给这个 Text 节点做完整的换行和输出
//    → 按键延迟 500ms 以上
//
//  关键的一句话是：**React.memo 只跳过 React 的渲染，跳不过 Ink 的输出过程。**
//  这一句把「React 层的优化」和「终端输出层的成本」彻底区分开了。
//
//  非全屏模式不受影响，因为它用 <Static> 把消息「打印一次就扔进滚动缓冲区」，
//  不再参与每帧重绘。**同一个组件在两种渲染模式下成本结构完全不同。**'''),

    (26, 'before', '''// 【Head + tail 的截断策略，理由写在第 23 行】
//
//      `{ cat file; echo prompt; } | claude`
//
//  这种用法把大文件和真正的问题拼在一起，问题在**末尾**。
//  如果只留开头（最常见做法），用户会看到一堆文件内容，
//  自己写的问题被截没了 —— 那正好是这条消息里唯一有意义的部分。
//
//  所以两头各留 2500 字符，中间用「… +N lines …」标注省略了多少行。
//
//  这个数字不是美感问题：10,000 字符大约对应 100 行终端输出，
//  再长就明显掉帧；单边 2500 是为了让「开头能看出是什么文件、
//  结尾能看出问了什么」。'''),

    (28, 'before', '''// 【三个常量分开定义，而不是内联成 10000 / 2500 / 2500】
//
//  因为第 68 行的注释算术要用到它们：
//
//      countCharInString(text, 换行, TRUNCATE_HEAD_CHARS)
//      - countCharInString(tail, 换行)
//
//  第一个是「前 2500 个字符里有几个换行」，第二个是「尾部片段里有几个换行」。
//  两者相减 = **被省略掉的行数**。
//
//  为什么不用 text.length 之类算？因为用户关心的是行数不是字符数 ——
//  一条消息被砍掉 8000 字符，如果都在同一行里，用户根本看不出少了什么。
//
//  注意这种算法有个隐含假设：head 的 2500 是**按 UTF-16 码元**切的，
//  可能把一个 emoji 或中文切开。实际影响是那个字符变成乱码，
//  但因为紧接着就是省略号，用户不会在意。'''),

    (39, 'before', '''// 【第 39-44 行的注释是全仓「为什么这么绕」型注释的范例】
//
//  它回答了两个问题：
//
//  一、为什么不直接从父组件接 isBriefOnly？
//      REPL.tsx 传的是 `isBriefOnly={viewedTeammateTask ? false : isBriefOnly}`，
//      但这个 prop 没有一路穿到这里。于是这里**自己去读 viewedAgentTaskId**
//      来复现那个覆盖逻辑。
//      写注释的人明确说了这是「replicate the override」——
//      承认这是绕过，而不是假装设计如此。
//
//  二、为什么要在父层算、而不是在子层算？
//      因为 brief 模式下父层的 Box 要去掉 backgroundColor。
//      **Box 的背景色会无条件涂在子元素背后，子元素无法退出。**
//      于是「要不要背景色」这个决定必须由画背景色的那一层来做。
//
//  第二条是一条终端 UI 的硬约束：没有 z-index、没有透明、没有 backdrop，
//  背景一旦涂上就是涂上了。'''),

    (46, 'before', '''// 【hooks 为什么写在 feature() 三元里面 —— 注释给出的理由是「订阅成本」】
//
//  写法是这样的：
//
//      const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF')
//        ? useAppState(s => s.isBriefOnly)
//        : false
//
//  看起来违反了 hooks 规则（条件调用 hook），但 feature() 是**编译期常量**，
//  打包后这行会折叠成 `const isBriefOnly = useAppState(...)` 或者 `false`，
//  两者都是确定的一条路径。所以这里的 biome-ignore 是有道理的，
//  不是敷衍 lint。
//
//  真正的动机在注释里：**外部构建不该为每条滚动消息付一次 store 订阅**。
//  因为 useSyncExternalStore 的订阅发生在 React 之外，**React.memo 挡不住它** ——
//  哪怕组件被 memo 跳过渲染，订阅照样在，每次全局状态变化都会触发一次回调。
//
//  这一条比「条件 hook 违规」重要得多：
//  **凡是用 useSyncExternalStore 的组件，memo 都失去了意义。**'''),

    (61, 'before', '''// 【useBriefLayout 是一个五条件与，写在一行里，顺序有意义】
//
//      (getKairosActive() || getUserMsgOptIn() && (briefEnvEnabled || 远端开关))
//      && isBriefOnly && !isTranscriptMode && !viewingAgentTaskId
//
//  逐个看：
//     1. getKairosActive()            这一进程是不是 brief 模式
//     2. getUserMsgOptIn() && (...)   用户自己开过，并且（env 或远端开关为真）
//     3. isBriefOnly                  当前这条消息所在的面板是不是 only-brief
//     4. !isTranscriptMode            在 transcript（Ctrl+O 全历史）里不压缩
//     5. !viewingAgentTaskId          正在看某个 agent 的任务时不压缩
//
//  第 4、5 条是「例外」而不是「条件」：**进了全历史视图或正在盯某个 agent，
//  就必须显示完整内容**。所以它们是取反的。
//
//  这种「要不要走特殊布局」的判断，条件一多就容易漏掉例外。
//  写在注释里的顺序（先能力、后场景、最后例外）其实就是心智顺序。'''),

    (72, 'before', '''// 【text 为空时 logError 再返回 null，而不是静默返回】
//
//  一条空的用户消息是**不该存在**的东西 —— 上游某处出了问题。
//  静默返回 null 会让这个 bug 永远藏在「画面正常」的表象里，
//  所以这里打一条错误日志，把它变成一个可统计的事件。
//
//  注意 logError 之后仍然 return null：**渲染层永远不因为数据异常而崩溃**。
//  这是本目录贯穿始终的原则（AssistantToolUseMessage、UserToolSuccessMessage 同理）。'''),
]
