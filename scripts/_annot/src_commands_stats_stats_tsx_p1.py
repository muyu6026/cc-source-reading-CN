# 批注数据：src/commands/stats/stats.tsx
ANNOTATIONS = [
    (1, 'after', '''`/stats` 命令的本地 JSX 渲染入口，用于展示使用统计面板。'''),
    (3, 'after', '''用 `LocalJSXCommandCall` 类型注解 `call`，保证命令入口参数签名与系统契约一致。'''),
    (6, 'after', '''返回 `Stats` 统计组件，`onDone` 作为关闭回调，用户关闭面板即结束命令。'''),
]
