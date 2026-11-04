# -*- coding: utf-8 -*-
# annotations for src/components/agents/new-agent-creation/wizard-steps/ColorStep.tsx (84 lines)
ANNOTATIONS = [
    (13, 'before', '向导的颜色步：选完颜色即在此组装 finalAgent 并进入下一步'),
    (30, 'after', 'Esc 走 goBack 且上下文标 Confirmation：与其它步骤的回退键保持一致'),
    (33, 'after', 'handleConfirm 的缓存依赖把 wizardData 的六个字段逐个列出：任何一项变化都要重建闭包，因为闭包里要读它们'),
    (36, 'after', 'finalAgent 在这一步组装：把向导散落各步的字段拼成 AgentDefinition 形状'),
    (39, 'after', 'getSystemPrompt 存的是函数而非字符串：延迟求值，后续编辑不会被快照成旧值'),
    (41, 'after', 'selectedModel 条件展开：模型未选时连 model 字段都不出现，避免写入 undefined'),
    (44, 'after', 'color 同样条件展开：automatic 表示不指定颜色，此时字段缺省'),
    (67, 'after', '页脚三枚提示用 Byline 串联：↑↓ 导航、Enter 选择，Esc 走 ConfigurableShortcutHint 以支持键位可配置且回退显示 Esc'),
    (72, 'after', 'agentName 回落成 agent：颜色预览要拿名字算稳定色相，未定名时给占位名'),
]
