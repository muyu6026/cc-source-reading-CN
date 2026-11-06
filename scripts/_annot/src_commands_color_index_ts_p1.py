ANNOTATIONS = [
    (1, 'after', '''本文件仅保存 `/color` 命令的元数据，实现体懒加载以降低启动耗时。'''),
    (5, 'before', '''导入命令类型。'''),
    (14, 'after', '''用 satisfies 校验对象符合 Command 接口。'''),
    (16, 'after', '''默认导出命令定义。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
