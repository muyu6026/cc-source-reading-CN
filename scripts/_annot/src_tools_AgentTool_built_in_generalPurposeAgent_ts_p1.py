ANNOTATIONS = [
    (3, 'after', r'''SHARED_PREFIX：身份声明 + 完成度判据——「完整完成任务，别镀金也别半吊子」，一句话同时防过度工程和敷衍。'''),
    (16, 'after', r'''SHARED_GUIDELINES 四条强导：不知道东西在哪就广搜再窄化（多个搜索策略）；多位置、多命名惯例地彻底查；绝不主动建文件（优先改现有的）；绝不主动建文档（*.md/README 除非明确要求）。后两条是给所有 subagent 的通用紧箍——LLM 最爱顺手建 README。'''),
    (18, 'after', r'''absolute-path 和 emoji 指引不在这写——由 enhanceSystemPromptWithEnvDetails 统一追加（环境相关提示Single source）。'''),
    (23, 'after', r'''getGeneralPurposeSystemPrompt：prefix + 简洁报告要求（调用方会转述给用户，只要要点）+ guidelines。注意报告要求写的是「what was done and any key findings」——不是给用户的最终答复，是给父 agent 的素材。'''),
    (32, 'after', r'''model 故意不声明：走 getDefaultSubagentModel()——默认 subagent 模型随部署/实验变，写死就和这套机制打架。'''),
    (34, 'after', r'''GENERAL_PURPOSE_AGENT：tools ['*'] 全工具池——general-purpose 是全能兜底 agent（研究/搜索/多步任务都接），与 Explore 的窄面互补。'''),
]
