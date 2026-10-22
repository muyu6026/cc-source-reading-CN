# -*- coding: utf-8 -*-
"""BriefTool/prompt.ts 第 1 部分"""

ANNOTATIONS = [
    (4, 'after', '''现名 SendUserMessage，旧名 Brief 保留为别名（ LEGACY_BRIEF_TOOL_NAME，
buildTool 的 aliases 接收，历史会话回放靠它匹配）。'''),
    (6, 'before', '''BRIEF_TOOL_PROMPT：核心话术——「用户真正会读的消息从这里走」。
工具外的文本在详情视图里可见，但多数用户不会展开；答案要写进 message。'''),
    (22, 'after', '''BRIEF_PROACTIVE_SECTION：助手模式的系统提示词段。要点：
① 每次用户说话都要经 SendUserMessage 回复（哪怕只是 hi/thanks）；
② 能立刻答就答，要查就先 ack 一行（不然用户盯着转圈）；
③ 长任务按 ack → 工作 → 结果，中间的 checkpoint 必须携带信息（决策/意外/阶段边界），
   「running tests...」这类填充物不算；
④ 消息紧凑：决策、file:line、PR 号，永远用第二人称。'''),
]
