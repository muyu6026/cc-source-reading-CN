ANNOTATIONS = [
    (2, 'after', 'Doctor 是系统诊断屏，位于 screens 目录；命令本身只负责把它挂载出来。'),
    (4, 'after', '命令入口：第三个参数 _args 用下划线前缀，表示此处刻意忽略、暂不使用。'),
    (5, 'after', '包成 Promise.resolve 是因为命令约定要求返回 Promise，这里同步渲染即可满足。'),
]
