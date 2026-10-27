# -*- coding: utf-8 -*-
# src/utils/suggestions/commandSuggestions.ts  L567
ANNOTATIONS = [

(9, 'after', r'''文件总览：斜杠命令的搜索与建议引擎。基于 fuse.js 做模糊匹配，并结合技能使用频率排序；负责从输入里识别「行中斜杠命令」、生成前缀补全、把命令按来源分类展示、以及把命中的命令套用回输入框。是 PromptInput 底部建议条的底层。'''),

(28, 'after', r'''fuseCache：按 commands 数组身份缓存的 Fuse 索引。commands 在 REPL 里被 memoize 所以稳定，只有数组变了才重建，避免每次按键都重算。'''),

(80, 'after', r'''getCommandFuse：构建 Fuse 索引。把命令名按分隔符（冒号/下划线/连字符）拆成多段 key，权重上命令名最高（3）、段与别名次之（2）、描述最低（0.5）；阈值 0.3 偏严。'''),

(94, 'after', r'''isCommandMetadata：类型守卫，判断一条建议的 metadata 是不是 Command（有字符串 name 与 type）。'''),

(103, 'after', r'''MidInputSlashCommand：描述「行中斜杠命令」的结构——token（含斜杠）、斜杠位置、已输入的部分命令名。'''),

(154, 'after', r'''findMidInputSlashCommand：在光标前回溯找一个「前面是空白的斜杠」，取出其后到空白或结尾的部分作为候选命令；光标已越过命令（遇到空格）就不再给幽灵文本。刻意不用 lookbehind 以兼容 JSC 的 YARR JIT。'''),

(195, 'after', r'''getBestCommandMatch：拿部分命令名去生成建议，筛出「前缀匹配」的那条，返回要补全的后缀（如 com 命中 commit 则返回 mit）。'''),

(202, 'after', r'''isCommandInput：一句话判据——输入是否以斜杠开头。'''),

(216, 'after', r'''hasCommandArgs：有参数的命令判据。斜杠开头的输入若含空格且不以空格结尾，才算「带参数」（末尾空格视为无参）。'''),

(223, 'after', r'''formatCommand：给命令名补上斜杠与前导空格，规范化成输入形态。'''),

(244, 'after', r'''getCommandId：给建议生成稳定唯一 id。prompt 类按 来源（插件再带上仓库）区分重复；内建命令用 name:type 兜底。'''),

(259, 'after', r'''findMatchedAlias：在命令的别名里找「以查询为前缀」的那条（大小写不敏感），用于括号里展示用户敲的别名。'''),

(287, 'after', r'''createCommandSuggestionItem：把 Command 翻成 UI 建议项——展示文本、workflow 标签、按来源拼好的描述（含参数名）。'''),

(498, 'after', r'''generateCommandSuggestions：主入口。空查询时按「最近用过的技能 + 内建 + 用户 + 项目 + 策略 + 其它」分类排好；有查询时走 Fuse 并做五档优先级排序（精确名 > 精确别名 > 前缀名 > 前缀别名 > 模糊），模糊档用 Fuse 分数、同分再比使用频率。故意不去重，因为不同来源的同源命令实现可能不同。'''),

(539, 'after', r'''applyCommandSuggestion：把选中的命令套回输入框并定位光标；若要求立即执行且该命令无参数，直接 onSubmit。'''),

(544, 'after', r'''cleanWord：把单词转小写并去掉非字母数字字符，用于描述的分词检索。放在文件底部是 CLAUDE.md 的约定。'''),

(567, 'after', r'''findSlashCommandPositions：在文本里找出所有「斜杠命令」的位置区间，用于高亮；要求斜杠前是空白或行首，避免把 /usr/bin 这类路径误判成命令。'''),

]
