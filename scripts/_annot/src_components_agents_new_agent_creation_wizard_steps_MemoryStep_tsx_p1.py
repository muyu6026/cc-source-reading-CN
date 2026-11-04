# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (14, 'before', 'MemoryOption：value 是三种 AgentMemoryScope（user、project、local）或 none——none 表示不给代理持久记忆，选中时存 undefined。'),
    (18, 'before', '新建代理向导的记忆配置步：决定代理的系统提示词要不要拼接记忆目录的使用说明。_c(13) 四段缓存。'),
    (35, 'before', 'confirm:no（Esc）绑定 goBack，上下文是 Confirmation——向导每一步的返回键都这么接。'),
    (36, 'before', 'isUserScope：向导的 location 是 userSettings（用户在改全局配置）还是项目级。它决定推荐项——全局配置推荐 user 记忆目录，项目配置推荐 project 记忆目录。'),
    (38, 'before', '选项数组随 isUserScope 整体重建：推荐项永远排第一并标注 Recommended，其余按 user、none、project、local 固定次序跟随。推荐是位置不是开关——不加「推荐与否」的独立状态，直接换数组。'),
    (72, 'before', 'handleSelect：none 映射为 undefined 写进向导数据；关键是 getSystemPrompt 闭包——启用自动记忆且选了记忆目录时，系统提示词在向导此刻就定死为「基础提示词拼接记忆目录说明」的函数，之后代理每次启动调用它。'),
    (74, 'before', 'agentType 从已生成的 finalAgent 里取：记忆说明文案按代理类型不同（主代理与子代理的记忆目录布局不同）。finalAgent 为空说明前一步没走完，整个更新跳过。'),
    (96, 'before', 'Byline 快捷键提示进常量槽：上下导航、回车选择、Esc 返回。'),
    (103, 'before', 'Select 带 key 为 memory-select：isUserScope 切换导致选项数组整体变化时，key 保证 Select 内部状态（如光标位置）重置到新数组头部——推荐项的第一位置立刻可见。'),
]
