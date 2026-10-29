# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/debugFilter.ts'
ANNOTATIONS = [
    (7, 'after', '''DebugFilter 描述一条调试过滤配置：include 白名单、exclude 黑名单、isExclusive 是否排他模式。'''),
    (17, 'before', '''parseDebugFilter 把逗号分隔的过滤字符串解析成 DebugFilter；带 ! 前缀表示排除，! 与普通项混用视为非法返回 null。'''),
    (53, 'after', '''parseDebugFilter 结束：清理掉 ! 前缀并转小写，按排他/包含模式填好 include 与 exclude 数组。'''),
    (65, 'before', '''extractDebugCategories 从一条调试消息里抽取分类标签（兼容 category:、[CATEGORY]、MCP server 名、1p event 等写法），返回小写数组。'''),
    (108, 'after', '''extractDebugCategories 结束：去重后返回分类数组，没识别到则返回空数组（未分类）。'''),
    (116, 'before', '''shouldShowDebugCategories 根据分类与过滤配置决定消息是否展示；无过滤则全显示，未分类消息在两种模式下默认都不显示。'''),
    (139, 'after', '''shouldShowDebugCategories 结束：排他模式「不在排除列表才显示」，包含模式「命中包含列表才显示」。'''),
    (145, 'before', '''shouldShowDebugMessage 是组合入口：无过滤直接全显示，有过滤则先抽分类再判定。'''),
    (157, 'after', '''shouldShowDebugMessage 结束。'''),
]
