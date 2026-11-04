# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (17, 'before', 'TypeStep：新建代理向导第一步——输入代理类型标识。三态：agentType、error、cursorOffset，与同向导的 DescriptionStep 结构完全一致。'),
    (25, 'before', '初始值来自向导数据：返回编辑本步时恢复已填内容；光标偏移同步初始化在末尾。'),
    (37, 'before', 'confirm:no（Esc）绑定 goBack，Settings 上下文——向导各步返回键的统一接法。'),
    (40, 'before', 'handleSubmit：trim 后调 validateAgentType（与保存前的整体验证共用同一函数，见 validateAgent.ts）。校验失败就地显示错误不前进；合法写向导数据并 goNext。'),
    (61, 'before', 'Byline 快捷键提示进哨兵槽：输入、回车继续、Esc 返回。'),
    (76, 'before', 'TextInput columns 固定 60：标识符短，输入区不必占满弹窗。placeholder 给了三个示例（test-runner、tech-lead）暗示命名风格是连字符小写。'),
    (85, 'before', '错误行单独缓存：error 为 null 时复用 null 槽，输入过程零开销。'),
]
