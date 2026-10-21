// ═══════════════════════════════════════════════════════════════════════════
// src/commands/clear/index.ts —— 斜杠命令 /clear 的「门牌」，全文只有 19 行
//
// 【这个文件干什么】
//   只做一件事：声明 /clear 这个斜杠命令的**元信息**（叫什么、干什么用、别名是什么、
//   在非交互模式下能不能跑），并把真正的实现「挂」在一个惰性加载函数上。
//
//   真正的清理动作一行都不在这里。文件头的英文注释就点明了这点：
//   实现放在 clear.ts，工具函数放在 caches.ts / conversation.ts。
//
// 【为什么这么设计（这是整个 commands 体系的通用套路）】
//   Claude Code 启动时要把**所有**斜杠命令登记进一张表，才能在你敲 `/` 时弹出补全列表。
//   如果每个命令的实现都在顶层 import，光启动就要把几十个命令的依赖全解析一遍。
//   所以拆成两层：
//     index.ts   → 只有几十字节的元信息，启动时全部加载也没负担
//     clear.ts   → 真正的实现，写成 load: () => import(...)，**敲 /clear 那一刻才加载**
//   这是和 cli.tsx 里 `await import()` 完全同一个思路：把「可能用不上」的代价推迟。
//
// 【谁在什么时候调 load()】
//   用户敲 /clear 之后 → utils/processUserInput/processSlashCommand.tsx:668
//     const mod = await command.load()   ← 到这一行才真正去加载 clear.js
//     const result = await mod.call(args, context)
//
// 【三处消费者，值得对照着看】
//   1. src/commands.ts:9    `import clear from './commands/clear/index.js'`
//      —— 启动时把这个对象登记进命令总表。
//   2. src/commands.ts:654  `clear, // Wipe transcript`
//      —— 还被加进了 BRIDGE_SAFE_COMMANDS：说明 /clear 允许从**手机/网页远程端**触发，
//         它只产生文本、没有终端专属副作用（不像那些要弹 Ink 选择框的命令）。
//   3. src/main.tsx:2622    非交互（-p / headless）模式下按 supportsNonInteractive 过滤。
//
// 【阅读约定】
//   · 英文原文（含原注释）一个字都不删
//   · 紧跟其后的 `// 译：` 是中文直译
//   · `// 注：` 是我补充的解释（原文件没有这句）
//   · `// ── N. xxx ──` 是我加的段落分隔
//
// 原文位置：source/src/commands/clear/index.ts（19 行）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clear command - minimal metadata only.
 * Implementation is lazy-loaded from clear.ts to reduce startup time.
 * Utility functions:
 * - clearSessionCaches: import from './clear/caches.js'
 * - clearConversation: import from './clear/conversation.js'
 */
// 译：clear 命令 —— 只放最精简的元信息。
//     实现从 clear.ts 惰性加载，目的是缩短启动时间。
//     工具函数：
//     - clearSessionCaches：从 './clear/caches.js' 导入
//     - clearConversation：从 './clear/conversation.js' 导入
// 注：这段注释本身就是一份「目录导读」。注意它写的是 `./clear/caches.js`，
//     从本文件（commands/clear/）出发，这个路径其实是 commands/clear/clear/caches.js ——
//     看着像笔误，但它只是给人看的说明文字，不参与编译，所以不影响运行。
//     真实路径是 commands/clear/caches.ts 和 commands/clear/conversation.ts。
import type { Command } from '../../commands.js'
// 译：从 ../../commands.js 导入 Command 类型（type-only 导入）
// 注：`import type` 是关键 —— 它保证这行在编译后**完全消失**，不产生任何运行时依赖。
//     如果写成普通 import，为了一个类型就把 754 行的 commands.ts 拖进来，白费启动时间。
// 注：真实定义在 src/types/command.ts:205 —— `Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)`。
//     也就是说斜杠命令分三类：
//       prompt      → 展开成一段文字发给模型（技能/自定义命令都是这类）
//       local       → 本地执行、返回文本（本文件就是这类）
//       local-jsx   → 本地执行、渲染 Ink 界面（选择框之类）
//     下面用 `satisfies Command` 而不是 `: Command`，稍后解释原因。

// ── 1. 命令对象本体：五个字段，每个都有讲究 ────────────────────────────────────

const clear = {
  // 注：type 决定「谁来执行它」。'local' = 由本地函数执行并返回文本，
  //     即 clear.ts 里那个 `call: async (_, context) => {...}`。
  //     对照 types/command.ts:74-78 的 LocalCommand 类型，它强制要求两个字段：
  //     supportsNonInteractive（必填）和 load（必填）。
  type: 'local',
  // 译：类型为 local（本地命令）
  name: 'clear',
  // 译：命令名为 clear，即用户敲 /clear
  description: 'Clear conversation history and free up context',
  // 译：清空对话历史，释放上下文空间
  // 注：这行文字就是补全列表里跟在 /clear 后面的那句说明，直接展示给用户看。
  aliases: ['reset', 'new'],
  // 译：别名：reset、new
  // 注：所以 /reset 和 /new 是同一个命令的三个名字。
  //     「new」这个名字透露了设计者的心智模型：/clear 的语义其实是「开一个新会话」，
  //     而不是「把已有的东西删掉」。下面那行注释说的正是这件事。
  supportsNonInteractive: false, // Should just create a new session
  // 译：是否支持非交互模式：否。// 应该直接新建一个会话
  // 注：这是本文件最有信息量的一行。main.tsx:2622 的过滤条件长这样：
  //       command.type === 'local' && command.supportsNonInteractive
  //     只要这个字段是 false，-p（headless / 管道脚本）模式下这条命令就**根本不在列表里**，
  //     敲了也匹配不到。
  // 注：为什么？因为 -p 模式是一次性执行、没有「会话」这个概念，清空上下文无从谈起；
  //     想达到同样效果就在命令行上换个新进程。原注释那句 "Should just create a new session"
  //     就是在说：这个场景应该由外部新建会话解决，而不是由 /clear 命令内部解决。
  load: () => import('./clear.js'),
  // 译：加载函数：动态导入 ./clear.js
  // 注：这是唯一一处「可能很重」的引用，但因为写在箭头函数体里，
  //     只有调用 load() 的那一刻才会执行 import。启动时它只是一个未被调用的函数对象。
  // 注：./clear.js 里导出的是 `call`，一个 LocalCommandCall：
  //       call(_, context) → { type: 'text', value: '' }
  //     value 是空串，意味着 /clear 本身不往对话里留任何可见文字 —— 干净地重开。
} satisfies Command
// 注：`satisfies`（TS 4.9+）和 `: Command` 的区别，是这里最值得学的一个细节：
//     · `const clear: Command = {...}` → 会把 clear 的类型**拓宽**成 Command 联合类型，
//       之后的 `clear.name` 只能是 string，而且访问 'local' 专属字段（supportsNonInteractive）
//       要先做类型收窄。
//     · `} satisfies Command` → 只**校验**形状是否合法，但保留字面量推断：
//       clear.type 精确为 'local'，clear.name 精确为 'clear'。
//     好处：commands.ts:653-659 那个 `.filter((c): c is Command => c !== null)` 数组里混着
//     各种命令时，字面量类型能帮上忙；同时一旦写错字段名，编译期立刻报错。

export default clear
// 译：默认导出 clear 对象
// 注：commands.ts:9 用 `import clear from './commands/clear/index.js'` 接住它。
//     注意这个对象是**单例**（模块只求值一次），所以整个进程里所有地方看到的都是同一份元信息。

// ── 2. 读完这 19 行，应该记住的三个模式 ────────────────────────────────────────

// 模式一：元信息与实现分离 —— index.ts 极薄，实现藏在 load() 后面。
//         你在 commands/ 目录下会看到几十个文件都是这个形状（index.ts + 实现文件）。
//
// 模式二：字段的「缺省即使用默认值」 —— CommandBase（types/command.ts:175-203）
//         里 isEnabled 默认 true、isHidden 默认 false、userFacingName 默认取 name。
//         所以一个最小可用的命令只需要 type + name + description，其余全省。
//         本文件只多写了 aliases / supportsNonInteractive / load —— 每一个都是必需的。
//
// 模式三：命令的「能力」是被外部逐个门禁的，不是自己声明的权限。
//         supportsNonInteractive 管 headless 模式能不能用；
//         BRIDGE_SAFE_COMMANDS 集合（commands.ts:651-660）管远程端能不能用；
//         availability 字段（types/command.ts:169-176）管哪种登录方式能看见。
//         三者互不相干，加一个新命令时要分别想清楚。
