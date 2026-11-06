ANNOTATIONS = [
    (1, 'before', '''导入用量统计核心逻辑。'''),
    (3, 'after', '''非交互版命令入口，返回纯文本结果。'''),
    (6, 'after', '''结果为消息类型时直接透传返回值。'''),
    (15, 'after', '''其余情况根据是否成功打开浏览器组织提示文案。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
