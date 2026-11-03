# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (21, 'after', '''cachedHighlight 在模块级 LRU 缓存之上包装 hl.highlight：
命中则移到队首（最近使用），未命中则高亮后写入，超 500 条时淘汰最旧项。'''),
    (38, 'after', '''缓存上限 HL_CACHE_MAX=500，键为 language+code 的哈希，避免长期持有完整源码字符串（#24180 内存修复）。'''),
    (123, 'after', '''HighlightedCodeFallback 主组件：先决定走纯文本（skipColoring）还是异步高亮，
再据 filePath 推断语言，交给内部的 Highlighted 子组件渲染。'''),
    (192, 'after', '''Highlighted 子组件用 use 挂起等待高亮器就绪，按语言渲染；
语言不支持时回退 markdown，仍抛错则退回原始代码。'''),
]
