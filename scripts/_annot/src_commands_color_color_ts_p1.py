# -*- coding: utf-8 -*-
# 第 167 批：src/commands/color/color.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''依赖：UUID 类型、会话 id、命令上下文、颜色表与工具函数、记忆存储、队友判定。'''),
    (18, 'after', '''重置别名表：default/reset/none/gray/grey 五个写法都等价于回到默认灰。'''),
    (20, 'after', '''命令入口 call：返回 Promise<null>，结果都通过 onDone 以 system 显示回传。'''),
    (32, 'after', '''队友限制：swarm 队友不能自己设颜色，颜色由队长统一分配。'''),
    (40, 'after', '''空参数：列出可用颜色并提示 default，不做事直接返回。'''),
    (45, 'after', '''重置分支：命中别名就把颜色存成 default 哨兵值（不用空串，方便 truthiness 判断持久化）。'''),
    (64, 'after', '''重置完成：同时清掉 AppState 里的 color，让界面立即回到默认。'''),
    (73, 'after', '''非法颜色：不在表中就报错并列出可用项，包含 default。'''),
    (79, 'after', '''正常设置：把颜色存进 transcript 路径，跨会话持久化。'''),
    (89, 'after', '''立即生效：更新 AppState 的 standaloneAgentContext.color，下一帧就变色。'''),
    (92, 'after', '''收尾：回显「已设为某色」并 return null，命令结束。'''),
]
