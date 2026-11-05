# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''/fast 命令：快速模式（高速低延迟）开关与选择器 UI。开启后切换到高速模型并以溢价计费，受组织级开关与速率限制约束。'''),
    (40, 'after', '''applyFastMode：实际切换逻辑。先清冷却，再写 userSettings.fastMode；开启时若当前模型不支持快速模式才切到快速模型，避免无故改模型。'''),
    (58, 'after', '''runtimeState：从快速模式运行时状态读取（cooldown / overloaded / 限流重置时刻等）。'''),
    (68, 'after', '''pricing：预格式化 Opus 4.6 的计价展示串，用于 UI 提示。'''),
    (98, 'after', '''handleConfirm：确认开启/关闭并记 tengu_fast_mode_toggled 事件；开启时拼出图标与模型更新提示。'''),
    (124, 'after', '''handleCancel：取消处理；若原本开着且当前不可用则回退关掉，否则保持原状。'''),
    (138, 'after', '''handleToggle：切换开关的辅助函数。'''),
    (164, 'after', '''useKeybindings：把 confirm 系列键位映射到 handleConfirm / handleToggle（确认、下一字段、循环、切换等）。'''),
    (172, 'after', '''title：标题栏文案（带冷却图标的快速模式提示）。'''),
    (181, 'after', '''主显示区 t10：根据是否不可用展示错误，否则展示开关状态与计价；冷却态额外展示限流原因与重置倒计时。'''),
    (198, 'after', '''learn more 链接：指向官方快速模式文档。'''),
    (210, 'after', '''FastModePicker 组件收尾：把标题、副标题、取消回调与内容组装进 Dialog 返回。'''),
    (247, 'after', '''handleFastModeShortcut：快捷键直接开关的底层实现，返回结果串；不可用时直接报错，成功时拼出图标与模型/计价信息。'''),
    (256, 'after', '''call 入口：先拉取组织级快速模式状态（若启动期预取在飞则等待），再按 on/off 走快捷键或渲染选择器；功能未启用时返回 null。'''),
    (268, 'after', '''call 收尾。'''),
]
