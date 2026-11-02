# 批注数据：source/src/utils/worktreeModeEnabled.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。工作树模式现在对所有用户无条件开启，不再受 GrowthBook 开关控制。'''),
    (10, 'after', '''直接返回 `true`；原先的开关会在缓存填充前返回默认 `false`，从而悄悄吞掉 `--worktree` 参数，所以这里干脆写死。'''),
]
