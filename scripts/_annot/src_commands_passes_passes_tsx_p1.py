ANNOTATIONS = [
    (1, 'after', """`/passes` 命令入口：用户首次访问时写入访问标记、上报埋点，再挂载奖励卡券界面。"""),
    (9, 'after', """读取全局配置判断是否首次访问；首次才把剩余卡券数快照进配置。"""),
    (22, 'after', """挂载 `Passes` 组件并把退出回调透传下去，命令主体结束。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
