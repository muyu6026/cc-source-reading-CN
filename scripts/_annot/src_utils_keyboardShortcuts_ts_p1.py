# 批注数据：source/src/utils/keyboardShortcuts.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。macOS 终端下「Option+字母」会产出特殊字符，本文件把这些字符映射到对应的按键绑定（例如 Option+T 触发思考开关），用于识别没有开启「Option 作为 Meta」的终端里的组合键。'''),
    (8, 'after', '''这张常量表用 `satisfies Record<string,string>` 锁死「特殊字符 → 绑定名」的映射，三项是 Option+T/P/O 分别对应思考开关、模型选择、快速模式。'''),
    (14, 'after', '''类型守卫：判断某字符是否属于上表，返回带 `keyof` 收窄的类型，调用方拿到字符即可直接当作键名使用。'''),
]
