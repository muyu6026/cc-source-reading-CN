# 批注数据：src/utils/processUserInput/processTextPrompt.ts
ANNOTATIONS = [
    (19, 'after', '''把用户输入整理成消息列表。支持字符串（CLI）与内容块数组（SDK / VS Code）两种形态，并附带图片与附件。'''),
    (31, 'after', '''生成 promptId 并写入全局状态，作为本次交互的追踪标识。'''),
    (50, 'after', '''对两种输入形态都发出 user_prompt 的 OTEL 事件；数组输入取最后一个文本块作为实际提示（用户消息排在附件上下文之后）。'''),
    (59, 'after', '''判断输入是拒绝类还是继续类关键词，用于埋点统计。'''),
    (67, 'after', '''有粘贴图片时，把文本与图片拼成一条用户消息，置 shouldQuery 为真。'''),
    (89, 'after', '''无图片时直接把原始输入封成用户消息返回。'''),
]
