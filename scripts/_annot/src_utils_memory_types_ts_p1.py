# 批注数据：source/src/utils/memory/types.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。集中定义记忆类型（`MemoryType`）的可取值列表，并按编译特性决定是否加入团队记忆类型。'''),
    (11, 'after', '''用 `as const` 锁死这个字符串字面量联合，顺序即展示顺序；`feature('TEAMMEM')` 为真时才把 `TeamMem` 追加进去。'''),
    (12, 'after', '''由上面的取值数组派生出 `MemoryType` 类型，新增类型只需改数组一处。'''),
]
