// Extracted from dream.ts so auto-dream ships independently of KAIROS
// feature flags (dream.ts is behind a feature()-gated require).
// 文件头这句「从 dream.ts 抽出来」解释了它为什么独立存在：`dream.ts` 是 KAIROS 那条线的实现，被一个 `feature()` 门控的 `require` 包着，而自动整理要能**独立发布**——不能因为那个开关没开就整个拿不到 prompt。所以只把「prompt 怎么拼」这块无依赖逻辑抽出来，它的依赖只有 `memdir` 的三个常量。

import {
  DIR_EXISTS_GUIDANCE,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
} from '../../memdir/memdir.js'

export function buildConsolidationPrompt(
  memoryRoot: string,
  transcriptDir: string,
  extra: string,
): string {
// 四个阶段是这份 prompt 的骨架，顺序不能乱：**先看现状（Orient）→ 再收新信号（Gather）→ 然后合并（Consolidate）→ 最后剪枝与索引（Prune）**。第一阶段必须先跑，否则模型会直接开写、造出一堆和现有主题文件重复的新文件——prompt 里那句「improve them rather than creating duplicates」就是专门防这个。第二阶段也有个明确的反面要求：「Don't exhaustively read transcripts」，只 grep 你已经怀疑重要的东西——transcript 是巨大的 JSONL，全量读会直接把上下文撑爆。
  return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
${DIR_EXISTS_GUIDANCE}

Session transcripts: \`${transcriptDir}\` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient

- \`ls\` the memory directory to see what already exists
- Read \`${ENTRYPOINT_NAME}\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` or \`sessions/\` subdirectories exist (assistant-mode layout), review recent entries there

## Phase 2 — Gather recent signal

Look for new information worth persisting. Sources in rough priority order:

1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) if present — these are the append-only stream
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — if you need specific context (e.g., "what was the error message from yesterday's build failure?"), grep the JSONL transcripts for narrow terms:
   \`grep -rn "<narrow term>" ${transcriptDir}/ --include="*.jsonl" | tail -50\`

Don't exhaustively read transcripts. Look only for things you already suspect matter.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file at the top level of the memory directory. Use the memory file format and type conventions from your system prompt's auto-memory section — it's the source of truth for what to save, how to structure it, and what NOT to save.

Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates so they remain interpretable after time passes
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

## Phase 4 — Prune and index

Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.

- Remove pointers to memories that are now stale, wrong, or superseded
- Demote verbose entries: if an index line is over ~200 chars, it's carrying content that belongs in the topic file — shorten the line, move the detail
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.${extra ? `\n\n## Additional context\n\n${extra}` : ''}`
}
// 最后那段约束是整套记忆系统能长期不腐的关键：`MEMORY.md` 是**索引不是仓库**，一行一条、≤150 字符、只放「标题 + 链接 + 一句钩子」，正文一律进主题文件。三个数字都是硬约束（`MAX_ENTRYPOINT_LINES` 行、~25KB、单行 ~150 字符）——索引一旦膨胀，每次会话开场注入的就不再是地图，而是一堵墙。另一条容易被忽略的要求是**把相对日期换成绝对日期**（「昨天」→ 具体日期），否则一周之后这条记忆就不可解释了。最后 `extra ? ...` 那段是调用方注入的补充上下文（工具约束 + 本次要回顾的会话清单），手动 `/dream` 时不传，所以拼在末尾而不是正文里。
