# -*- coding: utf-8 -*-
"""批注数据：src/tools/SkillTool/UI.tsx（127 行）"""

ANNOTATIONS = [
    (18, 'after', "非 verbose 模式下进度只显示最后 3 条，其余折叠成 +N more tool use。fork 技能可能跑几十个工具调用，全量展示会把会话刷爆。"),
    (46, 'after', "结果渲染按模式分流：forked 完成只显示一行 Done 徽标（结果全文已在 tool_result 里，UI 不重复）；inline 显示 Successfully loaded skill + N tools allowed + 模型覆盖（有的话）。两分支都走 Byline 单行排版。"),
    (61, 'after', "工具调用行显示技能名；来自遗留 /commands 目录的技能显示成 /name 形式（用 loadedFrom 标记区分）——让用户看得出这个技能的出处是新旧哪套机制。"),
    (93, 'after', "进度渲染复用子代理那套：SubAgentProvider 提供上下文，每条消息强制 height 1 + overflow hidden（超过一行的工具输出在摘要里只露一行），buildSubagentLookups 算出进行中的工具 ID 供消息组件标记。无进度时显示 Initializing…。"),
    (110, 'after', "被拒绝时也要先渲染进度——用户拒绝的是「继续跑」，之前已经跑出来的部分工作照常展示，下面再接拒绝横幅。错误渲染同构（进度 + Fallback 错误组件）。"),
]
