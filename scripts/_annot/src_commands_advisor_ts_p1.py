# -*- coding: utf-8 -*-
# 第 165 批：src/commands/advisor.ts 批注数据
ANNOTATIONS = [
    (1, 'before', '''/advisor 命令的类型与工具导入。'''),
    (16, 'before', '''call：/advisor 本地处理函数，配置顾问模型。'''),
    (17, 'after', '''先解析参数并拿到当前主循环模型作为基线。'''),
    (22, 'after', '''无参数时展示当前 advisor 状态或提示如何开启。'''),
    (31, 'after', '''基础模型不支持 advisor 时提示该模型处于非激活。'''),
    (43, 'after', '''输入 unset/off 则清除 advisor 设置。'''),
    (60, 'after', '''校验用户输入的目标模型是否合法可用。'''),
    (70, 'after', '''不是合法的 advisor 模型则拒绝设置。'''),
    (77, 'after', '''写入 advisorModel 到应用状态与用户设置。'''),
    (83, 'after', '''若基础模型不支持，设置成功仍附提醒。'''),
    (96, 'before', '''advisor 命令定义对象，隐藏当且仅当用户不可配置。'''),
    (106, 'after', '''懒加载只导出 call，未使用时不开销。'''),
]
