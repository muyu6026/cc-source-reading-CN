# 批注数据：source/src/utils/contextAnalysis.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件负责「上下文用量分析」——把一次对话里所有消息的 token 消耗按来源拆解成统计项，再转成上报指标。被 doctor 命令与遥测使用。"""),
    (15, 'before', """注：TokenStats 是统计结果的载体：用 Map 分别累计各类工具的请求/结果 token、人类/助手消息、本地命令输出、附件与重复读文件，total 是总和。"""),
    (27, 'before', """注：analyzeContext 是主入口，遍历消息，先抽出附件，再归一化后逐条处理，最后汇总重复读，返回一份 TokenStats。"""),
    (54, 'after', """注：把原始消息交给 normalizeMessagesForAPI 统一成 API 形态，再逐条扫描；字符串内容与结构化 content 走两条分支。"""),
    (99, 'before', """注：processBlock 处理单条内容块，按 block.type 用 switch 分流：文本、工具调用、工具结果，其余类型只计入 other。"""),
    (110, 'before', """注：这里按内容块类型做分类统计；工具调用会顺手记下 Read 工具读过的文件路径，供后面算「重复读」使用。"""),
    (191, 'before', """注：increment 是个小工具：往 Map 里累加某个键的 token 数，键不存在时从 0 起算。"""),
    (195, 'before', """注：tokenStatsToStatsigMetrics 把 TokenStats 摊平成一层平铺指标字典（带各种百分比），便于上报到 Statsig。"""),
    (243, 'after', """注：把工具请求/结果的 token 各自求和，后面再换算成占总量百分比，用于诊断「哪类工具最费上下文」。"""),
]
