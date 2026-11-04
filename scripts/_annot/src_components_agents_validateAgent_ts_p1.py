# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'before', 'AgentValidationResult：isValid 加 errors 与 warnings 两个列表——错误阻止保存，警告只提示不拦截，两级分开收集。'),
    (15, 'before', 'validateAgentType 单独导出：向导第一步（TypeStep）在输入时就实时调用它，保存前的整体验证复用同一套规则——两处校验永不漂移。规则：非空、首尾必须是字母数字（中间可含连字符）、长度 3 到 50。'),
    (35, 'before', 'validateAgent 主函数：新建与编辑共用。参数不含 location——来源在调用方决定，验证只关心定义本身。'),
    (53, 'before', '查重排除同 source 的同名项：编辑场景下代理自己的旧定义也在 existingAgents 里，不过滤会把自己误报成重复。跨 source 撞名（用户配置与插件撞名）仍然报错。'),
    (64, 'before', '描述三级：缺失是错误；不足 10 字符是警告（太短_whenToUse_无法指导路由）；超 5000 字符也是警告（路由时全文都要进上下文）。注意 _whenToUse_ 字段同时承担「描述」与「何时使用」两个语义。'),
    (75, 'before', '工具校验：类型不是数组是错误；undefined（继承全部工具）与空数组只给警告——前者能力全开需用户知情，后者近乎残废也需知情，但都不是格式错误。无效工具名经 resolveAgentTools 解析后是错误。'),
    (95, 'before', '系统提示词：缺失或不足 20 字符是错误（空提示词的代理毫无用处）；超 1 万字符只是警告——长提示词合法，只是费 token。'),
    (104, 'before', 'isValid 只看 errors：警告的存在不阻止保存。这个函数是「错误拦、警告劝」分级校验的完整范本。'),
]
