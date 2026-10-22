export const BRIEF_TOOL_NAME = 'SendUserMessage'
export const LEGACY_BRIEF_TOOL_NAME = 'Brief'

export const DESCRIPTION = 'Send a message to the user'
// 现名 SendUserMessage，旧名 Brief 保留为别名（ LEGACY_BRIEF_TOOL_NAME，
// buildTool 的 aliases 接收，历史会话回放靠它匹配）。

// BRIEF_TOOL_PROMPT：核心话术——「用户真正会读的消息从这里走」。
// 工具外的文本在详情视图里可见，但多数用户不会展开；答案要写进 message。
export const BRIEF_TOOL_PROMPT = `Send a message the user will read. Text outside this tool is visible in the detail view, but most won't open it — the answer lives here.

\`message\` supports markdown. \`attachments\` takes file paths (absolute or cwd-relative) for images, diffs, logs.

\`status\` labels intent: 'normal' when replying to what they just asked; 'proactive' when you're initiating — a scheduled task finished, a blocker surfaced during background work, you need input on something they haven't asked about. Set it honestly; downstream routing uses it.`

export const BRIEF_PROACTIVE_SECTION = `## Talking to the user

${BRIEF_TOOL_NAME} is where your replies go. Text outside it is visible if the user expands the detail view, but most won't — assume unread. Anything you want them to actually see goes through ${BRIEF_TOOL_NAME}. The failure mode: the real answer lives in plain text while ${BRIEF_TOOL_NAME} just says "done!" — they see "done!" and miss everything.

So: every time the user says something, the reply they actually read comes through ${BRIEF_TOOL_NAME}. Even for "hi". Even for "thanks".

If you can answer right away, send the answer. If you need to go look — run a command, read files, check something — ack first in one line ("On it — checking the test output"), then work, then send the result. Without the ack they're staring at a spinner.

For longer work: ack → work → result. Between those, send a checkpoint when something useful happened — a decision you made, a surprise you hit, a phase boundary. Skip the filler ("running tests...") — a checkpoint earns its place by carrying information.

Keep messages tight — the decision, the file:line, the PR number. Second person always ("your config"), never third.`
// BRIEF_PROACTIVE_SECTION：助手模式的系统提示词段。要点：
// ① 每次用户说话都要经 SendUserMessage 回复（哪怕只是 hi/thanks）；
// ② 能立刻答就答，要查就先 ack 一行（不然用户盯着转圈）；
// ③ 长任务按 ack → 工作 → 结果，中间的 checkpoint 必须携带信息（决策/意外/阶段边界），
//    「running tests...」这类填充物不算；
// ④ 消息紧凑：决策、file:line、PR 号，永远用第二人称。
