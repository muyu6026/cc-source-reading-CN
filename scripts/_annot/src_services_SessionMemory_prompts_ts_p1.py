# -*- coding: utf-8 -*-
"""src/services/SessionMemory/prompts.ts 批注数据"""

ANNOTATIONS = [

    (11, 'before', '''【第 11-41 行】模板里那些**斜体行**不是注释，是给模型看的字段说明

```markdown
# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._
```

`_..._` 在 markdown 里是斜体，但对这个功能来说它的作用是
**「这一节该写什么」的现场提示**。每次模型打开这个文件更新笔记，
都会同时看到「节标题 + 该写什么」，不需要它记住十个 section 的语义。

十个节的选择很讲究，值得对一遍：
`Session Title`（5-10 词的标题）、`Current State`（正在做什么/下一步）、
`Task specification`（用户要什么/设计决策）、`Files and Functions`、
`Workflow`（常用命令及输出怎么读）、`Errors & Corrections`（**犯过的错和不该再试的路**）、
`Codebase and System Documentation`、`Learnings`、`Key results`（用户要的具体产物原文）、
`Worklog`（每步一句话）。

其中 `Errors & Corrections` 是最有信息量的一节 ——
「什么方法试过但失败了」在普通摘要里几乎必然被丢掉，而对下一个接手的人（或下一次压缩后的自己）
这是最值钱的一条。

`Key results` 也有意思：要求「把用户要的表格/答案**原样**重复一遍」。
因为压缩会把长回答压缩掉，而用户真正想要的那张表必须完整保留。'''),

    (43, 'before', '''【第 43-46 行】更新 prompt 开头两条「否定式」指令，防的是模型的身份混淆

```
IMPORTANT: This message and these instructions are NOT part of the actual user conversation.
Do NOT include any references to "note-taking", "session notes extraction", or these update
instructions in the notes content.
```

为什么必须写这个：抽取是把一段 prompt 塞进 `runForkedAgent`，
而 `forkContextMessages` 里带着**完整的用户对话**。模型看到的是
「一堆对话 + 最后一条让me写笔记的指令」。

如果不明确说「这条不是对话的一部分」，模型很容易：
- 把「我来更新笔记」这句话当成用户说的话，写进 `Current State`；
- 在笔记里写「根据上面的指示，我更新了……」这种元叙述。

一旦笔记里出现元叙述，下一次抽取会把这段元叙述当成**上下文事实**再加工，
错误会自我放大。所以这条指令的作用是**切断污染源**。

另一条 `Based on the user conversation above (EXCLUDING this note-taking instruction message
as well as system prompt, claude.md entries, or any past session summaries)` 同理，
它列了一个明确的排除清单：系统提示词、CLAUDE.md、过去的摘要，都不许进笔记
（那些东西本来就在上下文里，重复写入等于浪费 token 且会过时）。'''),

    (81, 'after', '''【第 53-80 行】「不许改斜体行」这件事被说了**三遍**，而这个重复是有信息的

三处：
1. 第 56-61 行，`CRITICAL RULES FOR EDITING` 里的四条 `--` 子项；
2. 第 73-78 行，`STRUCTURE PRESERVATION REMINDER` 再来一遍（还解释了「每节有两部分」）；
3. 第 80 行，`REMEMBER:` 最后再点一次。

为什么不合并成一处：因为这是 prompt，不是代码。**模型对指令的遵守率随距离衰减** ——
一条规则写在 prompt 开头，模型读到第 200 行时已经淡了。
所以在「快要动手编辑」的位置（末尾）再重复一次，遵守率明显更高。

另一个细节：第二遍不是原文照抄，而是换了个说法
（「每节有两部分：标题行 + 斜体描述行，你只改后面」）。
**同一个约束换角度重述，比原样重复更有效** —— 原样重复容易被当成冗余跳过。

顺带注意第 53 行那条：*make all Edit tool calls in parallel in a single message*。
这是性能指令（并行工具调用），但也是为了**原子性**：
分多条消息发 Edit，中间可能被别的东西打断，留下改了一半的笔记。'''),

    (134, 'before', '''【第 134-159 行】`analyzeSectionSizes` 只统计「每个 `# ` 标题之后的内容」

判据是 `line.startsWith('# ')` —— 注意是 `'# '`（带空格），
所以 `## 二级标题` 不会被当成新 section 的开头，它会算进上一节的内容里。
对这个模板恰好合适（模板只有一级标题）。

`currentContent` 会包含**斜体描述行**，也就是统计的 token 数里
混进了模板自带的说明文字。这算不算 bug？严格说是的 ——
但它让「预算」偏保守（低估了真实内容空间），方向是安全的一侧。

结尾那段（第 153-156 行）处理最后一个 section：
for 循环里只在**遇到下一个标题时**才 flush，所以最后一节必须在循环外补一次。
这是「按分隔符切分」的经典写法 —— **别忘了最后一段没有分隔符跟着**。'''),

    (161, 'before', '''【第 161-196 行】两级预算，但**不在代码里硬截断** —— 让模型自己压

`MAX_SECTION_LENGTH = 2000`（单节）+ `MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000`（总量）。
超了怎么办：**在 prompt 末尾追加一段提醒**（`sectionReminders`），
告诉模型「这节 ~3200 token，超了」或「整个文件 ~15000 token，必须压缩」。

为什么不在代码里直接 `slice`：截断是**无信息**的丢失（切在半句话上），
而让模型压是**有损但有序**的（它会保留重要的、合并次要的、删掉过时的）。
对于「笔记」这种语义密集型内容，同样的 token 预算下模型压出来的版本信息量高得多。

注意提醒的**语气分级**很讲究：
- 总量超了 → `CRITICAL: ... You MUST condense ... Aggressively shorten ...`
  并且明确指定优先保留谁：*Prioritize keeping "Current State" and "Errors & Corrections"
  accurate and detailed.*
- 只是某节超了 → `IMPORTANT: The following sections exceed the per-section limit
  and MUST be condensed`，附上具体是哪些节、各超多少。

`oversizedSections` 还按超出的量**降序**排（`sort(([,a],[,b]) => b - a)`），
让最肿的那节排在第一 —— 模型的注意力有限，先看到最该处理的。

**「给模型下指令」和「给人写文档」一样：要说清楚谁重要、先做哪个。**'''),

    (201, 'before', '''【第 201-213 行】`substituteVariables` 用单次 `replace` + 回调，防的是两个经典坑

注释把两个坑都写了：
*Single-pass replacement avoids two bugs: (1) $ backreference corruption
(replacer fn treats $ literally), and (2) double-substitution when user
content happens to contain {{varName}} matching a later variable.*

**坑 1：`$` 反向引用。**
如果用 `template.replace(re, replacementString)`，replacement 里的 `$&` `$1` `$$`
会被当成特殊语法。而这里替换进去的是 `currentNotes` —— **用户对话的内容**，
里面完全可能出现 `$1`（比如讲正则的对话）。
用回调函数 `(match, key) => ...` 就没有这个问题：回调的返回值**永远按字面处理**。

**坑 2：二次替换。**
如果用 `replace('{{a}}', a).replace('{{b}}', b)`，
而 `a` 的内容里恰好有 `{{b}}` 这个字符串（讲模板引擎的对话里非常可能），
那么第二步会把**刚替换进去的内容**再替换一次。

单次 `replace` + 全局正则一次性处理所有变量，两个坑同时消失。
`Object.prototype.hasOwnProperty.call(variables, key)` 而不是 `key in variables`
—— 防的是 `{{toString}}` 这种原型链上的键被替换成一个函数。'''),

    (256, 'before', '''【第 256-296 行】`truncateSessionMemoryForCompact` 是**兜底**，说明作者不信任 prompt

既然上一段用 prompt 让模型自己压，为什么还要一个代码截断？
因为 prompt 的遵守率不是 100%。而这里的失败代价很大：
笔记会被整份塞进压缩后的上下文，如果它自己有 30,000 token，
压缩就白做了 —— 相当于刚扔掉的上下文又以笔记的名义回来了。

所以策略是**双层**：
1. 正常情况下，prompt 提醒 → 模型自己压到预算内；
2. 模型没照做 → 插入前代码硬截断。

关键细节是第 261 行：
```js
const maxCharsPerSection = MAX_SECTION_LENGTH * 4 // roughTokenCountEstimation uses length/4
```
**单位换算写在一行注释里，而且是错的方向**：15000 是「上限」，按 `length/4` 反推
应该乘 4 得到字符数上限 —— 而 `length/4` 是**低估** token 的（实际 token 通常更多），
所以这个字符上限偏宽松。宽松是安全的一侧（宁可少截）。

顺带看 `flushSessionSection` 的截断位置：它在**行边界**截断（`if (charCount + line.length + 1 > max) break`），
不是按字符硬切。半个单词、半行代码都没意义，按行切至少保留完整语义单元。'''),

    (322, 'before', '''【第 322 行】截断后插一句 `[... section truncated for length ...]`

这行看起来只是礼貌，其实是**必要的**：

1. **对模型**：它要基于笔记继续干活。如果某节内容突然在一句话中间消失，
   模型会以为「这就是全部」，可能基于一个不完整的前提做决策。
   有了这句标记，它知道「这里有东西被砍了，可能需要重新读文件确认」。
2. **对人**：`/summary` 之类的命令会展示这个文件。
   用户看到标记就知道「我的笔记被截了」，而不是「我记得写过这段怎么没了」。

原则：**任何有损操作都要留下可见的痕迹。**
静默截断是最糟的一种 —— 它让「信息不完整」和「信息本来就这样」变得无法区分。

（同一原则在这个仓库的其他地方也出现过：
`compactWarning*` 提示压缩发生、`sessionIngress` 的 409 和解、
`promptCacheBreakDetection` 的 `notifyCacheDeletion`。判断标准是
「用户/模型有没有能力发现这件事发生过」。）'''),
]
