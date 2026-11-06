# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'after', '''依赖：bun 特性开关、React、命令与组件类型、上下文可视化、微压缩、消息分析与静态渲染工具'''),
    (12, 'before', '''toApiView：先应用压缩边界与项目视图，让 /context 显示模型真正看到的而非 REPL 原始历史'''),
    (18, 'after', '''函数体：先做压缩边界裁剪'''),
    (20, 'after', '''开启 CONTEXT_COLLAPSE 时动态引入 projectView 做折叠'''),
    (26, 'after', '''用 projectView 收尾折叠（eslint-disable 仅覆盖这段 require）'''),
    (30, 'after', '''/context 命令入口：拼装上下文用量可视化并交给 onDone'''),
    (39, 'after', '''先把消息转成 API 视图'''),
    (44, 'after', '''对 API 视图做微压缩以贴近真实发送内容'''),
    (57, 'after', '''analyzeContextUsage：传入压缩后消息、模型、工具权限、智能体、宽度等'''),
    (60, 'after', '''渲染为 ANSI 字符串并交给 onDone'''),
    (62, 'after', '''返回 null（结果已通过 onDone 输出）'''),
]
