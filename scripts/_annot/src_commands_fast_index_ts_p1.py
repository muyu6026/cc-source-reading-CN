# 源文件: src/commands/fast/index.ts
ANNOTATIONS = [
    (8, 'after', '''命令定义：切换「快速模式」，仅作用于 FAST_MODE_MODEL_DISPLAY 指定的那个模型。'''),
    (12, 'after', '''描述动态拼出当前快速模式模型名（例如「Toggle fast mode (Haiku only)」）。'''),
    (15, 'after', '''只在快速模式本身被启用时才显示此命令；get isHidden 反向控制隐藏。'''),
    (22, 'after', '''immediate 是否立即执行，跟随通用的「推断配置命令是否即时」判定。'''),
    (24, 'after', '''满足 Command 类型；availability 限定 claude-ai 与 console 两种渠道。'''),
]
