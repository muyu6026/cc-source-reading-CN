# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''记忆类型分类与提示词段落总集。记忆只存无法从项目现状推导的上下文（用户信息、反馈、项目背景、外部资源指针），代码模式/架构/git 历史/文件结构都不该存成记忆。两处 TYPES_SECTION_* 故意平铺而非共用规格生成，方便按模式就地改。'''),
    (19, 'after', '''MEMORY_TYPES：记忆的四个值 user / feedback / project / reference，as const 保证字面量类型。'''),
    (21, 'after', '''MemoryType：从 MEMORY_TYPES 推导出的联合类型。'''),
    (31, 'after', '''parseMemoryType：把 frontmatter 里的 type 字段解析成 MemoryType；非法或缺失返回 undefined，让无 type 字段的旧文件与未知类型都能优雅降级。'''),
    (106, 'after', '''TYPES_SECTION_COMBINED：合并模式（私有 + 团队目录）下「记忆类型」段落，含 scope 标签与团队/私有限定示例。'''),
    (178, 'after', '''TYPES_SECTION_INDIVIDUAL：单人模式下「记忆类型」段落，无 scope 标签，示例用普通 [saves X memory] 写法，只在私有/团队分叉才有意义的措辞被改写。'''),
    (195, 'after', '''WHAT_NOT_TO_SAVE_SECTION：两模式通用的「不应保存的内容」清单（代码模式、git 历史、调试方案、CLAUDE.md 已有内容、临时任务细节）。末行是显式保存闸门，防止把周报式清单变成活动日志噪声。'''),
    (202, 'after', '''MEMORY_DRIFT_CAVEAT：回忆侧漂移警告——记忆会过时，答用户或下结论前先对照当前文件/资源核对，冲突时以当下观察为准并清理旧记忆。'''),
    (222, 'after', '''WHEN_TO_ACCESS_SECTION：何时访问记忆。含「忽略记忆」反模式提示——用户说忽略时就当 MEMORY.md 为空，不引用、不对比、不提及。'''),
    (256, 'after', '''TRUSTING_RECALL_SECTION：调用记忆前先核实（H1/H5 评估验证）。命名文件/函数/flag 的记忆是写入时成立的断言，推荐前需 grep 或查文件现状；快照类记忆随时间冻结，问近期状态应优先查 git/代码。'''),
    (271, 'after', '''MEMORY_FRONTMATTER_EXAMPLE：带 type 字段的 frontmatter 示例，供记忆文件套用。'''),
]
