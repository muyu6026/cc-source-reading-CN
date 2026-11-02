# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''pyright 的命令规格：纯数据声明，供 bash 命令解析、参数校验与补全消费，不包含任何执行逻辑。'''),
    (6, 'after', '''options 数组的字段约定：name 可以是单字符串或短长别名组，带参数的选项再挂 args（含占位名与 isOptional）。'''),
    (18, 'after', '''单独一个减号也是合法选项名：pyright 支持从 stdin 读文件列表，规格里要显式登记否则解析器不认。'''),
    (33, 'after', '''verifytypes 与 ignoreexternal 这对：先验包的类型完整性，再选择忽略外部导入；规格按官方 CLI 一比一抄录。'''),
    (58, 'after', '''outputjson 是机器消费的入口：上层工具拿 JSON 结果而不是解析人类可读输出，规格里必须保留。'''),
    (83, 'after', '''选项清单到此为止：共 21 项，覆盖帮助、监听、工程配置、类型桩、解释器定位与输出控制。'''),
    (91, 'after', '''satisfies CommandSpec 是结构校验：写错字段名或漏必填项在编译期就报错，不等到运行时解析命令才炸。'''),
]
