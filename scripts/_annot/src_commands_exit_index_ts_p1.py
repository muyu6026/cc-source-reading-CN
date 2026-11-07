# 批注数据：source/src/commands/exit/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `exit` 命令：在交互式 REPL 里退出当前会话。
命令对象用 `satisfies Command` 在编译期校验形状，最后默认导出。'''),
    (4, 'after', '''`type: 'local-jsx'` 表示该命令在本地渲染一段交互界面，
而不是在后台静默执行，适用于需要点击确认的短操作。'''),
    (6, 'after', '''`aliases` 给命令起别名，用户输入 `quit` 等价于 `exit`，降低记忆成本。'''),
    (9, 'after', '''`load` 用动态 `import()` 按需加载真正的命令实现，
平时不进主包，做到代码分割、加快启动。'''),
    (10, 'after', '''`satisfies Command` 只做编译期接口校验，不改变运行时类型；
对象因此可被命令注册表直接引用。'''),
]
