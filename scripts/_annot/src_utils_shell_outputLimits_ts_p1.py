# source: src/utils/shell/outputLimits.ts
ANNOTATIONS = [
    (1, 'before', '''定义 Bash 命令输出长度的上下限常量，并提供一个按环境变量读取、带默认值与上限校验的取值函数。'''),
    (14, 'after', '''getMaxOutputLength：用 validateBoundedIntEnvVar 读取环境变量 BASH_MAX_OUTPUT_LENGTH，默认值 30_000、上限 150_000，返回生效的 effective 值。'''),
]
