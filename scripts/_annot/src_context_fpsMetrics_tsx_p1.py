# 源文件: src/context/fpsMetrics.tsx
ANNOTATIONS = [
    (4, 'after', '''取帧率指标的 getter 类型：可能取不到，故返回 FpsMetrics | undefined。'''),
    (5, 'after', '''用 React Context 下发这个 getter，初始值为 undefined（未挂 Provider 时取不到）。'''),
    (10, 'after', '''编译产物（React Compiler 生成）：帧率指标 Provider，把 getFpsMetrics 与 children 包进 Context。'''),
    (18, 'after', '''memo 命中条件：children 或 getFpsMetrics 任一变化才重算整个 Provider 子树。'''),
    (27, 'after', '''消费端 Hook：从 Context 取出 getter，业务组件用它就能实时读取帧率指标。'''),
]
