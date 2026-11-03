# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '/skills 菜单：按来源分组展示所有已加载技能，每项显示技能名、插件名与 frontmatter 的 token 估算。'),
    (16, 'before', '技能在类型层面固定为 PromptCommand 加 CommandBase 的交叉：技能一定是提示词型命令。'),
    (24, 'before', '组标题：plugin 与 mcp 有专属命名，其余按设置来源（用户 / 项目 / 策略等）首字母大写后拼接。'),
    (33, 'before', '组副标题：MCP 技能显示服务器名列表，文件型技能显示技能目录路径。'),
    (37, 'before', 'MCP 技能名是「服务器:技能」格式（不是 mcp__server__skill），所以取第一个冒号前的部分，去重后拼成副标题。'),
    (44, 'before', '兼容旧目录：commands_DEPRECATED 标记的技能来自已废弃的 commands 目录，副标题里把两个路径都列出来。'),
    (47, 'before', '主组件。35 个槽位中大部分用于五组渲染结果的缓存。'),
    (55, 'before', '先过滤：只留 prompt 型且来源为技能目录、旧命令目录、插件或 MCP 的命令——斜杠命令、本地命令都不算技能。'),
    (63, 'before', '按来源分桶：七个桶对应七种来源，逐个 push 后再桶内按命令名排序。'),
    (101, 'before', '空态：没有任何技能时显示创建路径指引，而不是渲染一个空弹窗。'),
    (126, 'before', 'renderSkill 是模块级函数（文件底部 _temp3），每项展示技能名与约 N 个 description token 的估算值——让用户知道加载这个技能要花多少上下文。'),
    (129, 'before', '组渲染函数：空组返回 null，非空组输出「粗体标题（副标题）」加成员列表。'),
    (155, 'before', '五组按优先级顺序渲染：项目设置 → 用户设置 → 策略设置 → 插件 → MCP。localSettings 与 flagSettings 有桶但不展示（策略敏感，只在设置覆盖体系里生效）。'),
    (226, 'before', '技能行渲染：token 估算只针对 frontmatter（元数据），插件技能额外标注来源插件名。'),
    (234, 'before', '过滤谓词：type 为 prompt 且 loadedFrom 四选一。这个函数被抽到模块级避免每次渲染重建。'),
]
