# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件提供「有界整数环境变量」的校验工具：把字符串形式的环境变量解析为整数，并在越界时返回 capped（截断到上限）或 invalid（回退默认值）状态。'''),
    (3, 'before', '''EnvVarValidationResult：校验结果类型，含生效值 effective、状态 status 与可选的人类可读 message。'''),
    (9, 'before', '''validateBoundedIntEnvVar：解析并校验一个有界整数环境变量。空值回退默认值；非正整数判为 invalid；超过上限则截断到 upperLimit 并返回 capped 状态。'''),
]
