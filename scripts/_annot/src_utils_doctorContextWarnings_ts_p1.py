# 批注数据：source/src/utils/doctorContextWarnings.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件是 doctor 命令的「上下文告警」检查：扫描 CLAUDE.md 过大、智能体描述过长、MCP 工具过多、权限规则不可达四类问题，给出警告级诊断。"""),
    (21, 'after', """注：MCP_TOOLS_THRESHOLD 是 MCP 工具上下文的告警阈值（约两万五千 token），超过就提示用户精简。"""),
    (23, 'before', """注：ContextWarning 是一条告警的结构：类型、严重度、消息、明细、当前值与阈值；ContextWarnings 把四类告警打包。"""),
    (36, 'before', """注：ContextWarnings 汇总四种可能的告警（CLAUDE.md / 智能体描述 / MCP 工具 / 不可达规则），任一为 null 表示该项正常。"""),
    (43, 'before', """注：checkClaudeMdFiles 找出超过单文件字符上限的 CLAUDE.md，按体积倒序列出明细，超标即告警。"""),
    (73, 'before', """注：checkAgentDescriptions 统计所有自定义智能体的描述 token 总和，超标时列出最费的几个智能体。"""),
    (119, 'before', """注：checkMcpTools 统计 MCP 工具上下文用量，按服务器分组排序，列出最费 token 的几个；计数失败则退化为按字符估算。"""),
    (212, 'before', """注：checkUnreachableRules 调用影子规则检测，找出被更宽规则盖掉、永远不生效的权限规则，并给出修复建议。"""),
    (246, 'before', """注：checkContextWarnings 并行跑上面四个检查，汇总成 ContextWarnings 一并返回。"""),
]
