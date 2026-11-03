# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (41, 'after', '''RENDER_CACHE 是模块级 WeakMap：键为 patch 对象、值为「主题/宽度/暗淡」组合的渲染结果缓存，
避免 ctrl+o 全屏切换导致整棵消息树重挂载重算高亮。'''),
    (49, 'after', '''computeGutterWidth 计算行号槽宽度：最大行号位数 + 3（标记符 + 两格补白），仅依赖 patch 身份故可缓存。'''),
    (94, 'after', '''renderColorDiff 调用 Rust 侧高亮器渲染，并按需把每行预拆成『槽位列』与『内容列』两列，
冷缓存才做拆分，重挂载重用时仅是一次 WeakMap 查找加两片 RawAnsi 叶子。'''),
    (141, 'after', '''未命中彩色高亮（或禁用）时回退到纯文本 StructuredDiffFallback 组件。'''),
    (189, 'after', '''memo 包裹的组件：命中缓存且有槽位时渲染双列（NoSelect 槽位 + RawAnsi 内容），否则单列输出。'''),
]
