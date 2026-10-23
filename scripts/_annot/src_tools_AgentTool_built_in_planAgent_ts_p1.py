ANNOTATIONS = [
    (14, 'before', r'''getPlanV2SystemPrompt：第二代 plan agent 提示词生成器（V2 后缀是版本标记）。'''),
    (19, 'after', r'''searchToolsHint embedded 分支同 Explore：ant 构建用 find/grep via Bash，否则用 Glob/Grep。'''),
    (71, 'after', r'''提示词结构：READ-ONLY 七禁（与 Explore 同款）→ 四步流程（理解需求并应用给定视角 → 彻底探索找现有模式/类似功能/代码路径 → 按视角设计方案考虑权衡 → 细化步骤/依赖/风险）→ 输出必须以 Critical Files for Implementation 结尾（列 3-5 个最关键文件）——调用方按这个清单派活，所以这是硬性输出契约。Bash 白名单与 Explore 一致。'''),
    (92, 'after', r'''PLAN_AGENT：disallowedTools 五件同 Explore；tools 直接引用 EXPLORE_AGENT.tools（同一个数组对象——两份禁表永远一致，不会漂移）；model 'inherit'（规划是难活，用主模型）；omitClaudeMd: true 但注释说明与 Explore 的理由不同——Plan 需要规约时自己读 CLAUDE.md，从上下文里去掉只是省 token 不挡访问。'''),
]
