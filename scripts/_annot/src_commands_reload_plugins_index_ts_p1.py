ANNOTATIONS = [
    (1, 'after', '''本文件是 `/reload-plugins` 命令的元数据，描述三层刷新的作用，实现体懒加载。'''),
    (5, 'before', '''导入命令类型，约束命令对象形状。'''),
    (16, 'after', '''用 satisfies 校验对象符合 Command 接口契约。'''),
    (18, 'after', '''默认导出命令定义。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
