# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  Message：一个纯分发器，和它身后十四个渲染组件
// ═══════════════════════════════════════════════════════════════
//
//  这个文件本身几乎没有渲染逻辑 —— 它做的是**两次 switch**：
//
//  外层按消息类型：attachment / assistant / user / system /
//                  grouped_tool_use / collapsed_read_search
//  内层按块类型：  text / tool_use / thinking / redacted_thinking /
//                  server_tool_use / advisor_tool_result
//
//  真正画东西的是 `components/messages/` 下那十四个组件。所以读这个文件的
//  正确姿势是**只读分发条件**，把「怎么画」留给它们。
//
//  分发条件里藏着不少产品决策（thinking 什么时候显示、bash 输出什么时候
//  展开、compact 边界画不画），这些才是这个文件的价值。
//
//  另外，626 行里有 400 多行是 React Compiler 的缓存槽 —— 真实逻辑不到
//  200 行。读的时候必须能快速跳过 `$[n]` 的样板（方法见 MessageRow.tsx
//  第 93 行的批注）。'''),

    (82, 'before', '''// 【switch 的六个 case，覆盖了 RenderableMessage 的全部类型】
//
//  RenderableMessage 的联合类型里还有 'progress'，但它在 Messages.tsx 里
//  就被过滤掉了（第 499 行），所以这里不处理 —— 一旦漏过滤，会走到 switch
//  末尾之外，函数返回 undefined，React 报「渲染返回了 undefined」。
//
//  这种「上游过滤 + 下游 switch」的配合是隐式契约：switch 没有 default 分支
//  兜底，说明作者确信类型是穷尽的。TypeScript 能验证这一点（switch 覆盖
//  联合类型的所有成员时不会报错），但**运行时没有兜底**。'''),

    (105, 'before', '''// 【inProgressToolCallCount 传的是**全场**正在跑的工具数，不是这条消息的】
//
//  `inProgressToolUseIDs.size` —— 一个跨消息的全局计数。
//
//  用途在 AssistantToolUseMessage 里：多个工具并行时，UI 会显示「还有 N 个
//  在跑」这类信息。所以它需要的是全局数，不是局部数。
//
//  但这意味着**任何一个工具开始/结束，所有 tool_use 块的这个 prop 都变** ——
//  于是所有 tool_use 都要重渲染。这是一个明显但被接受的代价（并行工具通常
//  只有几个，且本来就在动）。
//
//  如果哪天并行工具数量上去了，这里是第一个要改的地方（改成只传「同消息内
//  的计数」）。'''),

    (159, 'before', '''// 【isCompactSummary 要在所有其他判断之前】
//
//  因为压缩摘要是一条**伪装成 user 消息**的特殊消息：它有 user 类型、
//  有 content 数组，但内容是「之前对话的总结」，不是用户说的话。
//
//  如果让它走普通的 user 分支，会被当成用户输入渲染（带用户提示符）——
//  语义完全错。所以必须先拦。
//
//  注意它把 screen 转成了 'transcript' | 'prompt' 字符串传下去，而不是传
//  布尔。CompactSummary 需要区分这两种屏幕来调整样式。'''),

    (172, 'before', '''// 【imageIndices 是一个和 content 等长的数组，元素是「第几张图」或「当前序号」】
//
//  为什么要这么绕：图片块需要编号（"image 1"、"image 2"），但编号不能简单
//  用「这是第几个 image 块」—— 因为 imagePasteIds 可能给了真实 id（用户
//  粘贴时的序号），也可能没有。
//
//  于是构造一个**平行数组**：遇到 image 块就 push 它的 id（没有则用递增
//  计数），遇到非 image 块就 push 当前计数（占位，不会被读）。
//
//  注意 `imagePosition++` 在 push id **之前**自增，所以缺 id 时用的是
//  「从 1 开始的第几张图」。而 push 到非 image 位置的值是自增**之后**的
//  计数 —— 如果第一个块不是图片，那个位置会是 1 而不是 0。这个偏差无害，
//  因为非图片位置的值永远不会被读。'''),

    (191, 'before', '''// 【只有「最新的那条 bash 输出」才包 ExpandShellOutputProvider】
//
//  这个 Provider 提供的能力是「展开/折叠 shell 输出」（默认截断，可展开）。
//  只给最新一条包，理由是：老的 bash 输出已经折叠成一行摘要，用户要看
//  细节得先点开消息 —— 而最新的这条是「刚跑完，我可能想看全」。
//
//  注意判断用的是 `latestBashOutputUUID === message.uuid`，直接比 uuid
//  （不像 memo 比较器里那样化简成布尔）。因为这里比的是「我是不是那条」，
//  比一次就够了。'''),

    (233, 'before', '''// 【compact_boundary 在 fullscreen 下直接不画】
//
//  这条分界线在主屏上的作用是「分割线 + 提示这里发生过压缩」，因为压缩前
//  的消息还在原生 scrollback 里，需要一条视觉分界。
//
//  全屏模式下没有原生 scrollback，而且 Messages.tsx 根本不过滤压缩前的消息
//  （第 496 行的批注），历史是全的 —— 再画一条「压缩边界」会让用户以为上面
//  的内容被删掉了。
//
//  **同一个数据，在不同的显示模型下语义相反。** 这是本文件里最典型的一例。'''),

    (246, 'before', '''// 【microcompact_boundary 永远不画】
//
//  和 compact 不同的地方：microcompact（微压缩，删掉旧的工具结果）是**用户
//  无感**的操作 —— 它不改变对话的语义，只是省 token。所以不需要任何视觉提示。
//
//  而 compact（全量压缩）会把历史换成摘要，用户必须知道。
//
//  「要不要给用户看」取决于这件事**改变了什么**，不取决于它重不重要。'''),

    (249, 'before', '''// 【feature() 门控里套 require，而且是在渲染函数内部】
//
//  这是 DCE 的第二种用法：模块级的 `feature()` 判断（Messages.tsx 第 80 行）
//  在**打包时**折叠；这里的判断也在打包时折叠，但 require 的位置在函数体内，
//  所以即使 feature 为真，模块也是**首次渲染时才加载**。
//
//  代价：这段代码不能出现在模块顶层，因为顶层 require 会在启动时就执行。
//  收益：不用 snip 功能的构建里，这两个模块（以及它们依赖的整棵子树）完全
//  不进产物。
//
//  注意 `$[65]` 那个缓存槽存的是 `require(...)` 的**模块对象** —— React
//  Compiler 把它当普通值缓存了。第一次渲染时加载，之后复用。'''),

    (281, 'before', '''// 【local_command 被伪装成 text 块，复用 UserTextMessage】
//
//  本地命令（比如 /help 的输出）在数据结构上是 system 消息，但显示上应该
//  和用户输入一样（带提示符、可复制）。所以这里现场造一个 `{type:'text'}`
//  对象传进去。
//
//  造出来的对象进 `$[68]` 缓存，依赖是 `message.content` —— 同样内容不会
//  重复造。这是 React Compiler 对「对象字面量」的标准处理：它知道新造的
//  对象每次引用不同，所以按内容依赖缓存。'''),

    (337, 'before', '''// 【collapsed_read_search 的 verbose 是「或」出来的】
//
//  `verbose || isTranscriptMode` —— 在 transcript 模式下强制展开。
//
//  理由是 transcript（ctrl+o）的定位就是「完整历史」，折叠组在那里展开才符合
//  预期。而 prompt 模式下折叠组是一行摘要。
//
//  注意这个计算在 `$[91]` 里缓存，依赖里有 t2（也就是这个或的结果）——
//  所以 verbose 变化和 screen 变化都会正确触发。'''),

    (408, 'before', '''// 【columns - 5：一个没有解释的魔法数字】
//
//  整个文件的注释质量都很高，唯独这里直接减 5 没说明。从上下文推断：工具
//  结果左侧有缩进和边框（大概 5 列），所以可用宽度要扣掉。
//
//  这类数字的问题是**它依赖另一个模块的排版**（UserToolResultMessage 的
//  缩进），而那个模块改动时这里不会跟着变 —— 症状是长行的折行位置偏了
//  几列，不会报错。
//
//  读到这里应该记一笔：如果哪天工具结果的缩进改了，第一个要检查的是这里。'''),

    (454, 'before', '''// 【CONNECTOR_TEXT：一种「长得像新类型、实际是老类型」的块】
//
//  连接器（connector）返回的文本块有自己的类型名，但渲染上完全等价于普通
//  text 块。所以这里做的是**降级转换**：把 connector_text 拆出来，包成
//  `{type:'text'}`，然后走 AssistantTextMessage。
//
//  放在 switch 之前而不是加一个 case，是因为后面所有逻辑（addMargin /
//  shouldShowDot / width）都完全一样 —— 加 case 就要复制一遍。
//
//  代价：这个转换在每次渲染时都做（有缓存槽，按 param.connector_text 缓存）。
//  转换成本是一个对象分配，可以接受。'''),

    (526, 'before', '''// 【redacted_thinking 和 thinking 的显示条件完全相同，但处理不同】
//
//  条件都是 `isTranscriptMode || verbose` —— 普通模式下完全隐藏（思考过程
//  不该占据用户的屏幕）。
//
//  不同的地方：redacted_thinking 没有内容可展开（它是加密过的），所以只画
//  一个占位块；thinking 有内容，要按 isLastThinking 决定是否折叠。
//
//  这个对比说明「显示条件」和「渲染方式」是两件事，即使条件相同也要分开写。'''),

    (544, 'before', '''// 【isLastThinking 的两个分支，null 和「匹配」等价】
//
//  `!lastThinkingBlockId || thinkingBlockId === lastThinkingBlockId`
//
//  lastThinkingBlockId 为 null 时，所有 thinking 块都被判成「最后一个」→
//  全部显示。这和 Messages.tsx 第 395 行那个函数的返回值呼应：
//
//  · null          → 全部显示（这里 `!null` 为真）
//  · 'streaming'   → 全部隐藏（哨兵值，永不匹配）
//  · 'no-thinking' → 全部隐藏（同上）
//  · "uuid:index"  → 只显示那一个
//
//  三个哨兵值的语义全靠这一行的布尔运算实现，没有任何显式分支 —— 这是
//  「用魔法值代替参数」的典型代价：省了一个字段，但语义分散在三个文件里。'''),

    (581, 'before', '''// 【渲染不了的块要 logError，不能静默返回 null】
//
//  两个 default 分支（server_tool_use 里非 advisor 的、以及 switch 末尾）
//  都调了 logError。这很重要：**静默丢弃会让「模型发了个新类型的块」变成
//  一个不可观测的故障** —— 用户看不到东西，开发者也不知道。
//
//  logError 会进日志文件（不是终端），所以不影响 UI，但事后能查。
//
//  这是本文件里唯一一处「错误处理」，而它处理的是**类型演进的兼容性**：
//  API 加了新块类型，旧客户端会走到这里。'''),

    (604, 'before', '''// 【这个比较器比 MessageRow 的那个更简单，因为它的粒度不同】
//
//  MessageRow 管「一行」，要判断流式/解析状态；Message 管「一条消息的渲染」，
//  只需要判断那些**会影响输出**的字段。
//
//  七条判据：
//  1. uuid 变了 → 换消息了
//  2. lastThinkingBlockId 变了且这条有 thinking → thinking 可见性可能变
//  3. verbose 变了 → 折叠状态变
//  4. 「是不是最新 bash」的结果变了
//  5. screen 变了
//  6. containerWidth 变了（终端宽度变了）
//  7. **两边都是 static → 直接返回 true（跳过）**
//
//  第 7 条是核心：如果上一帧判了静态、这一帧也判静态，那这条消息的内容
//  就不会变，跳过。注意它要求**两边都** static —— 单向变化（dynamic→static
//  或 static→dynamic）都要重渲染。'''),
]
