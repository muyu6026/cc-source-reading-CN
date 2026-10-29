# 数据文件：src/utils/sideQuestion.ts
SOURCE_PATH = 'src/utils/sideQuestion.ts'

ANNOTATIONS = [
    (1, 'after', '''本文件实现「/btw」侧问功能：在不打断主智能体上下文的前提下，用派生智能体快速回答追问；复用父级提示缓存，响应与主对话隔离。'''),
    (16, 'after', '''BTW_PATTERN 匹配输入行首的「/btw」关键词（大小写不敏感、词边界），用于界面高亮触发位置。'''),
    (41, 'after', '''findBtwTriggerPositions：扫描文本里所有「/btw」出现的位置，返回每个匹配的起止偏移，供 UI 高亮。'''),
    (46, 'after', '''SideQuestionResult 类型：侧问结果含回答文本（可能为 null）与本次用量统计。'''),
    (102, 'after', '''runSideQuestion：用 forked agent 跑侧问；包裹系统提示禁止其使用任何工具、限定单轮，并跳过缓存写入以复用父级缓存键。'''),
    (155, 'after', '''extractSideQuestionResponse：从按内容块拆分的消息里抽取文本；若无文本则回退到工具调用或 API 错误信息；逐块消息设计避免了误取只含思考块的首条消息。'''),
]
