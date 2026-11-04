# -*- coding: utf-8 -*-
# annotations for src/components/agents/new-agent-creation/CreateAgentWizard.tsx (97 lines)
ANNOTATIONS = [
    (26, 'before', '创建 agent 的多步向导组装器：把各步骤组件按顺序塞进 WizardProvider，自身几乎无逻辑'),
    (36, 'after', 'TypeStep/ToolsStep 用闭包包一层：步骤数组要求组件类型，闭包按依赖缓存（$[0]!==existingAgents 才重建），避免每次渲染产生新组件引用导致步骤状态重置'),
    (52, 'after', 'MemoryStep 仅在 isAutoMemoryEnabled 时插入——特性探测结果被哨兵缓存，整个生命周期只求值一次'),
    (59, 'after', 'ConfirmStepWrapper 是终点步骤：拿到 tools/existingAgents/onComplete 生成最终配置'),
    (69, 'after', '完整步骤序列：Location→Method→Generate→Type→Prompt→Description→Tools→Model→Color→[Memory?]→Confirm，Memory 是条件插入的可选步'),
    (80, 'after', 'initialData 用空对象哨兵：向导初始数据从空开始，缓存同一引用避免 WizardProvider 每次收到新对象'),
    (87, 'after', 'onComplete 传的是 _temp 空函数——真正的完成回调由 ConfirmStepWrapper 内部处理，provider 层只是占位'),
    (96, 'before', '_temp 即空箭头函数 ()=>{}：空实现，编译器把内联空箭头函数提取成顶层函数以获得稳定引用'),
]
