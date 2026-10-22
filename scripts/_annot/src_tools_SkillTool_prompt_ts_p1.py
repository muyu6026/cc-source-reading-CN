# -*- coding: utf-8 -*-
"""批注数据：src/tools/SkillTool/prompt.ts（241 行）"""

ANNOTATIONS = [
    (23, 'after', "技能清单的预算：上下文窗口的 1%（按 4 字符/token 折算），200K 窗口就是 8,000 字符。可用环境变量强制覆盖。技能是按需加载的（调用时才展开全文），清单本身只负责「让模型知道有哪些可选」。"),
    (29, 'after', "单条硬上限 250 字符，对所有条目一视同仁（含内置技能）。英文注释把账算清了：清单只为发现服务，冗长的 whenToUse 只会烧掉第一轮的 cache_creation token，不提升匹配率——反正调用时会加载全文。"),
    (41, 'after', "预算三级来源：环境变量 > 按窗口实算（tokens × 4 × 1%）> 8,000 兜底。注意 0 会被 Number() 转成 falsy 从而落到下一级——环境变量传 0 相当于没传。"),
    (50, 'after', "描述 = description，声明了 whenToUse 就拼上（「是什么 - 什么时候用」）。超 250 截断加省略号。whenToUse 是技能作者写给模型的「路由信号」，与 description（写给人的说明）分开声明、合并展示。"),
    (110, 'after', "预算不够时先保内置技能：bundled 条目永远保留完整描述，剩余预算才分给其余技能。bundled 的占用先从预算里扣除，再按人头均摊描述长度——分配算法是「保底优先、均摊其次」。"),
    (142, 'after', "极端情况：均摊下来每条描述不足 20 字符时，非内置技能直接降级成只有名字（- name），内置技能仍带完整描述。降级同时打 tengu_skill_descriptions_truncated 遥测（truncation_mode: names_only），内部能监控到「技能太多把清单挤爆」的会话。"),
    (171, 'after', "常规路径：按均摊长度逐条 truncate 描述（truncation_mode: description_trimmed）。两级降级的判断点在 maxDescLen < MIN_DESC_LENGTH(20)——宁可少给信息也不给半句废话。"),
    (173, 'after', "getPrompt 用 memoize 包住——prompt 在会话生命周期内只算一次（技能清单在会话中不刷新），clearPromptCache 提供手动失效口子。"),
    (196, 'after', "prompt 文本的行为约定里最重的一条：技能匹配用户请求时是 BLOCKING REQUIREMENT，必须先调工具再生成任何关于任务的回复；以及看到 COMMAND_NAME_TAG 标签说明技能已加载，直接照做别再调一次。这两条共同防止「说而不调」和「重复加载」。"),
]
