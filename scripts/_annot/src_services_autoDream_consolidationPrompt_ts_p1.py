ANNOTATIONS = [
    (2, 'after_block',
     "文件头这句「从 dream.ts 抽出来」解释了它为什么独立存在：`dream.ts` 是 KAIROS 那条线的实现，被一个 `feature()` 门控的 `require` 包着，而自动整理要能**独立发布**——不能因为那个开关没开就整个拿不到 prompt。所以只把「prompt 怎么拼」这块无依赖逻辑抽出来，它的依赖只有 `memdir` 的三个常量。"),
    (14, 'after',
     "四个阶段是这份 prompt 的骨架，顺序不能乱：**先看现状（Orient）→ 再收新信号（Gather）→ 然后合并（Consolidate）→ 最后剪枝与索引（Prune）**。第一阶段必须先跑，否则模型会直接开写、造出一堆和现有主题文件重复的新文件——prompt 里那句「improve them rather than creating duplicates」就是专门防这个。第二阶段也有个明确的反面要求：「Don't exhaustively read transcripts」，只 grep 你已经怀疑重要的东西——transcript 是巨大的 JSONL，全量读会直接把上下文撑爆。"),
    (65, 'after',
     "最后那段约束是整套记忆系统能长期不腐的关键：`MEMORY.md` 是**索引不是仓库**，一行一条、≤150 字符、只放「标题 + 链接 + 一句钩子」，正文一律进主题文件。三个数字都是硬约束（`MAX_ENTRYPOINT_LINES` 行、~25KB、单行 ~150 字符）——索引一旦膨胀，每次会话开场注入的就不再是地图，而是一堵墙。另一条容易被忽略的要求是**把相对日期换成绝对日期**（「昨天」→ 具体日期），否则一周之后这条记忆就不可解释了。最后 `extra ? ...` 那段是调用方注入的补充上下文（工具约束 + 本次要回顾的会话清单），手动 `/dream` 时不传，所以拼在末尾而不是正文里。"),
]
