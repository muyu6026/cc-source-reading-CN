ANNOTATIONS = [
    (1, 'after', """`/cost` 命令的元数据壳：实现体拆到 `cost.ts` 懒加载以缩短启动时间。"""),
    (8, 'after', """命令定义：类型 `local`、描述文案，并让 `isHidden` 在订阅用户（非内部员工）身上隐藏命令。"""),
    (20, 'after', """按需懒加载真正实现 `cost.js`，整段以 `satisfies Command` 收尾。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
