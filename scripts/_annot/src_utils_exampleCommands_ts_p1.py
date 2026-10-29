# 数据文件：src/utils/exampleCommands.ts

ANNOTATIONS = [
    (9, 'after', '''文件级：根据项目最近修改的文件，生成「尝试这些命令」式的示例提示，过滤掉非核心（生成物 / 依赖 / 配置）文件，避免调用 Haiku。'''),
    (29, 'after', '''NON_CORE_PATTERNS：判定文件「非核心」的正则集合（锁文件 / 构建产物 / 数据文档 / 配置元数据等），用于确定性地筛掉示例文件名候选。'''),
    (33, 'after', '''isCoreFile：只要不匹配任一非核心模式即视为核心文件。'''),
    (49, 'after', '''countAndSortItems：统计数组元素出现次数，按降序取前 N 并右对齐格式化成字符串。'''),
    (84, 'after', '''pickDiverseCoreFiles：从按频率排序的路径里贪心挑选 want 个 basename，跳过非核心、跨目录分散，避免热门目录垄断。'''),
    (89, 'after', '''测试 / Windows / 非 git 环境直接返回空，避免无意义扫描。'''),
    (127, 'after', '''若本人提交历史太少，退而统计全部作者的修改文件以保证有足够样本。'''),
    (138, 'after', '''getFrequentlyModifiedFiles：用 git log 统计最近修改的文件（优先本人提交，不足则退到全部作者），挑出 5 个多样核心文件。'''),
    (146, 'after', '''从缓存的示例文件里随机抽一个作为频繁文件的占位，缺省用 <filepath>。'''),
    (160, 'after', '''getExampleCommandFromCache：memoize 缓存的示例命令生成器，从缓存的示例文件里随机抽一个拼成 Try ... 提示。'''),
    (183, 'after', '''后台抓取完成后写回 exampleFiles 与生成时间戳到项目配置。'''),
    (184, 'after', '''refreshExampleCommands：memoize 缓存的刷新器，超过一周则清空示例文件，若为空则在后台异步抓取常用文件并写回项目配置。'''),
]
