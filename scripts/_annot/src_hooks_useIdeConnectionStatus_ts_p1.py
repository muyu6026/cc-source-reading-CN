# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'after', '''// 从 MCP 客户端里定位 ide client，推导其连接状态与名称，供 UI 显示。'''),
    (24, 'after', '''// 仅 sse-ide / ws-ide 类型能从 config 取到 ideName，其余类型（如 stdio）返回 null。'''),
    (25, 'after', '''// 按 client.type 映射 connected / pending / disconnected 三态，找不到 ide client 则整体返回 null。'''),
]
