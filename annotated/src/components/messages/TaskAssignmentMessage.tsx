// ═══════════════════════════════════════════════════════════════
//  TaskAssignmentMessage：「PM 给我派活」在收件人屏幕上的样子
// ═══════════════════════════════════════════════════════════════
//
//  多 agent 协作里，团队负责人会给成员派任务。派活这件事本身是一条
//  mailbox 消息（纯文本），到达成员那边时要被**渲染成一张卡片**。
//
//  这个文件提供三样东西，且都是「同一个判断、三种消费场景」：
//
//      tryRenderTaskAssignmentMessage   →  完整卡片（对话流里）
//      getTaskAssignmentSummary         →  一行摘要（收件箱、列表里）
//
//  同一个 isTaskAssignment(content) 被调用两次，因为两种场景拿到的
//  是同一个字符串，只是展示密度不同。
//
//  这是 mailbox 消息的标准三件套，ShutdownMessage、PlanApprovalMessage
//  用的是完全相同的结构 —— 三个文件互为模板。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { isTaskAssignment, type TaskAssignmentMessage } from '../../utils/teammateMailbox.js';
type Props = {
  assignment: TaskAssignmentMessage;
};

/**
 * Renders a task assignment with a cyan border (team-related color).
 */
// 【颜色名 cyan_FOR_SUBAGENTS_ONLY 是一个带警告的命名】
//
//  名字本身就是注释：**这个颜色只给子 agent 看**。
//
//  为什么要有这么个约束？因为青色在主界面上已经被别的语义占了
//  （比如「建议」是 suggestion 色）。如果团队消息也用普通的 cyan，
//  用户会分不清「这是系统建议」还是「这是某个 agent 在跟我说话」。
//
//  用这种「别扭但自我解释」的常量名，是防止后来人随手复用的手段。
//  同类命名在这批文件里还有 `bashMessageBackgroundColor`、
//  `memoryBackgroundColor` —— 都是语义化到具体用途的颜色名。
export function TaskAssignmentDisplay(t0) {
  const $ = _c(11);
  const {
    assignment
  } = t0;
  let t1;
// 【三个属性在缓存里是分开的键，而不是整个 assignment 对象】
//
//  `$[0] !== assignment.assignedBy || $[1] !== assignment.taskId`
//
//  如果写成 `$[0] !== assignment`，那么每次上游构造新对象
//  （哪怕内容一模一样）都会触发重算。取到字段级，
//  就变成「字段真变了才重算」。
//
//  这个模式在本批出现得非常多，本质是把 memo 的比较粒度压到最细。
//  代价是代码难看；收益是消息列表滚动时几乎不重算。
  if ($[0] !== assignment.assignedBy || $[1] !== assignment.taskId) {
    t1 = <Box marginBottom={1}><Text color="cyan_FOR_SUBAGENTS_ONLY" bold={true}>Task #{assignment.taskId} assigned by {assignment.assignedBy}</Text></Box>;
    $[0] = assignment.assignedBy;
    $[1] = assignment.taskId;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== assignment.subject) {
    t2 = <Box><Text bold={true}>{assignment.subject}</Text></Box>;
    $[3] = assignment.subject;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== assignment.description) {
// 【`assignment.description && <Box>…</Box>` —— 空字符串会渲染成 ''】
//
//  注意这里的结果参与了缓存比较（$[6] 存它）。当 description 是空串时，
//  这个表达式求值为空串本身（不是 null），React 会把空串渲染成空文本 ——
//  在终端里等于没有输出。
//
//  这种行为依赖一个细节：**空字符串是 React 合法的 ReactNode**，
//  而 false / null / undefined 会被忽略。所以 `a && b` 在 a 是 "" 时
//  返回 ""，在 a 是 null 时返回 null，两者在视觉上都是「没有」。
//
//  不需要为此改成三元 —— 但要知道它为什么不出错。
    t3 = assignment.description && <Box marginTop={1}><Text dimColor={true}>{assignment.description}</Text></Box>;
    $[5] = assignment.description;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t1 || $[8] !== t2 || $[9] !== t3) {
    t4 = <Box flexDirection="column" marginY={1}><Box borderStyle="round" borderColor="cyan_FOR_SUBAGENTS_ONLY" flexDirection="column" paddingX={1} paddingY={1}>{t1}{t2}{t3}</Box></Box>;
    $[7] = t1;
    $[8] = t2;
    $[9] = t3;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  return t4;
}

/**
 * Try to parse and render a task assignment message from raw content.
 */
// 【解析失败不抛异常，返回 null 交给调用方继续试下一个渲染器】
//
//  注意这个函数名以 try 开头，是这一族渲染器的命名约定：
//  **try 型函数负责「是不是我的」，不是「渲染我」。**
//
//  调用方（UserTeammateMessage 第 85-99 行）连着试三个：
//  plan approval → shutdown → task assignment，
//  每个返回 null 就试下一个。顺序即优先级。
//
//  这种链式 try 的好处是新增一种消息类型时，只要插进链里，
//  不用改任何既有判断。坏处是**顺序要小心**：
//  两条内容都能匹配的模式，会永远被前面那个吃掉。
export function tryRenderTaskAssignmentMessage(content: string): React.ReactNode | null {
  const assignment = isTaskAssignment(content);
  if (assignment) {
    return <TaskAssignmentDisplay assignment={assignment} />;
  }
  return null;
}

/**
 * Get a brief summary text for a task assignment message.
 */
// 【摘要函数和第 58 行的渲染函数读的是同一份数据，格式却完全不同】
//
//      卡片    "Task #12 assigned by leader" + 加粗标题 + 灰色描述
//      摘要    "[Task Assigned] #12 - 修登录 bug"
//
//  摘要用方括号前缀（[Task Assigned] / [Plan Approved] / [Shutdown Request]），
//  因为这个字符串会被拼进收件箱列表的一行里，
//  需要一眼分辨类型 —— 而没有空间画边框。
//
//  设计上这是一条经验：**同一份数据要准备两种密度**，
//  一种是「有空间时好看」，一种是「没空间时可扫」。
export function getTaskAssignmentSummary(content: string): string | null {
  const assignment = isTaskAssignment(content);
  if (assignment) {
    return `[Task Assigned] #${assignment.taskId} - ${assignment.subject}`;
  }
  return null;
}
// 原文件此处有一行 5968 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。