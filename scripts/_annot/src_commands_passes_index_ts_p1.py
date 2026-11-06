ANNOTATIONS = [
    (1, 'after', """`/passes` 命令的元数据壳：按推荐奖励与资格动态生成描述与隐藏逻辑，实现懒加载 `passes.js`。"""),
    (7, 'after', """命令定义：类型 `local-jsx`，根据是否有推荐奖励拼出不同描述文案。"""),
    (10, 'after', """`description` 取值器：有推荐奖励时多一句「还能赚取额外用量」。"""),
    (17, 'after', """`isHidden` 取值器：无资格或无缓存时隐藏命令，避免无效入口。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
