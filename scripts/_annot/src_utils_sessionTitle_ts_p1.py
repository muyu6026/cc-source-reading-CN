# 批注数据：src/utils/sessionTitle.ts
# slug: src_utils_sessionTitle_ts
ANNOTATIONS = [
    (1, 'after', '''用 Haiku 生成会话标题；做成依赖极少的独立模块，便于从 print.ts（SDK 控制请求处理器）引入而不拉进 teleport.tsx 那套 React/chalk/git 依赖链。此前各端各有标题生成器，本模块是唯一的 AI 标题真源。'''),
    (24, 'after', '''本模块依赖：zod 校验、bootstrap 状态、遥测、Haiku 查询、消息工具、JSON 安全解析、懒加载 schema、systemPrompt 类型等。'''),
    (26, 'after', '''取作标题输入的对话文本上限：超长时只取最后 1000 字符，让近期上下文优先。'''),
    (28, 'after', '''把消息数组压平为单个文本串供 Haiku 生成标题；跳过元消息/非人消息，超长时截取尾部 1000 字符。'''),
    (36, 'after', '''只保留 user 与 assistant 消息，跳过 system 等。'''),
    (50, 'after', '''把各文本片段用换行拼接成一段。'''),
    (68, 'after', '''这是发给 Haiku 的标题提示词：要求生成三到七词的 sentence-case 标题，并给了好坏示例。'''),
    (70, 'after', '''用懒加载 schema 定义标题结构：只含一个 title 字符串字段。'''),
    (72, 'after', '''从描述或首条消息生成 sentence-case 会话标题；出错或 Haiku 返回不可解析时返回 null。'''),
    (82, 'after', '''参数 description 为用户的首条消息/描述，signal 用于取消。'''),
    (83, 'after', '''先 trim，空串直接返回 null，不浪费一次模型调用。'''),
    (114, 'after', '''取出 Haiku 返回的文本内容。'''),
    (116, 'after', '''用 schema 安全解析，成功则 trim 后作为标题，否则回退 null。'''),
    (119, 'after', '''上报标题生成是否成功。'''),
    (122, 'after', '''异常时记日志并回退 null，不让标题生成中断会话建立。'''),
]
