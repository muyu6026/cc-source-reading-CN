# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (4, 'after', '''引入 analytics 上报、键位同步加载、显示文本解析与上下文类型'''),
    (7, 'after', '''引入键位同步加载、显示文本解析与上下文类型'''),
    (9, 'after', '''TODO：迁移完成后移除 fallback 参数与防御性逻辑（避免重复 fallback 事件）'''),
    (17, 'after', '''LOGGED_FALLBACKS 之上的说明：记录已上报的 action+context 以避免非 React 上下文重复上报'''),
    (19, 'after', '''已上报 fallback 的去重集合'''),
    (21, 'before', '''getShortcutDisplay：不依赖 React Hook 的快捷键显示文本获取（供命令 / 服务等非 React 场景）'''),
    (38, 'after', '''函数签名：action + context + fallback'''),
    (43, 'after', '''同步加载键位并解析显示文本'''),
    (45, 'after', '''未解析到则走 fallback 并上报一次'''),
    (60, 'after', '''无解析结果返回 fallback'''),
    (62, 'after', '''有结果返回解析到的文本'''),
]
