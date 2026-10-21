# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (549, 'before', '''// 【24 个字符，是 deriveUUID 保留的前缀长度】
//
//  为什么不用全 uuid：unseenDivider 记的是「第一条未读消息的 uuid」，而实际
//  渲染的 RenderableMessage 可能是那条消息**派生**出来的（同一个 assistant
//  消息被拆成多个块，每块一个 uuid）。
//
//  派生规则是「保留前 24 字符 + 后缀」，所以按前 24 字符比，能把「源消息」
//  和它的所有派生块一起命中。
//
//  这个数字是**跨两个模块的隐式契约**（deriveUUID 那边定义长度，这边按长度
//  切片）。改动任何一侧都会静默失效 —— 不会报错，只是分隔线不出现在该出现
//  的位置。'''),

    (563, 'before', '''// 【展开状态存在 Messages 这一层，不是每行自己存】
//
//  因为「点 tool_use 展开，它的 tool_result 也一起展开」—— 两行是两个组件
//  实例，各自存状态就无法联动。key 用 tool_use_id 把它们绑在一起。
//
//  `expandedKeys` 用 ReadonlySet + 整体替换，是为了让 isItemExpanded 的
//  依赖只有一个引用，能命中 useCallback 的缓存。'''),

    (580, 'before', '''// 【ref 而不是依赖：为了 callback 的身份稳定】
//
//  注释里那句 "if its identity (or return value) flips during streaming,
//  onMouseEnter attaches after the mouse is already inside → hover never
//  fires" 描述的是一个**终端特有的竞态**：
//
//  鼠标进入事件是一瞬间的事。如果那一刻的 handler 是旧的（或者组件因为
//  callback 换身份而重挂载），这个事件就丢了 —— 而终端不会补发「你现在
//  还在里面吗」。
//
//  DOM 里有 mouseenter/相关的一套补偿机制（relatedTarget），终端里没有。
//  所以终端的 hover 状态完全依赖「进入事件被正确接收」，对身份稳定性比
//  浏览器苛刻得多。'''),

    (595, 'before', '''// 【三个「不许动」的条件，分别对应三种会打架的动画源】
//
//  · toolJSX 存在但没说要继续动画 → 有工具面板在显示，且它自己不动
//  · toolUseConfirmQueue 非空 → 有确认框在等用户输入
//  · isMessageSelectorVisible → 消息选择器打开着
//
//  共同点是：这些情况下屏幕上有**别的**动画/交互在进行，再让 spinner 转
//  会让画面变成多个不同频率的闪烁源。
//
//  注意第一个条件是 `!toolJSX || !!toolJSX.shouldContinueAnimation` ——
//  用的是「或」，即「没面板」或「面板自己也要动」都允许。'''),

    (603, 'before', '''// 【进度上报的三个否定条件，其中两个是「会打架」，一个是「没意义」】
//
//  · terminalProgressBarEnabled 关闭 → 用户不要
//  · getIsRemoteMode() → 远端模式下进度条在**服务端**的终端里，不是这里
//  · isProactiveActive() → 主动模式下没有「等待用户」这个概念
//
//  第二个容易忽略：remote 模式下这个进程不是用户正在看的那个终端，发
//  OSC 9;4 只会让另一台机器上的进度条乱跳。'''),

    (614, 'before', '''// 【renderMessageRow 不是组件，是「渲染函数」】
//
//  它被两处以不同方式调用：`flatMap(renderMessageRow)`（每项返回一个元素）
//  和 `renderItem={renderMessageRow}`（虚拟列表逐项调）。
//
//  所以它的返回值必须兼容两种消费方式 —— 而且注意它**可能返回数组**
//  （第 632 行那个 unseenDivider 分支）。flatMap 会把数组摊平，虚拟列表那边
//  则是把一个数组当一个 item 渲染。这是两种语义，靠调用方恰好都能接受。
//
//  这种「一个函数两种消费契约」是隐式的，改动返回值形状时要两个调用方都看。'''),

    (622, 'before', '''// 【这个扫描只对 collapsed_read_search 做】
//
//  因为只有折叠组需要判断「我是不是最后一个还在动的东西」—— 如果是，它
//  保持现在时（"Reading…"）；如果后面还有内容，它切过去时（"Read 3 files"）。
//
//  对其他类型算这个值是纯浪费（要扫到数组末尾）。所以条件是
//  `msg.type === 'collapsed_read_search' && (...)`，短路掉。
//
//  streamingText 被显式 OR 进来，理由在注释里：它是渲染在这个 map 之外的
//  兄弟节点，不在 renderableMessages 里，扫不到。不加这一项，文字开始流式
//  之后折叠组还要等一个渲染周期才切时态。'''),

    (624, 'before', '''// 【verbose 的三个来源，用 OR 叠起来】
//
//  verbose（全局） || isItemExpanded(单条展开) || (光标在这一行且光标态是展开)
//
//  第三个条件里的 `cursor?.expanded === true && index === selectedIdx` 要注意
//  优先级：`||` 是左结合的，所以它是 `(verbose || isItemExpanded) || (cursor
//  条件)`，语义正确但读起来容易误判成 `cursor?.expanded === (true && ...)`。
//
//  这也是为什么 `cursor?.expanded === true` 要显式写 `=== true` —— 如果写
//  `cursor?.expanded`，类型是 boolean | undefined，参与 || 时语义相同，但
//  和后面的 `&&` 混在一起时优先级就更容易看错。'''),

    (628, 'before', '''// 【Provider 必须在 MessageRow 外面，理由和 React 的 context 语义有关】
//
//  选中状态如果当 prop 传进 MessageRow，就得加进 memo 比较器 —— 而那是每行
//  都要比一次的字段，2800 条消息就是 2800 次比较。
//
//  放成 context 之后，机制是三步：
//
//  1. value 变 → Provider 重渲染 → 新的 row 元素传给 MessageRow
//  2. MessageRow 的 memo 比较器看 message 引用没变，**bail out**（不重渲染）
//  3. 但 React 的 context 更新会**穿透** bail out 的子树，直接通知消费者
//
//  第 3 步是关键，也最容易误解：memo 拦住的是 prop 驱动的重渲染，拦不住
//  context 传播。所以「跳过重渲染」和「拿到新值」可以同时成立。
//
//  代价：只有真正调了 useSelectedMessageBg 的组件更新，其余整行一个字都不
//  重算 —— 这就是注释里 "only 2 rows re-render" 的来源。'''),

    (631, 'before', '''// 【返回数组而不是 Fragment，是有理由的】
//
//  注释在第 691 行那段：用数组 + 各自的 key，可以让分隔线成为一个**独立
//  的兄弟节点**。这样分隔线出现/消失时，两侧的 MessageRow 的 key 不变，
//  React 不会重挂载它们。
//
//  如果用 Fragment 包起来，分隔线增删会让整个 Fragment 的 children 数量
//  变化 —— React 仍然能按 key 复用，但 Ink 的宿主实现里，兄弟节点数量的
//  变化会触发 insertBefore / removeChild 的组合操作，比单纯 append 更容易
//  踩到「yoga 下标换算」的坑（见 dom.ts 的批注）。'''),

    (649, 'before', '''// 【WeakMap 键是消息对象，不是 uuid】
//
//  用对象当键，好处是消息被移出数组后缓存自动回收（没有手动清理逻辑）；
//  坏处是**每次消息对象换新引用（流式更新），缓存就失效**。
//
//  这里是划算的：搜索文本只在搜索期间被读，而搜索期间消息基本不再变化。
//
//  另外注意 `useRef(new WeakMap())` —— 每次 render 都会 new 一个 WeakMap，
//  只是 ref 只保留第一个。这是个常见的小浪费（一个对象分配 + 一次 GC），
//  不影响正确性，但能看出这里没走「惰性初始化」的写法。'''),

    (665, 'before', '''// 【undefined 和空字符串的区别，是这段代码里唯一一处「三态」】
//
//  · undefined  → 工具没实现 extractSearchText，用启发式的 renderableSearchText
//  · ''         → 工具说「这条结果没什么可索引的」，尊重它，索引为空
//  · 其他       → 用工具给的
//
//  如果把 '' 也当成「没实现」，日志类的大段输出会被启发式扫出几千个字，
//  搜索时到处命中。三态在这里不是洁癖，是必需的。'''),

    (673, 'before', '''// 【在缓存里存小写，而不是每次查的时候转】
//
//  注释给了权衡："~same steady-state memory for zero per-keystroke alloc"。
//
//  关键在于**读的次数远多于写**：缓存写一次，搜索时每敲一个键要对所有消息
//  做 indexOf。把 toLowerCase 挪到写侧，等于把 N 次分配变成 1 次。
//
//  这是「预计算放在哪一侧」的标准答案：**在频率低的那一侧做，在频率高的
//  那一侧用**。'''),

    (679, 'before', '''// 【chunk 0 才画 logo】
//
//  renderRange 是分块导出的（/export 大对话时分片渲染）。第 0 片是对话开头，
//  画 logo；后续分片是「流的中段」，画 logo 会让导出文件里出现多个 logo。
//
//  判据是 `renderRange[0] > 0`，而 renderRange 为 undefined 时（正常渲染）
//  条件里的第一项 `renderRange &&` 直接短路成 undefined，取反为 true → 画。'''),

    (699, 'before', '''// 【两条渲染路径，差别不只是「性能」】
//
//  · 虚拟列表：只有视口附近的 item 挂载。ScrollBox 自己裁剪，没有终端
//    scrollback，所以不能靠「滚出去的内容还在原生缓冲区里」这个假设。
//  · flatMap：全部挂载，靠终端原生 scrollback 承载历史，靠 cap 限制上界。
//
//  注意 InVirtualListContext 只在这一条分支里提供，值恒为 true。它的消费
//  者是 OffscreenFreeze —— 虚拟列表里不应该冻结（见 OffscreenFreeze 的
//  注释：冻结会挡住点击展开，因为两套可见性计算会打架）。'''),

    (703, 'before', '''// 【streamingText 渲染在 map 之外，是有意的】
//
//  Props 注释说 "rendered as last item so transition to final message is
//  positionally seamless" —— 它必须出现在所有消息之后，且样式和最终消息
//  一致。这样「流式文本」变成「正式消息」时，那一行在原地不动。
//
//  如果把它塞进 renderableMessages，它会拿到一个 uuid，转换时要换 key，
//  于是 React 会「卸载旧的 + 挂载新的」—— 屏幕上表现为那一块闪一下。
//
//  这是「用位置保证视觉连续」的例子：宁可让渲染路径多一个兄弟节点，也不
//  让同一个视觉元素换身份。'''),

    (725, 'before', '''// 【tool_use_id 优先，uuid 兜底】
//
//  因为 tool_use 和它的 tool_result 是**两条不同的消息**（不同 uuid），
//  但它们应该一起展开/折叠。tool_use_id 是它们共享的字段。
//
//  grouped_tool_use / collapsed_read_search / thinking 没有 tool_use_id
//  （或者有多个），只能用 uuid。
//
//  注意 getToolUseID 只对 assistant / user 返回非空 —— 所以这个三元实际上
//  是「先判类型，再取 id」。'''),

    (741, 'before', '''// 【自定义比较器比默认的浅比较**更宽松**】
//
//  默认浅比较：任何 prop 换引用就重渲染。
//  这里：换引用之后还要再检查「内容是否等价」，等价则跳过。
//
//  三个等价判断对应三种「必然换引用但内容可能没变」的情况：
//  · streamingToolUses —— 每个 delta 都新建数组
//  · inProgressToolUseIDs —— 每次工具状态变化都新建 Set
//  · unseenDivider —— 每次全屏布局重算都新建对象
//  · tools —— 会话级稳定，但数组本身可能被重建
//
//  而 streamingThinking **故意不做**等价判断（注释第 772 行）—— 它一变就
//  必须重渲染，因为它的内容就是屏幕内容。'''),

    (744, 'before', '''// 【豁免列表里的九个 prop，分三类】
//
//  1. 回调类：onOpenRateLimitOptions / setCursor / onSearchMatchesChange /
//     scanElement / setPositions —— 换引用不影响输出
//  2. ref 类：scrollRef / cursorNavRef / jumpRef —— 同上
//  3. 跟踪开关：trackStickyPrompt —— 变化时不需要重算消息
//
//  这个列表是**手写的**，所以它和 Props 定义之间存在漂移风险：新增一个
//  回调 prop 而忘了加进来，会导致每次父组件重渲染都打穿这层 memo。
//
//  注意 `cursor` 不在豁免列表里 —— 选中变化需要重渲染，这是对的。'''),

    (779, 'before', '''// 【「静态」的意思是：这一行以后不会再变了，可以一次性写进 scrollback】
//
//  这是整个 UI 层最重要的一个判据。它决定的不只是「要不要重渲染」，而是
//  **这一行能不能被 Ink 的 log-update 当作不可变内容推到终端上方**。
//
//  一旦判定为静态，这一行会被写进终端原生 scrollback —— 之后再想改它，
//  只能靠全量重置（因为它已经在视口之外了）。所以这里宁可保守：
//  拿不准就返回 false（动态）。
//
//  五个 case 分别的保守程度都不同，见下面几处锚点。'''),

    (790, 'before', '''// 【server_tool_use 单独判，因为它没有 tool_result 走同一套 lookup】
//
//  服务端工具（web_search 这类）由 API 侧执行，结果直接内联在后续的
//  assistant 消息里，不产生独立的 tool_result 消息。所以「等 resolve」
//  这件事只能看 resolvedToolUseIDs 里有没有这个 id。
//
//  如果漏了这个特判，它会落到下面 getToolUseID 的分支 —— 而
//  getToolUseID 对 server_tool_use 返回什么取决于实现，很可能返回 null
//  → 直接判为静态 → 结果还没回来就被推上 scrollback → 结果到了只能全量重置。'''),

    (807, 'before', '''// 【PostToolUse hook 没跑完，这条消息就不能算静态】
//
//  因为 hook 的执行进度会作为 ProgressMessage 显示在这条 tool_use 下面。
//  一旦推上 scrollback，进度更新就得靠全量重置。
//
//  这条判据比前面几条更隐蔽：它依赖的是**另一个维度的数据**（lookups 里的
//  hook 状态），而不是消息本身。读的时候容易以为「tool 已经 resolve 了就
//  完事了」。'''),

    (810, 'before', '''// 【最后一道：所有兄弟 tool_use 都 resolve 了才算静态】
//
//  为什么看兄弟：同一个 assistant 消息里的多个 tool_use 是并行执行的，只要
//  还有一个在跑，整组的高度就可能变（下面要插进度行）。把其中一个单独推上
//  scrollback，剩下的再撑高，屏幕就错位了。
//
//  `every(集合, 另一个集合)` 是 src/utils/set.js 里的工具，语义是「集合 A
//  的每个元素都在 B 里」。注意它是「A 全部包含于 B」，不是「A == B」。'''),

    (816, 'before', '''// 【api_error 永远动态，理由和别的相反】
//
//  其他 system 消息判静态是因为「它不会再变」；api_error 判动态是因为
//  「它随时会消失」—— 只要看到下一条非错误消息，这条就被隐藏了。
//
//  所以它的「不再变」是假的：它会被**移除**。静态化之后移除只能全量重置。
//
//  这是本函数里唯一一个「内容不变但存在性会变」的 case，判据从「内容是否
//  稳定」换成了「这条消息还会不会存在」。'''),

    (826, 'before', '''// 【在 prompt 模式永远不静态，transcript 模式永远静态 —— 两个方向都极端】
//
//  顶部的 `if (screen === 'transcript') return true` 已经拦掉了后一半，所以
//  走到这里的只可能是 prompt 模式，直接 false。
//
//  理由在注释里："to prevent flicker between API turns"。折叠组的时态
//  （"Reading…" → "Read 3 files"）和它的可点击性都在变，一旦推上 scrollback，
//  每次时态切换都要全量重置 —— 而折叠组恰恰是最频繁切换的东西（每次工具
//  开始/结束）。'''),
]
