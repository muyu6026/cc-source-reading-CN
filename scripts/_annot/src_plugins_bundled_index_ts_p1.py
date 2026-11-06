ANNOTATIONS = [
    (1, 'after', """内置插件初始化模块：说明哪些功能应作为可开关的内置插件，哪些是自动启用的捆绑技能。"""),
    (20, 'after', """`initBuiltinPlugins`：CLI 启动时调用，目前尚未注册任何内置插件，仅为可开关骨架。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
