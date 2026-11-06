ANNOTATIONS = [
    (1, 'before', '''导入命令类型，约束命令对象形状。'''),
    (2, 'before', '''导入命令是否立即执行的判断函数。'''),
    (8, 'after', '''描述动态拼接当前模型名，让用户看到正在使用的模型。'''),
    (16, 'after', '''用 satisfies 校验对象符合 Command 接口。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
