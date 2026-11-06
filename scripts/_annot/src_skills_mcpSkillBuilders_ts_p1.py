# 批注数据：source/src/skills/mcpSkillBuilders.ts
# slug: src_skills_mcpSkillBuilders_ts

ANNOTATIONS = [
    (1, 'after', '仅做类型导入，不引入运行时依赖；本模块作为依赖图叶子，避免形成循环。'),
    (6, 'after', '注释：MCP 技能发现所需的两个 loadSkillsDir 函数的写一次注册表，并解释为何要拆出本叶子模块。'),
    (26, 'after', 'MCPSkillBuilders 类型：持有 createSkillCommand 与 parseSkillFrontmatterFields 两函数的引用。'),
    (31, 'after', '模块级单例 builders，初始为 null。'),
    (33, 'after', '注册函数：在 loadSkillsDir 模块初始化时写入两函数引用。'),
    (37, 'after', '获取函数：未注册时抛出明确错误，提示 loadSkillsDir 尚未求值。'),
    (38, 'after', '防御性检查：builders 为空即说明依赖尚未初始化。'),
    (43, 'after', '已注册则返回缓存的构建器引用。'),
]
