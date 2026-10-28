# 批注数据：source/src/utils/hooks/skillImprovement.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件实现「技能自我改进」钩子：在用户执行项目级技能时，用一个小模型从最近对话里抽取可固化的偏好与修正，并可选地由侧信道模型改写 SKILL.md。"""),
    (31, 'before', """注：TURN_BATCH_SIZE 控制每隔多少条用户消息才跑一次分析；SkillUpdate 描述一次改进建议的三要素：改哪段、改什么、由哪条消息触发。"""),
    (39, 'before', """注：formatRecentMessages 把最近若干用户/助手消息压成纯文本摘要（每条最多 500 字符），喂给改进模型。"""),
    (68, 'before', """注：createSkillImprovementHook 构造采样后钩子：只在主线程、且存在项目级技能、且攒够一批用户消息时才运行，调用小模型抽取改进点。"""),
    (94, 'before', """注：buildMessages 只分析自上次检查以来的新消息，把技能定义与近期对话拼成提示词，让模型输出 updates 标签里的 JSON 数组。"""),
    (146, 'before', """注：logResult 在命中改进时上报分析事件，并把建议写回 AppState，供 UI 提示用户「技能可改进」。"""),
    (175, 'before', """注：initSkillImprovement 在功能开关与灰度命中时，把上述钩子注册为采样后钩子。"""),
    (188, 'before', """注：applySkillImprovement 是「发射后不管」的落地函数：读现有 SKILL.md，让模型把改进自然并入，再写回磁盘；全程不阻塞主对话。"""),
]
