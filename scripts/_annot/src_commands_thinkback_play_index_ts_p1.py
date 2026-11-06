ANNOTATIONS = [
    (1, 'before', '''导入命令类型，约束命令对象形状。'''),
    (2, 'before', '''导入特性开关判断，用于决定是否启用该命令。'''),
    (4, 'after_block', '''说明这是隐藏的动画播放命令，由 thinkback 技能在生成完成后调用。'''),
    (17, 'after', '''默认导出命令定义。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
