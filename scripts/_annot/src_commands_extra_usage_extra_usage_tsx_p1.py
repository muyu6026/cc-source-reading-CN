ANNOTATIONS = [
    (1, 'before', '''引入 React 运行时。'''),
    (6, 'after', '''命令入口：先跑用量统计，再决定渲染登录界面或直接提示。'''),
    (8, 'after', '''结果为消息类型时直接回调文本并结束。'''),
    (12, 'after', '''否则渲染登录组件，登录完成后刷新密钥并回调结果。'''),
]
ANNOTATIONS.sort(key=lambda a: a[0])
