ANNOTATIONS = [
    (13, 'before', r'''areExplorePlanAgentsEnabled：Explore/Plan 两个只读搜索 agent 的总开关。'''),
    (20, 'after', r'''3P 默认 true：Bedrock/Vertex 保持启用（与实验前外部行为一致——不偷偷改用户可见的工具面）；A/B 治疗组设 false 测量移除影响。kill-switch 是 GrowthBook 的 tengu_amber_stoat。'''),
    (22, 'before', r'''getBuiltInAgents：内置 agent 清单的组装处——多处环境判断决定最终列表。'''),
    (30, 'after', r'''SDK 白 slate 出口：CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS + 非交互会话双条件才返回空——SDK 用户可以只要空工具面自己搭；交互用户永远有内置 agent（免得把自己绕晕）。'''),
    (43, 'after', r'''coordinator 模式用函数体内 require 而不是顶部 import：coordinatorMode 依赖 tools → AgentTool → 本文件，模块初始化期直接 import 会踩循环依赖。eslint-disable 是明知故犯——这里懒加载是唯一解。'''),
    (48, 'after', r'''常驻两个：GENERAL_PURPOSE_AGENT（默认全能）+ STATUSLINE_SETUP_AGENT（状态栏安装，one-shot）。'''),
    (52, 'after', r'''Explore/Plan 受 areExplorePlanAgentsEnabled 门控——A/B 实验的控制组就没有这两个。'''),
    (62, 'after', r'''Code Guide agent 只对非 SDK 入口注册（sdk-ts / sdk-py / sdk-cli 排除）——文档问答 agent 对编程式消费者没用，还占工具表空间。'''),
    (69, 'after', r'''VERIFICATION_AGENT 双门控：feature('VERIFICATION_AGENT') + GrowthBook tengu_hive_evidence 默认 false——实验性 agent，默认不露面。'''),
    (72, 'after', r'''返回顺序即 UI 显示顺序：general-purpose 打头，实验性 agent 垫底。'''),
]
