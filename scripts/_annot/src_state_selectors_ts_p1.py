# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (6, 'after', '''导入队友 / 本地智能体任务类型与 AppState 类型'''),
    (18, 'after', '''getViewedTeammateTask：取当前正在查看的队友任务（若存在）'''),
    (21, 'after', '''解构出 viewingAgentTaskId 与 tasks 映射'''),
    (24, 'after', '''未查看任何队友则 undefined'''),
    (29, 'after', '''任务 ID 不存在则 undefined'''),
    (35, 'after', '''非「进程内队友任务」类型则 undefined'''),
    (49, 'after', '''ActiveAgentForInput 返回类型：判别联合，保证输入路由类型安全'''),
    (59, 'after', '''getActiveAgentForInput：决定用户输入应路由给哪个智能体'''),
    (62, 'after', '''正在查看队友任务则路由给它'''),
    (67, 'after', '''否则若查看的是本地智能体任务则路由给它'''),
    (75, 'after', '''都没有则路由给 leader（主智能体）'''),
]
