ANNOTATIONS = [
    (1, 'before',
     "抽取 agent 是主对话的完美分叉——同系统提示、同消息前缀。主 agent 的系统提示里永远带着完整保存指令；主 agent 自己写记忆时 extractMemories.ts 会跳过该轮（hasMemoryWritesSince），所以这个 prompt 只在主 agent 没写时触发，此处的保存标准与系统提示无害地重叠，不需要跟它对齐。"),
    (44, 'after',
     "opener 三件事：①把现有记忆清单附上（先查再写，更新而不是造重复）；②把工具白名单如实写进 prompt——与 canUseTool 实际放行的一一对应，含 rm 明确不许、其他工具（MCP/Agent/可写 Bash）一律 deny；③轮次预算策略：Edit 要求先 Read 同一文件，所以「第一轮并行发全部 Read、第二轮并行发全部 Write/Edit，绝不跨轮交叉」才是 5 轮硬顶下的最优解；并明令禁止调查验证（不 grep 源码、不读码、不跑 git）。"),
    (93, 'after',
     "auto-only 版：四类型分类（TYPES_SECTION_INDIVIDUAL）+ 明确不保存什么。保存分两步：Step 1 写话题文件（frontmatter 格式照 MEMORY_FRONTMATTER_EXAMPLE）；Step 2 在 MEMORY.md 加一行指针——MEMORY.md 是索引不是记忆，每条一行 <150 字符、无 frontmatter、永不把记忆正文写进去；它常驻系统提示，200 行之后会被截断所以必须精简。skipIndex 开关（tengu_moth_copse）开着时整段 Step 2 消失，只写文件不维护索引。"),
    (112, 'after',
     "防御性回退：TEAMMEM 没开时直接调 auto-only 版——调用方（extractMemories.ts 的 402-413）理论上已经判过，但这里不信任上游，自己再判一次。"),
    (141, 'after',
     "combined 版的保存步骤同样是两步，但每个目录（private/team）各有一份 MEMORY.md 索引，两份都常驻系统提示、都受 200 行截断约束——写哪份取决于话题文件的 scope。"),
    (153, 'after',
     "与 auto-only 的差异只有两处：TYPES_SECTION_COMBINED 把「选 private 还是 team 目录」的 scope 指导直接烤进每个类型块（不需要单独路由段）；外加一条团队记忆安全禁令——绝不在共享团队记忆里存 API key、用户凭据这类敏感数据。这条是 prompt 层劝退，与 secretScanner.ts 的扫描层硬拦（PSR M22174）互为互补防线。"),
]
