# -*- coding: utf-8 -*-
# 第 166 批：src/commands/plugin/parseArgs.ts 批注数据
ANNOTATIONS = [
    (1, 'before', '''把插件子命令参数解析为结构化的 ParsedCommand。'''),
    (2, 'before', '''插件子命令的联合类型：菜单/帮助/安装/管理/卸载/启用/禁用/校验/市场。'''),
    (17, 'before', '''插件参数解析入口函数。'''),
    (19, 'after', '''无参数时直接回菜单。'''),
    (22, 'after', '''按空白拆分参数并取首个小写命令词。'''),
    (25, 'after', '''switch 分发各子命令。'''),
    (31, 'after', '''install/i：解析目标，区分插件与 marketplace。'''),
    (39, 'after', '''含 @ 的写法拆出 plugin 与 marketplace。'''),
    (50, 'after', '''以 URL/路径特征判断目标是否为 marketplace（多行赋值收尾后注解）。'''),
    (58, 'after', '''无 @ 且非路径则视为插件名。'''),
    (61, 'after', '''manage 子命令。'''),
    (64, 'after', '''uninstall/enable/disable：取第二个参数为插件名。'''),
    (73, 'after', '''validate：拼接剩余参数为待校验路径。'''),
    (78, 'after', '''marketplace/market：分发 add/remove/update/list。'''),
    (99, 'after', '''未知命令回退到菜单。'''),
]
