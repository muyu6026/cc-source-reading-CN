ANNOTATIONS = [
    (1, 'before', '''导入命令类型，约束命令对象形状。'''),
    (2, 'before', '''导入策略允许判断，用于组织策略门禁。'''),
    (9, 'after', '''启用条件：订阅用户且策略允许远程会话。'''),
    (15, 'after', '''用 satisfies 校验对象符合 Command 接口。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
