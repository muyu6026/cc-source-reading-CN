# 自动批注流水线 · 执行记忆

## 第 47 批（2026-10-26）：utils ast + marketplaceManager + auth
- 状态：完成并推送，commit `d60bcfc`。
- 本批：`src/utils/bash/ast.ts`（2,679→2,783 行，104 锚点）、`src/utils/plugins/marketplaceManager.ts`（2,643→2,746 行，103 锚点）、`src/utils/auth.ts`（2,002→2,116 行，114 锚点）。合计 3 文件 7,324 行 / 321 锚点。
- 进度：全仓 **598/1902 文件 / 198,146 行 / 38.6%**；`src/utils/` 9/564（剩 555 份），hooks 104/104、tools 184/184、services 130/130 仍全清。
- 校验：check-fidelity 598 份 0 失败；check-links 819 源码链接 + 107 内链 0 失效；annotate.py 零 `⟳`。
- 下一批目标（按行数降序）：`utils/shell/readOnlyCommandValidation.ts` 1,893 → `utils/config.ts` 1,817 → `utils/powershell/parser.ts` 1,804 → `utils/permissions/filesystem.ts` 1,777。

## 第 46 批（2026-10-26）：utils attachments + pluginLoader
- 状态：完成并推送，commit `cf844dd`。
- 本批：`src/utils/attachments.ts`（3,997→4,155 行，158 锚点）、`src/utils/plugins/pluginLoader.ts`（3,302→3,470 行，168 锚点）。合计 2 文件 7,299 行 / 326 锚点。
- 进度：全仓 **595/1902 文件 / 190,822 行 / 37.2%**；`src/utils/` 6/564（剩 558 份），hooks 104/104、tools 184/184、services 130/130 仍全清。
- 校验：check-fidelity 595 份 0 失败；check-links 816 源码链接 + 106 内链 0 失效。
- 下一批目标（按行数降序）：`utils/bash/ast.ts` 2,679 → `utils/plugins/marketplaceManager.ts` 2,643 → `utils/auth.ts` 2,002 → `utils/shell/readOnlyCommandValidation.ts` 1,893。
- **重大踩坑（新类型）**：`annotated-索引与进度.md` 在批 45 提交后被**外部编辑器重排回写**——工作树版本退回批 44 状态（表格对齐 + `<summary>` 补包裹 + 反斜杠转义），丢失第 45 批小节、进度倒退、一个字符损坏成 HTML 实体（`错` → `&#x9519;`）。处置流程：`git diff -w` 粗查 → 规范化比对（去反斜杠 + 去空白 + `-` 串归一）确认外部版零新增内容 → 备份到 `/tmp` → `git checkout` 还原 HEAD。**每次开工若索引/README 有未提交改动，先语义比对再决定还原或提交**；注意分隔线 `---` 变长会制造巨量假差异，归一后才能看清真实改动。

## 第 45 批（2026-10-26）：utils 巨兽第二梯队 hooks + bashParser
- 状态：完成并推送，commit `a6c783b`。
- 本批：`src/utils/hooks.ts`（5,022→5,158 行，136 锚点）、`src/utils/bash/bashParser.ts`（4,436→4,607 行，171 锚点）。合计 2 文件 9,458 行 / 307 锚点。
- 进度：全仓 **593/1902 文件 / 183,523 行 / 35.8%**；`src/utils/` 4/564（剩 560 份），hooks 104/104、tools 184/184、services 130/130 仍全清。
- 校验：check-fidelity 593 份 0 失败；check-links 814 源码链接 + 105 内链 0 失效。
- 下一批目标（按行数降序）：`utils/attachments.ts` 3,997 → `utils/plugins/pluginLoader.ts` 3,302 → `utils/bash/ast.ts` 2,679 → `utils/plugins/marketplaceManager.ts` 2,643。

## 第 44 批（2026-10-26）：utils 根目录 messages + sessionStorage
- 状态：完成并推送，commit `a00d44b`。
- 本批：`src/utils/messages.ts`（5,512→5,596 行，84 锚点）、`src/utils/sessionStorage.ts`（5,105→5,247 行，142 锚点）。合计 2 文件 10,617 行 / 226 锚点。
- 进度：全仓 **591/1902 文件 / 174,065 行 / 33.9%**；`src/utils/` 2/564（剩 562 份），hooks 104/104、tools 184/184、services 130/130 仍全清。
- 校验：check-fidelity 591 份 0 失败；check-links 812 源码链接 + 104 内链 0 失效。
- 下一批目标（按行数降序）：`utils/hooks.ts` 5,022 → `utils/bash/bashParser.ts` 4,436 → `utils/attachments.ts` 3,997 → `utils/plugins/pluginLoader.ts` 3,302。

### 经验（供下次直接照做）
- utils 巨兽体量是 hooks 小文件的 20–100 倍：**>3,000 行一批 2–3 份封顶**，不要按「10 份」硬凑。
- 预检必须**执行模块**（importlib），只跑 `ast.parse` 拦不住「元组里裸名字」这类错误（本批踩过：`(4677, after, ...)` 丢引号，执行时才 NameError）。
- 函数签名行（`export function f(...) {` / `): void {`）一律用 `before`，用 `after` 会把中文插进函数体首行。
- 锚点行号以 Read 输出为准；空行/import 末行容易差 1，写完抽验语义。
- **批注文本避免引用含引号/反斜杠的 shell 字面量**（第 45 批踩坑：`ls <<'EOF'`、`export "FOO=bar"`、`\\r`、`/\\s/` 让 bashParser 数据文件被预检连拦 4 轮；shell 转义序列 `'"'"'` 还会混进文本）——用「加引号 XX」式中文表述代替，raw string 里 `\\r` 仍是两个反斜杠字符。
- **写数据文件时干脆不用引号字符**（第 47 批第二次踩到）：`ast.ts` 两轮、`marketplaceManager.ts` 一轮被预检拦下，全是 `"$(cmd)"`、`env "FOO=bar"`、`\-n` 这类字面量引用。改写成「引号包裹的 XX」「转义写法的 -n」即可，一次过。
- 2,000–2,700 行档一批 3 份是合适的（本批 7,324 行 / 321 锚点，三个数据文件各 100 余锚点）。
