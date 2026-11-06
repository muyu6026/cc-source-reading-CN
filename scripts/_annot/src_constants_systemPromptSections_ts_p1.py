# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (6, 'after', '''引入 bootstrap 状态层的缓存与重置工具'''),
    (8, 'after', '''计算函数类型：返回字符串或 null，可异步'''),
    (10, 'after', '''系统提示段落类型：名字 + 计算函数 + 是否打断缓存'''),
    (20, 'after', '''systemPromptSection：创建带记忆化的段落，默认 cacheBreak=false'''),
    (25, 'after', '''记忆化段落构造结束'''),
    (32, 'after', '''DANGEROUS_uncachedSystemPromptSection：每轮重算、会打断提示缓存，调用方必须给理由'''),
    (37, 'after', '''易失段落构造结束'''),
    (43, 'after', '''resolveSystemPromptSections：异步并行解析所有段落'''),
    (48, 'after', '''并行解析所有段落'''),
    (52, 'after', '''缓存命中直接返回'''),
    (56, 'after', '''否则计算并写入缓存'''),
    (65, 'after', '''clearSystemPromptSections：清空段落状态并重置 beta 头部闩锁（/clear 与 /compact 调用）'''),
]
