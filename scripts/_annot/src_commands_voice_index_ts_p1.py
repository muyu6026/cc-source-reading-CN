ANNOTATIONS = [
    (1, 'after', """`/voice` 命令：切换语音模式，仅在语音功能经 GrowthBook 与运行期开关同时启用时可见可用。"""),
    (7, 'after', """命令定义：类型 `local`、名称、描述与可用性范围，并依赖两项开关决定是否隐藏。"""),
    (12, 'after', """`isEnabled` 由 GrowthBook 杀开关决定；`isHidden` 由运行期语音开关决定。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
