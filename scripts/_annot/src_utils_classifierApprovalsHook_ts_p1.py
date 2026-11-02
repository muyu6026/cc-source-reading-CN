# source: src/utils/classifierApprovalsHook.ts
ANNOTATIONS = [
    (1, 'before', '''一个 React 钩子，从 classifierApprovals 的纯状态库里订阅「某个工具是否正在被分类器检查」，让 UI 能据此显示状态，而不必把 React 拉进 print.ts 这类纯状态导入方。'''),
    (17, 'after', '''实现：用 useSyncExternalStore 订阅 subscribeClassifierChecking，并以 isClassifierChecking(toolUseID) 作为快照读取函数，返回布尔值。'''),
]
