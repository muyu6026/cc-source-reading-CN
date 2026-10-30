# 批注数据：src/utils/mcpInstructionsDelta.ts
# slug: src_utils_mcpInstructionsDelta_ts
ANNOTATIONS = [
    (8, 'after', '''本模块计算 MCP 服务器指令的「增量附件」：对比当前已连接的服务器与本次会话已播报过的服务器，得出新增/移除的指令块，用于把新接入服务器的指令追加进系统提示。'''),
    (10, 'after', '''增量结果结构：addedNames 为新增服务器名（用于无状态扫描重建），addedBlocks 为对应的「## 名称 加换行 指令」文本块，removedNames 为移除的服务器名。'''),
    (18, 'after', '''客户端自带的指令块，用于在服务器自身 InitializeResult.instructions 之外（或替代之）补充上下文，例如 claude-in-chrome 携带服务器不知道的信息。'''),
    (29, 'after', '''开关函数——决定是否通过持久化增量附件播报 MCP 指令。环境变量 CLAUDE_CODE_MCP_INSTR_DELTA 优先生效（true/false），否则看 USER_TYPE=ant 或 GrowthBook 灰度开关 tengu_basalt_3kr。'''),
    (46, 'after', '''核心 diff 函数——扫描消息历史里的已播报附件、收集 connected 服务器、合并服务器指令与客户端补充指令，产出本次新增/移除的服务器名与指令块。指令在连接生命周期内不可变，所以只按服务器名 diff，不按内容。'''),
    (60, 'after', '''先建一个集合记录本会话已播报过的服务器名：遍历附件时，addedNames 加入、removedNames 删除。'''),
    (79, 'after', '''收集需要播报的服务器——同一服务器可同时有「服务器自带指令」和「客户端补充块」，二者合并。'''),
    (94, 'after', '''遍历所有待播报块，找出尚未播报过的（announced 里没有的）作为新增项。'''),
    (99, 'after_block', '''对「曾经播报过、现已不连接」的服务器记为 removed。已连接服务器不会出现「播报过但无指令」的情况（InitializeResult 不可变），故历史即为历史、不做回溯撤销。'''),
    (110, 'after', '''无新增也无移除时返回 null，表示本次没有变化、无需写附件。'''),
    (114, 'after', '''上报遥测事件 tengu_mcp_instructions_pool_change，字段与 deferred_tools_delta 一致（同款「生产环境扫描崩溃」问题、同款附件持久化路径）。'''),
    (124, 'after', '''新增项按服务器名字母序排序后返回，保证输出稳定、可复现。'''),
]
