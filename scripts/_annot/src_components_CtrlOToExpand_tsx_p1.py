# 批注数据：source/src/components/CtrlOToExpand.tsx
ANNOTATIONS = [
    (10, 'after_block', '''英文注释对应的中文：用 Context 标记是否处于子 agent 内部，避免在子 agent 输出里塞太多「ctrl+o 展开」提示。'''),
    (13, 'after', '''创建子 agent 上下文，默认关闭（非子 agent 环境）。'''),
    (14, 'before', '''提供者组件：把 children 包进 SubAgentContext.Provider 并置为 true。'''),
    (29, 'before', '''内联提示组件：不在子 agent 且不在虚拟列表内时，展示「ctrl+o 展开」提示。'''),
    (47, 'before', '''纯文本版：返回带快捷键的「(ctrl+o 展开)」灰色字符串，供非 React 场景使用。'''),
]
