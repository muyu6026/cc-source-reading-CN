# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  PromptInput.tsx：2338 行，整个产品只有一个输入框
// ═══════════════════════════════════════════════════════════════
//
//  这是 components 目录里最大的单文件（除 Messages.tsx 外）。它为什么这么大？
//
//  因为它同时是六种东西：
//
//    ① 文本框           —— 光标、选区、多行、vimpl 模式、粘贴
//    ② 命令面板         —— / 命令补全、@ 文件补全、参数提示
//    ③ 通知中心         —— 十几种一次性提示（ultrathink / 模型切换 / 存草稿…）
//    ④ 导航器           —— footer 药丸的上下左右、任务列表、队友切换
//    ⑤ 弹窗宿主         —— 模型选择、快速打开、历史、任务、团队、Bridge…
//    ⑥ 提交前的总闸     —— 一大堆守卫（建议在显示、footer 有选中、正在看队友…）
//
//  「输入框」在终端应用里就是这个地位：**它是唯一能接收按键的地方**，
//  所以所有交互都必须先经过它，或者至少要在它这里让路。
//
//  读这个文件的唯一正确方式：**按 hook 分组读，不要按行读**。
//  1-1230 是状态与派生值，1230-1700 是一堆 handler，1700-1960 是键位注册，
//  1960-2338 是渲染与早退。下面每一段批注都标了它属于哪一组。'''),

    (124, 'before', '''// 【Props：39 个字段，其中一半是「回传的 setter」】
//
//  这个签名暴露了一个架构事实：**PromptInput 不持有业务状态**。
//  输入的文本、模式、粘贴内容、草稿、vim 模式、搜索状态，全都由 App 持有，
//  通过 props 传进来、回调传出去。
//
//  好处：输入框可以随时卸载重挂（比如切到全屏再切回来），状态不丢。
//  代价：这个组件变成了「巨型回调汇聚点」——39 个字段里，光 set* 就有 9 个。
//
//  三个值得单独看的字段：
//    · insertTextRef —— 反向通道。父组件拿一个 ref，往里塞一个 insert 函数，
//      让语音转写这类外部系统能在光标处插字（第 268 行赋值）。
//    · getToolUseContext —— 传的是**函数**而不是值，因为要打开任务对话框时
//      才需要构造上下文（构造有成本，且依赖那一刻的 messages）。
//    · onSubmit —— 签名极长（含 speculation 对象），因为提交有四种模式：
//      普通、接受推测、接受显式推测、按键触发。'''),

    (191, 'before', '''// 【两个常量定义了「输入框最少占几行」】
//
//  PROMPT_FOOTER_LINES = 5：给 footer / 边框 / 状态行预留的行数。
//  MIN_INPUT_VIEWPORT_LINES = 3：输入框至少显示 3 行（哪怕终端很矮）。
//
//  它们在第 1999 行一起用：
//
//      maxVisibleLines = isFullscreen ? max(3, floor(rows/2) - 5) : undefined
//
//  逻辑是「输入框最多占一半屏，但要先扣掉 footer 的 5 行」。
//  为何是一半：输入框是临时内容，正文才是主体。用户写长 prompt 时会滚动查看，
//  但绝不会希望输入框挤满整个屏幕。
//
//  undefined 在非全屏时表示「不限制」—— 因为普通模式有 scrollback，
//  输入框长高了往上顶就行，不会破坏任何东西。'''),

    (244, 'before', '''// 【把「本地 JSX 命令」也算成模态遮罩】
//
//  isModalOverlayActive 有两个来源：
//    1. 正规的 overlay 系统（useIsModalOverlayActive）
//    2. 本地的全屏 JSX 命令（isLocalJSXCommandActive）
//
//  第 239-243 行的注释解释了为什么第 2 种要手动并进来：像 /mcp 这种命令
//  会盖住输入框，但它们**没有在 overlay 系统里注册**。如果不并入，
//  上下键会同时被输入框和弹窗处理，结果是「按一下 ↓，弹窗里动一格，
//  输入框里的建议也动一格」，甚至叠出第二个弹窗。
//
//  这个布尔值后面被用在十几处 isActive 判断里 —— 它本质上是一个
//  「现在谁能接收按键」的总闸。**终端 UI 没有焦点系统，焦点是这个组件自己算的。**'''),

    (252, 'before', '''// 【光标位置是本地状态，但输入文本不是】
//
//  cursorOffset 用 useState 存在这里，而 input 从 props 来。
//  这个不对称带来一个必须解决的问题：**外部改了 input，光标怎么办？**
//
//  第 255-260 行就是答案，而且是一个很少见的写法：**渲染期 setState**。
//
//      const lastInternalInputRef = useRef(input)
//      if (input !== lastInternalInputRef.current) {
//        setCursorOffset(input.length)
//        lastInternalInputRef.current = input
//      }
//
//  逻辑是：如果新的 input 不等于「上一次由我们内部设置的 input」，
//  说明是外部改的（语音转写、IDE 注入、历史回填），那就把光标挪到末尾。
//
//  React 允许渲染期 setState（它会把这次渲染重做一遍），但要求条件是
//  「基于 props/state 的纯计算」。这里能成立的关键是那个 ref：
//  它在第一次渲染时被写入，所以第二次渲染不会再触发（ref 不参与重渲染）。
//
//  为什么不用 useEffect：effect 要等提交后跑，用户会先看到「文本变了但光标
//  还在旧位置」的一帧。在终端里一帧就是一次可见的重绘。'''),

    (268, 'before', '''// 【渲染期间给 ref 赋值：一个「命令式出口」】
//
//  insertTextRef 是父组件传进来的 MutableRefObject。这里每次渲染都重新
//  往里写一个对象（含 insert 和 setInputWithCursor），意味着：
//
//    · 父组件随时可以调 insertTextRef.current.insert('文字')
//    · 调到的永远是「最新一次渲染」的版本（闭包里的 cursorOffset、input 都是新的）
//
//  如果不用这个模式，父组件就只能拿一个陈旧的函数（第一次渲染时的闭包），
//  插字时会用旧光标位置，把文字插到错误的地方。
//
//  第 272 行那个 needsSpace 判断很细：如果光标在末尾、输入非空、且末尾不是空白，
//  就先补一个空格。因为语音转写是连续注入的，不补空格会粘成一片。
//
//  这类「ref 里放最新函数」的模式，React 文档里叫 latest ref pattern。
//  它是 useImperativeHandle 的手工版，比 useImperativeHandle 更灵活
//  （能传多个方法、能读到最新 state），代价是要自己在渲染期写。'''),

    (366, 'before', '''// 【-1 当哨兵，因为 0 是合法的粘贴 ID】
//
//      const nextPasteIdRef = useRef(-1)
//      if (nextPasteIdRef.current === -1) {
//        nextPasteIdRef.current = getInitialPasteId(messages)
//      }
//
//  注释（第 362-365 行）点出了真正的原因：`useRef(getInitialPasteId(messages))`
//  会在**每次渲染时都调用** getInitialPasteId（虽然结果被丢弃），
//  而那个函数要遍历所有消息 + 正则扫描每个文本块。7 轮对话后这可能涉及
//  上千条消息，每敲一个字都扫一遍，是纯粹的浪费。
//
//  所以用一个「不可能的值」当哨兵，实现惰性初始化。
//  为什么不用 null：因为 useRef 的类型推断会变成 `number | null`，
//  后面每次用都要收窄。用 -1 保持了 number 类型，代价是「-1 不能是合法 ID」这个约定。
//
//  getInitialPasteId 的作用是避开 --continue / --resume 场景下的 ID 冲突：
//  历史消息里可能已经有 [Image #3]，新粘贴必须从更大的号开始。'''),

    (373, 'before', '''// 【pendingSpaceAfterPillRef：一个「等下一个键」的延迟动作】
//
//  需求：粘完一张图后，输入框里出现 `[Image #1]`，用户接着打字。
//  如果不加空格，会变成 `[Image #1]hello` —— 图后面直接粘着文字。
//  但如果用户粘完图就按了回车，多出来的空格又很碍事。
//
//  解法：粘图时不加空格，**只「武装」一个标记**。下一个键进来时判断：
//    · 是可打印字符 → 补一个空格，然后清标记
//    · 是任何其他输入（方向键、退格、粘贴、空格本身）→ 只清标记，不补
//
//  这个判断的实现在第 1241 行的 lazySpaceInputFilter：
//  它作为 inputFilter 传给 TextInput，在每次输入前跑一遍。
//
//  **「延迟到下一个动作再决定」** 是处理这类「需要预判用户意图」需求的标准手法。
//  它的好处是永远不会多插（因为多插之后用户还得删），坏处是有状态
//  （多一个 ref），而且只对「下一个键」有效。'''),

    (394, 'before', '''// 【-1 哨兵 + 动态下限：同一个「选中」概念，两个最小值】
//
//  coordinatorTaskIndex 的 -1 表示「停在任务胶囊上，还没进入具体任务行」。
//  但第 394 行发现了一个边界：胶囊本身可能不存在。
//
//    胶囊 → 只在有「非 local_agent 的后台任务」时才渲染
//    任务行 → 协调者模式下有 local_agent 任务就会出现
//
//  如果只有任务行、没有胶囊，那 -1 就指向一个**看不见的东西**：
//  用户按 ↓ 选中的是一个不存在的元素，屏幕上没有任何高亮，看起来像卡住了。
//
//  所以 minCoordinatorIndex 动态变化：有胶囊时是 -1，没胶囊时是 0。
//  第 397-403 行的 effect 负责把 index 钳回合法范围 ——
//  因为任务会结束、列表会缩短，光标可能落在不存在的行上。
//
//  这类「索引型状态 + 列表会缩短」的组合，**必须有一个钳制 effect**，
//  否则就会读到 undefined 然后安静地什么都不做（比报错更难查）。'''),

    (450, 'before', '''// 【footer 药丸的导航：顺序就是数组顺序，没有第二套映射】
//
//  注释（第 450-453 行）说得很好：**Order here IS the nav order**。
//  也就是说「用户按 ↓ 会去哪」这件事，完全由下面 footerItems 的拼装顺序决定，
//  没有任何单独的导航配置表。
//
//  这个设计的好处是不会出现「显示顺序和导航顺序不一致」的 bug
//  （那是菜单类 UI 最常见的 bug）。坏处是调整顺序时容易只改了渲染、
//  忘了这里就是导航定义。
//
//  第 451 行还有一句关键约束：down/right = 前进，up/left = 后退。
//  四个方向键映射成两个动作（±1），所以不需要四份代码。
//
//  第 452-453 行：选中状态存在 AppState 里，而不是组件 state。
//  原因很具体 —— 有些药丸（CompanionSprite）渲染在 PromptInput 之外，
//  它们也要读到「我现在被选中了吗」。**跨组件边界的焦点状态必须上提。**'''),

    (460, 'before', '''// 【footerItems：一行代码定下导航顺序，同时过滤掉不可见项】
//
//      [tasksFooterVisible && 'tasks', tmuxFooterVisible && 'tmux', …]
//        .filter(Boolean)
//
//  这个写法的巧妙之处：`false` 会被 filter 掉，所以不需要 if。
//  代价是类型上要 `as FooterItem[]`（因为数组元素类型是 `false | 'tasks' | …`）。
//
//  顺序背后的产品判断：tasks 第一（最常用），tmux 第二（内部功能），
//  然后是 bagel（浏览器）、teams、bridge、companion。越靠前越容易按到
//  （因为从输入框按 ↓ 一次就到第一个）。
//
//  第 458 行 tasksFooterVisible 的条件里藏着那句 `"external" === 'ant'`：
//  对外构建里它恒假，于是条件退化成「有任务在跑 且 不该隐藏」。
//  也就是说**协调者模式的任务面板在对外版本里根本不存在**。'''),

    (467, 'before', '''// 【派生值 vs 原始值：一个「立刻正确」+ 一个「迟早清理」】
//
//  这是本文件里最值得学的一个模式：
//
//      const rawFooterSelection = useAppState(s => s.footerSelection)   // 原始
//      const footerItemSelected = rawFooterSelection && footerItems.includes(raw)
//        ? rawFooterSelection : null                                   // 派生
//
//  raw 可能是过期的：选中的是 bridge 药丸，但连接断了、药丸不渲染了。
//  这时：
//    · **派生的 footerItemSelected 立刻变 null** → UI 当帧就正确
//    · **第 468 行的 effect 再把 raw 清成 null** → 防止「将来药丸又出现时
//      焦点凭空回到它身上」（比如新任务开始，tasks 药丸重新出现，用户按 ↓
//      却直接跳到了 tasks 上）
//
//  两个状态，一个负责「现在对不对」，一个负责「以后别诈尸」。
//  只用派生值：raw 会一直是脏的。只用 raw：会有一帧的错位。
//
//  注释里那句 "so it doesn't resurrect when the same pill reappears"
//  就是这个模式存在的全部理由。'''),

    (494, 'before', '''// 【navigateFooter：返回布尔值，因为「有没有动」要告诉调用方】
//
//      navigateFooter(delta, exitAtStart = false): boolean
//
//  三种情况：
//    1. 下一个位置存在 → 选中它，返回 true
//    2. 到头了但 delta 是 -1 且允许「退出」→ 取消选中，返回 true
//    3. 到头了且不允许退出 → 返回 false
//
//  返回 false 的意义：调用方（↓ 键的处理）要知道「footer 这边接不住这个键」，
//  于是可以把键让给别的处理器（比如把焦点还给输入框）。
//
//  这是终端按键处理里的通用约定：**handler 返回 true/false 表示「消费了没有」**。
//  不消费就让事件继续冒泡。第 1841 行的 footer:close 也是同样思路
//  （返回 false 让 'x' 落进输入框）。
//
//  注意 exitAtStart 只在向上时生效：从第一个药丸再往上，应该「退出 footer 回到输入」，
//  而不是卡住。向下则不退出 —— 因为下面没有别的东西了。'''),

    (518, 'before', '''// 【displayedValue：屏幕上显示的文本 ≠ 状态里的文本】
//
//      isSearchingHistory && historyMatch ? getValueFromInput(historyMatch…) : input
//
//  在 ctrl+r 搜历史时，输入框显示的是**历史匹配项**，而 input 仍然是用户
//  正在输入的搜索词。于是整个渲染链（高亮、宽度、光标）都要基于 displayedValue，
//  而提交、编辑、写入仍然基于 input。
//
//  这就是「两本账」：**显示账和状态账**。整个文件里所有和「显示」有关的
//  计算（下面十个 useMemo 全是）都用 displayedValue，
//  所有和「数据」有关的操作用 input。
//
//  混用会出两种 bug：用 input 算高亮 → 搜索时高亮位置全错；
//  用 displayedValue 提交 → 用户搜到的东西被当成输入发出去。
//
//  getValueFromInput 还顺手剥掉了 bash 模式的 ! 前缀 —— 因为搜索框里
//  不该显示那个模式字符。'''),

    (519, 'before', '''// 【十个独立的「触发器扫描器」，每个都返回位置区间】
//
//  从第 519 行到第 538 行，连续十个 useMemo，形状完全一样：
//
//      useMemo(() => feature 关闭 ? [] : findXxxPositions(displayedValue), [deps])
//
//  扫的东西分别是：思考关键字、ultraplan、ultrareview、/btw、/buddy、
//  斜杠命令、token 预算、slack 频道、@队友、图片引用。
//
//  为什么拆成十个而不是一个扫描器：**每个的开启条件不同**。
//  三个被 feature 门控（编译期剔除）、一个被用户设置控制（ultrareview）、
//  一个依赖外部订阅（slack 频道版本号）。合成一个的话，条件会变成
//  「十个开关的笛卡尔积」，不可维护。
//
//  代价是每次输入变化跑十次正则扫描。但每个扫描都只遍历一遍短字符串
//  （输入框通常几十到几百字符），总量可忽略 —— **拆开的可读性收益远大于开销**。'''),

    (526, 'before', '''// 【斜杠命令要再过滤一遍「是不是真的存在」】
//
//      findSlashCommandPositions 找出所有 `/xxx` 的位置
//      → filter: hasCommand(name, commands) 只留真实存在的命令
//
//  为什么扫描器不自己过滤：因为扫描器（utils/suggestions/commandSuggestions.js）
//  只看文本形状，不认识命令表。**形状识别和语义校验是两个层次**，
//  分开之后扫描器可以被复用到别处（比如判断「这行是不是命令」）。
//
//  效果差异很直观：用户打 `/foo bar`，如果 foo 不存在，`/foo` 不会被染成蓝色。
//  用户一眼就知道「这个命令没有」。
//
//  注意 slice(pos.start + 1, pos.end) 那个 +1：跳过 `/` 本身。
//  pos.end 是**不含**的右边界，所以这段切片正好是命令名。'''),

    (557, 'before', '''// 【@名字的正则要有「前导边界」，不能只匹配 @】
//
//      /(行首或空白)@(字母数字下划线连字符)/ 加 g 全局标志
//
//  两个细节：
//    · (行首竖线空白) —— 前面必须是行首或空白。否则 `a@b.com` 里的 @b 会被当成
//      队友名。邮箱地址在 prompt 里太常见了，不加这个边界会产生大量误判。
//    · 后半段是字母数字下划线加连字符。队友名允许连字符（比如 ui-designer），
//      不允许点、空格、中文 —— 因为这是「团队标识符」，不是显示名。
//
//  第 561-563 行还要再算一次位置：match.index 是 `(行首竖线空白)` 那个组的起点，
//  要跳过前导空白。fullMatch.trimStart() 得到 `@名字` 的长度，
//  于是 end = nameStart + 长度。**正则里有分组时，下标计算必须逐个校正**，
//  这是最容易差一位的地方。
//
//  最后的判断是 member?.color：只有真在团队表里、且有颜色的名字才高亮。
//  也就是说这里同时做了「识别」和「校验」，和上面斜杠命令的两层结构不同 ——
//  因为「是不是队友」这个判断需要的数据就在手边（teamContext），
//  不值得再拆一层。'''),

    (589, 'before', '''// 【反色胶囊就是光标 —— 这句话是整段的设计核心】
//
//  注释（第 586-588 行）：
//
//      chip.start is the "selected" state: the inverted chip IS the cursor.
//      chip.end stays a normal position so you can park the cursor right after
//      `]` like any other character.
//
//  `[Image #1]` 是一段不可分割的文本（chip）。光标停在哪：
//    · 停在 start（左边界）→ 这个 chip 反色显示，表示「已选中，按退格删掉它」
//    · 停在 end（右边界）→ 正常光标，表示「就在它后面，可以继续打字」
//
//  两个位置都合法，但语义不同。所以 start 是「选中态」，end 是「普通位置」。
//
//  这和文本编辑器的「对象选中」是一个概念：图片不是字符，不能逐字符编辑，
//  只能整体选中/整体删除。终端里没有真正的「对象模型」，所以用反色来模拟。
//
//  cursorAtImageChip 这个布尔值后面传给 TextInput 的 showCursor={false}——
//  因为此时「光标」已经由反色块表达了，再画一个竖线会出现两个光标。'''),

    (594, 'before', '''// 【把落进 chip 内部的光标「吸附」到最近的边界】
//
//  怎么会出现「在 chip 内部」：方向键上下移动、全屏模式下点击，
//  都会算出任意位置 —— 而这些操作不知道 chip 的存在。
//
//  处理方式：算中点，偏左就吸附到 start，偏右吸附到 end。
//  效果类似「磁吸」：光标永远不会停在 `[Ima|ge #1]` 这种位置。
//
//  为什么必须吸附而不是允许停在内部：因为 chip 是整体删除的
//  （退格删整个引用），如果光标在内部，用户按退格会得到一个
//  「删了一半的引用」—— 那个字符串不再匹配引用格式，附件就变成孤儿了。
//
//  这个 effect 的依赖是 [cursorOffset, imageRefPositions]，注意它会在
//  **每次光标移动时**执行。所以吸附逻辑必须非常便宜（一个 find，量级是个位数）。
//
//  一个容易忽略的细节：setCursorOffset 在这里被调用，会触发一次额外渲染。
//  React 会批处理，但如果 find 找到的 inside 恰好等于当前位置（不可能，
//  因为条件是严格不等），就会死循环。条件写 > 和 < 而不是 >= <=，就是为了这个。'''),

    (601, 'before', '''// 【combinedHighlights：一个数组里按 priority 决定谁盖谁】
//
//  九种高亮全塞进一个数组，每一种带一个 priority 数字：
//
//    20 历史搜索匹配（最高，因为它就是用户当下在找的东西）
//    15 /btw 关键字
//    10 彩虹词（ultrathink / ultraplan / ultrareview / buddy）
//     8 图片胶囊反色
//     5 斜杠命令 / token 预算 / slack 频道 / @队友
//     1 语音的临时转写文字（最弱，只是变暗）
//
//  渲染层（segmentTextByHighlights）按 priority 排序后依次覆盖 ——
//  也就是**分段函数**：每一格取「覆盖它的最高优先级」的那个样式。
//
//  为什么 @队友 (5) 低于彩虹词 (10)：因为 @名字 和 ultrathink 可能重叠
//  （`@bob ultrathink` 不重叠，但 `ultrathink @bob` 中如果队友叫 ultrathink…）。
//  实际上这个优先级表真正的意义在于「重叠时谁赢」，而重叠最常见的场景是
//  斜杠命令里带 @（`/review @bob`）—— 这时命令的蓝色赢，因为
//  @bob 在命令参数里不是「队友提及」而是普通文本。
//
//  **优先级数字不是重要性排序，是冲突解决顺序。**'''),

    (686, 'before', '''// 【彩虹高亮：一个字符一个 highlight】
//
//  为了做出「每个字颜色不同」的效果，这里对一个词的每个字符都 push 一条
//  独立的 highlight：start=i, end=i+1，颜色由 getRainbowColor(偏移) 算。
//
//  一个五个字母的词就产生五条记录。看起来很低效，但这正是终端渲染的
//  唯一实现方式 —— 没有渐变，只能逐格上色。
//
//  注意每条还带了 shimmerColor（第二个参数传 true 得到「亮版本」），
//  于是 ShimmeredInput 会把它当成流光的候选，逐字符渲染 ShimmerChar。
//  也就是说**彩虹和流光用的是同一套机制**：color 定底色，shimmerColor 定高光。
//
//  这段代码出现了四遍（ultrathink / ultraplan / ultrareview / buddy），
//  每遍 12 行，只有触发器和 feature 条件不同。没有抽成函数，是因为
//  feature() 必须在调用点才能被编译期折叠 —— 抽成函数就折不动了
//  （函数体是共享的，无法为不同调用点生成不同产物）。
//
//  这是个「为构建工具让步，牺牲 DRY」的典型例子。'''),

    (748, 'before', '''// 【三个「触发器一出现就弹提示」的 effect，结构完全一样】
//
//      if (有触发器 && 功能开着) addNotification({key, text, timeoutMs})
//      else removeNotification(key)
//
//  三个 key 分别是 ultrathink-active / ultraplan-active / ultrareview-active。
//
//  设计要点有三：
//    1. **用固定的 key**：通知系统按 key 去重，同一个 key 重复 add 只更新时间，
//       不会堆出三条一样的话。
//    2. **else 分支必须 remove**：用户把关键词删掉后，提示要立刻消失。
//       这是提示类 effect 最常见的遗漏点。
//    3. **依赖只放 length**：`[addNotification, removeNotification, thinkTriggers.length]`
//       —— 位置变了但数量没变（比如关键词往后挪了几格）不会重跑，
//       因为提示内容一样，没必要。
//
//  唯一不一致的是第三个（ultrareview）：它**没有 else 分支**。
//  也就是说提示弹出后，删掉关键词它也不会立刻消失，要等 5 秒 timeout。
//  这是三处复制粘贴留下的不一致 —— 影响很小（提示本来就会自动消失），
//  但这种「三份几乎一样、其中一份少了行」的代码，是将来改需求时最容易出错的地方。'''),

    (793, 'before', '''// 【「用户慢慢把输入删光了」—— 靠两个 ref 记录峰值和上一次长度】
//
//  需求：用户写了一大段，然后一个个删掉。这时候提示他「ctrl+s 可以存草稿」。
//  但如果他是按了 esc esc 一键清空，就不该提示（他明显是故意的）。
//
//  怎么区分：看**变化是一次性还是渐进的**。
//
//    peakLengthRef  记录这段输入的峰值长度（只在变长时更新）
//    prevInputLengthRef 记录上一次渲染时的长度
//
//  第 813-814 行两个判据：
//    clearedSubstantialInput = peak >= 20 && current <= 5     峰值够高，现在快没了
//    wasRapidClear           = prev >= 20 && current <= 5     上一帧还在 20+，这一帧就没了
//
//  前者是「确实删掉了大量内容」，后者是「这一步删得太猛，像是快捷键」。
//
//  这两个判据**只在渐进删除时同时成立一个**：一步步删，prev 会跟着降，
//  所以 wasRapidClear 是假；一键清空，prev 还是 20+，两个都真 → 不提示。
//
//  第 815 行 `clearedSubstantialInput && !wasRapidClear` 就是完整条件。
//
//  这是个很典型的「从状态轨迹推断意图」的设计 —— 没有哪个单一状态能区分
//  这两种情况，只有变化模式能。'''),

    (854, 'before', '''// 【onChange：输入恰好是 ? 时，不插入而是打开帮助】
//
//      if (value === '?') { setHelpOpen(v => !v); return }
//
//  注意判据是「新值整体等于 ?」，不是「刚敲的是 ?」。所以：
//    · 空输入里敲 ? → 新值就是 "?" → 打开帮助，字符不入库
//    · 已有内容时敲 ? → 新值是 "abc?" → 正常插入
//
//  也就是说 **? 只有在句首才是快捷键**。这是个很聪明的设计：
//  句首的 ? 大概率是「我想知道有什么功能」，句中/句尾的 ? 是正常标点。
//
//  代价：用户没法以问号开头的句子（比如「? 这个怎么用」）。
//  这类「有损的快捷键」在终端应用里很常见（vim 的 : 也一样），
//  判断标准是「以该字符开头的正常输入有多常见」。
//
//  后面几行（第 862-867 行）做了四件事：收起帮助、收起草稿提示、
//  取消待定的 prompt 建议、取消推测执行。**用户一动手，所有「预判」都要让路**。'''),

    (870, 'before', '''// 【模式字符的处理分两种情况，区别在「插入长度」】
//
//      isSingleCharInsertion = value.length === input.length + 1
//      insertedAtStart       = cursorOffset === 0
//
//  情况 A（单字符插入到开头）：用户敲了 ! → 切到 bash 模式，字符不插入。
//  情况 B（多字符插入到空输入）：用户 Tab 接受了建议「! gcloud auth login」
//      → 切模式 + 插入去掉 ! 之后的剩余部分（还要把 Tab 换成 4 个空格）。
//
//  为什么 B 要单独处理：因为 Tab 补全一次性塞进来一整串，如果按「单字符」
//  那条路走（切模式后 return），那 `! gcloud auth login` 里的命令就丢了。
//
//  注意 B 的条件里还有 `input.length === 0`：只在输入框为空时这么做。
//  如果用户已经写了半句，再接受一个 ! 开头的建议，就不该强行切模式
//  （那会把已有的内容变成 shell 命令）。
//
//  第 888 行的 `replaceAll(Tab, 4 空格)` 是全局行为：不管哪条路径，
//  输入里的 Tab 都变成 4 空格。因为终端渲染里 Tab 的宽度取决于当前列位置，
//  一个 Tab 可能占 1-8 列，光标计算会彻底失准。**用空格换掉所有 Tab，
//  是终端文本输入的必要之恶。**'''),

    (924, 'before', '''// 【↑ 键的三重让路，顺序就是优先级】
//
//      if (suggestions.length > 1) return     ← 补全列表在显示，↑ 归它
//      if (!isCursorOnFirstLine) return       ← 光标不在首行，↑ 是移动光标
//      if (有可编辑的排队命令) { 弹出并 return } ← ↑ 是把排队命令捞回来编辑
//      onHistoryUp()                          ← 以上都不是，才翻历史
//
//  这三条都是「我的默认行为可以被更高优先级的语义打断」。
//
//  第二条尤其重要，注释（第 929-931 行）解释了：多行输入时按 ↑，
//  用户要的是「光标上一行」，不是「翻历史」。只有在首行再按 ↑ 才是翻历史。
//  这是所有多行输入框的标准行为（浏览器 textarea 也一样）。
//
//  第 922-923 行的注释还说明了为什么 footer 导航不在这里：
//  **当药丸被选中时，TextInput 的 focus 是 false**（见第 2199 行），
//  它的 useInput 根本不活跃，所以这里压根收不到 ↑。footer 那边由
//  Footer 键位上下文处理。
//
//  「这个 handler 里为什么没有 X」的答案，常常在「X 发生时这段代码根本不执行」。'''),

    (957, 'before', '''// 【↓ 翻到底之后再按一下，就进入 footer —— 两个动作接在一行里】
//
//      if (onHistoryDown() && footerItems.length > 0) {
//        selectFooterItem(footerItems[0])
//      }
//
//  onHistoryDown() 的返回值含义是「历史到底了」（没东西可翻）。
//  于是这一行表达的是：**翻不动了，就把 ↓ 转交给 footer**。
//
//  这是「链式焦点」的手工实现：输入框 → footer 药丸。
//  用户的体感是按 ↓ 一路往下走，看不见有边界。
//
//  第 960-965 行还顺手记了一个「见过任务提示」的标记：
//  第一次进 footer 时把 hasSeenTasksHint 写成 true，以后就不弹「↓ 可以管理任务」的提示了。
//  写配置时用了 `c.hasSeenTasksHint ? c : {...}` —— 已经为真就返回原对象，
//  避免无意义的写盘（同 PromptInputFooterLeftSide 里那个 saveGlobalConfig 的写法）。'''),

    (984, 'before', '''// 【onSubmit 是整个文件的「总闸」，第一个动作是读最新状态】
//
//      const state = store.getState()
//      if (state.footerSelection && footerItems.includes(state.footerSelection)) return
//
//  为什么不读闭包里的 footerItemSelected？注释（第 987-991 行）给了具体理由：
//  footer:openSelected 的处理是「先 selectFooterItem(null) 再 onSubmit」，
//  两步在**同一个 tick** 里发生，React 还没重渲染，闭包里的值还是旧的。
//
//  所以这里绕过 React 直接读 store。注意还复用了 includes 判断 ——
//  因为 store 里的值也可能是「选中的药丸已经消失了」的脏值，
//  派生的那套逻辑必须再跑一遍。
//
//  这是「命令式读取 + 同一判据」的组合。判据不统一就会出现：
//  UI 显示没有选中，但 submit 认为有选中，回车没反应 —— 用户完全无法理解。
//
//  第 1000 行的第二个守卫更微妙：`viewSelectionMode === 'selecting-agent'`
//  就 return，因为「选择 agent 模式」下回车是确认选择，不是提交。
//  注释说 BaseTextInput 的 useInput 注册得更早（子组件的 effect 先跑），
//  所以它那边的回车会先触发一次提交 —— 不加这个守卫就会「选中的同时把输入发出去了」。'''),

    (1012, 'before', '''// 【空输入按回车 = 接受 prompt 建议（但不是总是）】
//
//      inputMatchesSuggestion = 输入为空 或 输入正好等于建议文本
//      if (inputMatchesSuggestion && 有建议 && !有图片 && !正在看队友)
//
//  三个排除条件都很有道理：
//    · 有图片时不接受建议 —— 用户想「只发这张图」，不是想发建议里那段话
//    · 正在看队友时不接受 —— 建议是 leader 上下文的（生成时按 leader 的对话算的），
//      发给队友会莫名其妙
//
//  第 1015-1031 行是「推测执行」（speculation）路径：如果已经推测过这条建议的
//  回复，就直接把流式消息注入，跳过整轮 API 调用。
//  这里调 logOutcomeAtSubmission 时传了 skipReset: true，注释解释了原因：
//  正常路径会 resetSuggestion，而 reset 会 abort 掉正在进行的推测 ——
//  那就等于把自己要用的东西取消了。
//
//  第 1034 行 `promptSuggestionState.shownAt > 0` 这个条件容易被忽略：
//  建议必须**真的显示过**才允许接受。否则用户看到的是一片空白，
//  按回车却发出去一段他从没见过的文字 —— 那是最糟的体验。'''),

    (1041, 'before', '''// 【@名字开头 = 直接给队友发消息，不走模型】
//
//  parseDirectMemberMessage 判断输入是不是「@某人 内容」的形式。
//  如果是，直接写进那个队友的 mailbox（文件消息队列），然后提示「已发送」。
//
//  这是一个**语法层面的分流**：同一个输入框，`@bob 帮忙看下这个` 是
//  「发给队友」，而 `@bob` 出现在句子中间就是「提及」。
//
//  三种失败处理值得学（第 1057-1062 行）：
//    · no_team_context（没有团队）→ 落到普通提交
//    · 其他错误（找不到这个人）   → 也落到普通提交
//
//  为什么不报错：因为 `@utils explain this code` 是很自然的诉求
//  （提到一个目录），不应该被「utils 不是队友」挡住。
//  所以策略是**只在确实能发的时候走捷径，其余全部退化成普通 prompt**。
//
//  这类「尽量别挡住用户」的降级设计，在输入处理里应该默认采用。'''),

    (1067, 'before', '''// 【空输入不放行，除非有图片】
//
//  一行守卫，但它体现了「有附件就算有内容」这个规则：
//  用户粘一张图、什么都不写就回车 —— 这是合法的请求。
//
//  配合第 1005 行的 hasImages（只看 type === 'image'，不看文本粘贴）：
//  纯文本粘贴不算附件，因为文本粘贴的内容已经在输入框里了（占了位）。
//
//  注意这个判断在**建议接受之后**：所以「空输入 + 有建议 + 有图片」的情况，
//  会先跳过建议接受（前面的 !hasImages），然后在这里放行 —— 发图。
//  **守卫的顺序决定了优先级**，这段代码里每一条 return 都在排除一种组合。'''),

    (1073, 'before', '''// 【补全列表显示时不提交 —— 但目录补全例外】
//
//      if (suggestions.length > 0 && !isSubmittingSlashCommand && !hasDirectorySuggestions)
//        return
//
//  规则：补全列表开着时，回车是「选中这一项」，不是「提交」。
//  所以这里必须拦住，否则用户想选一个文件，结果把半截路径发出去了。
//
//  两个例外：
//    · isSubmittingSlashCommand —— 用户在命令面板里主动提交（比如按了 ctrl+enter）
//    · 全是目录建议 —— 目录补全之后用户还要继续打文件名，此时回车应该是
//      「进入/确认这个目录」而不是提交，所以放行让 TextInput 处理
//
//  第三个条件 `every(s => s.description === 'directory')` 用的是描述文字
//  当类型判据 —— 和 PromptInputFooter 里拿 status.label 当状态判据是同一个问题：
//  改文案就失效。更稳的做法是给 SuggestionItem 加个 kind 字段。
//
//  第 1075 行的 logForDebugging 也值得一提：这种「本该提交却没提交」的
//  路径最难排查，加一行日志比加十个断言有用。'''),

    (1088, 'before', '''// 【输入要发给谁：leader 还是当前正在看的 agent】
//
//      const activeAgent = getActiveAgentForInput(store.getState())
//      if (activeAgent.type !== 'leader' && onAgentSubmit) { … onAgentSubmit(…) ; return }
//
//  这是一个「路由」而不是「分支」：同样的文本、同样的回车，
//  根据「你在看谁的会话」决定送去哪个模型。
//
//  注意两个细节：
//    · 用 store.getState() 而不是闭包里的 viewingAgentTaskId —— 同 onSubmit
//      开头的理由（同一 tick 内的选中变更还没反映到渲染）
//    · onAgentSubmit 是可选的，所以条件是「不是 leader **且** 有这个回调」；
//      没有回调就退化成普通提交（而不是丢掉输入）
//
//  helpers 里传的 setCursorOffset / clearBuffer / resetHistory 是**清场三件套**：
//  提交后必须清空输入、清空撤销缓冲、重置历史游标。任何一处漏掉都会让
//  下一次 ↑ 键翻到错的记录。'''),

    (1130, 'before', '''// 【showPromptSuggestion 算在渲染期，markShown 也在渲染期调】
//
//  `if (showPromptSuggestion) markShown()` —— 这一句在渲染期间执行副作用。
//
//  为什么能这么写：markShown 大概率只是写一个「已展示」的时间戳，
//  幂等、不触发重渲染（或者触发但很快稳定）。如果它会 setState，
//  在渲染期调用会造成「渲染 → setState → 再渲染」的循环。
//
//  这是个需要谨慎对待的写法 —— 它依赖被调用函数的实现细节。
//  更安全的做法是放进 useEffect，代价是多一帧延迟（第一帧 UI 上建议已显示，
//  但统计上还没记）。
//
//  条件本身值得看：mode === 'prompt' 且 没有补全列表 且 有建议 且 不在看队友。
//  四个都要满足 —— **建议是「最弱的信息」，任何其他 UI 都能压过它**。'''),

    (1138, 'before', '''// 【「生成了但显示不出来」要记一笔，然后清掉】
//
//  条件：状态里有建议文本，但 promptSuggestion 为空，且 shownAt 还是 0。
//  意思是：建议对象生成了，但从没被 markShown 过 —— 说明它一直没能显示。
//
//  这是「埋点用于诊断」的典型：一行 logSuggestionSuppressed('timing', …)
//  能告诉你「建议功能是不是真的在起作用」。没有这个埋点，
//  产品侧只能看到「建议接受率低」，却不知道原因是「压根没显示」。
//
//  然后第 1140-1149 行把状态清空。注意它 setAppState 时没做「是否已经为空」的
//  判断（其它地方都会写 `prev.x === y ? prev : {...}`）—— 所以这段代码
//  只要条件成立，每次渲染都会 setAppState 一次。因为清空后 shownAt 变 0、
//  text 变 null，下次渲染条件就不成立了，所以实际上只会跑一次。
//  但这种「靠状态变化自然收敛」的写法，比显式判等脆一些。'''),

    (1151, 'before', '''// 【图片粘贴：同步缓存路径、异步落盘】
//
//      cacheImagePath(newContent)   ← 同步，立即生效
//      void storeImage(newContent)  ← 异步，不等待
//
//  为什么要分两步：cacheImagePath 建立「id → 本地路径」的映射，
//  让下一帧渲染时就能显示图片链接（终端里显示成路径或链接）。
//  而真正把 base64 写到磁盘是慢操作，不需要阻塞渲染。
//
//  `void` 前缀是显式声明「我知道这个 Promise 没人等」——
//  比裸调用更能表达意图（并让 lint 闭嘴）。代价是**失败被静默吞掉**：
//  如果磁盘写失败，界面上有链接但文件不存在。这类「乐观更新」必须
//  有兜底（比如提交时检查文件存在），否则用户会看到一个点不开的链接。
//
//  第 1180-1182 行的 lazy space 逻辑针对多图粘贴：连续粘两张图时，
//  第一张的「待补空格」要在第二张之前兑现，否则空格会丢。
//  所以 prefix 取自上一次的标记，处理完再重新置 true。'''),

    (1189, 'before', '''// 【孤儿图片清理：文字里没有引用了，附件就该删】
//
//  用户可能用三种方式删掉 `[Image #1]`：
//    · 退格（删整个 chip，光标在 start 时）
//    · ctrl+u（清空整行）
//    · 逐字符删除（如果能删到的话）
//
//  这三种都会让 pastedContents 里留下一条没人引用的图片 —— 它占内存、
//  而且提交时会跟着发出去（因为提交逻辑是遍历 pastedContents）。
//  所以要有一个 effect 定期对账：**文本里引用了哪些 id，就保留哪些**。
//
//  第 1193 行 `if (orphaned.length === 0) return prev` 是关键：
//  没有孤儿就返回同一个对象，避免每敲一个字都触发一次状态更新。
//  这个 early return 让这个 effect 在 99% 的渲染里是零成本的。
//
//  注释（第 1186-1188 行）还解释了为什么这个 effect 不会误删：
//  onImagePaste 里 setPastedContents 和 insertTextAtCursor 是同一个事件里的
//  两次状态写入，React 批处理之后一起提交，所以这个 effect 看到的时候
//  占位符已经在文本里了。
//
//  **依赖顺序敏感的 effect，必须证明「两个状态总是同时到位」。**'''),

    (1201, 'before', '''// 【粘贴文本的三道清洗，每一道都对应一种现实问题】
//
//      stripAnsi(rawText)              去 ANSI 转义序列
//        .replace(CR, LF)              回车换行 → 单个换行
//        .replaceAll(Tab, 4 空格)      Tab → 4 空格
//
//  第一道：从浏览器/终端复制带颜色的输出时，会夹带 ESC[...m 这类序列。
//  不清掉的话，输入框里会显示一堆乱码，而且光标宽度全错。
//
//  第二道：Windows 换行是 CR+LF，Mac 老式是 CR。统一成 LF，
//  否则 getPastedTextRefNumLines 数出来的行数会翻倍。
//
//  第三道：同上面的 onChange，Tab 宽度不可预测。
//
//  第 1207-1213 行还有一段「粘贴 ! 开头的内容自动进 bash 模式」：
//  只在整个输入为空时生效。这和手打 ! 的行为保持一致 —— **粘贴和手打
//  应该走同一套规则**，否则用户会觉得「粘贴的东西不受控制」。
//
//  这类「统一入口」的设计很重要：如果只处理按键、不处理粘贴，
//  会出现一堆「只有粘贴才复现」的 bug。'''),

    (1220, 'before', '''// 【`maxLines = Math.min(rows - 10, 2)` —— 上限永远是 2 行】
//
//  这行值得停一下：Math.min(rows - 10, 2) 在 rows > 12 时恒等于 2。
//  也就是说**粘贴的文本最多在输入框里展开 2 行**，超过就折叠成占位符。
//
//  注释（第 1216-1219 行）给了理由，而且是终端特有的：
//  「如果整体布局太高，Ink 会重绘整个终端」。终端没有局部更新，
//  一次全屏重绘在慢速连接（SSH、tmux）上就是肉眼可见的闪烁。
//
//  所以这里宁可激进地折叠，也不让输入框长高。Math.min(rows-10, 2) 里
//  那个 rows-10 只在**极小窗口**（rows < 12）时才生效 —— 那时连 2 行都放不下。
//
//  对比 onImagePaste 的插入逻辑：图片只插一个短占位符，从不展开。
//  两条路径的策略一致：**长内容一律折叠，绝不撑高输入框。**'''),

    (1241, 'before', '''// 【inputFilter：TextInput 提供的「输入前置管道」】
//
//  签名是 (input, key) => string —— 拿到这次要插入的文本，返回处理后的文本。
//  用它实现 lazy space，比在 onChange 里判断更好，因为：
//
//    · onChange 只能看到「变化后的整体文本」，无法区分「是打字还是方向键」
//    · inputFilter 能看到原始按键（key 对象），所以能判断「这是可打印字符吗」
//
//  实现只有四行：没武装就原样返回；武装了就解除，然后看是不是可打印字符，
//  是就补一个空格。
//
//  注意**解除武装发生在判断之前**：所以任何一次按键都会消耗掉这个标记，
//  不管它是不是可打印的。这保证了「最多补一个空格」。
//
//  第 1244 行调用 isNonSpacePrintable（同目录 utils.ts），
//  那个函数有 16 个修饰键的排除清单 —— 整条 lazy space 逻辑的正确性
//  最后落在那张清单上。'''),

    (1254, 'before', '''// 【useDoublePress：第一次按什么也不做，第二次才执行】
//
//      useDoublePress(() => {}, () => onShowMessageSelector())
//
//  第一个参数是「第一次按」（空操作），第二个是「第二次按」。
//  这么设计是因为第一次按必须**吞掉**这个键 —— 如果不吞，
//  它就会落到别的处理器上（比如清空输入）。
//
//  「双击才生效」的键在终端里很常见（esc esc 清空输入、esc esc 打开历史），
//  因为 esc 单按有太多含义。代价是单按 esc 会有一小段「等待第二次」的延迟感，
//  所以 useDoublePress 内部一定有个超时窗口（通常在 500ms 左右）。
//
//  第 1954 行的调用条件也值得看：
//
//      if (messages.length > 0 && !input && !isLoading) doublePressEscFromEmpty()
//
//  三个条件：有消息（没消息时没什么可选的）、输入为空（有内容时 esc 是清空）、
//  没在加载（加载时 esc 是取消请求）。**同一个键在不同上下文里有五种含义**，
//  这里是第五种。'''),

    (1257, 'before', '''// 【从队列里捞回命令：文本 + 模式 + 光标 + 图片，一样都不能少】
//
//  popAllEditable(input, cursorOffset) 返回的是 result.text / result.cursorOffset /
//  result.images —— 注意它连**图片**都存了。
//
//  为什么：排队时用户可能排了「一张图 + 一段话」。捞回来的时候，
//  文本重新放进输入框、图片要重新登记进 pastedContents
//  （第 1267-1277 行）。漏掉图片恢复，用户会看到 `[Image #2]` 这个占位符，
//  但那张图已经不在附件表里了 —— 提交时占位符解析不出内容。
//
//  第 1263 行 `onModeChange('prompt')` 是硬编码的：捞回来的命令一律进 prompt 模式，
//  哪怕它原本是 bash 命令。因为此刻用户是在**编辑**这条待发消息，
//  编辑完再按回车，走的是普通提交路径。
//
//  这个函数被两处调用：↑ 键（第 939 行）和 esc 键（第 1951 行）。
//  两处的语义略有不同（↑ 是「往上翻到待发消息」，esc 是「取消排队并编辑」），
//  但实现完全一样 —— 因为在用户看来这两件事都是「把它拿回来」。'''),

    (1283, 'before', '''// 【IDE 里点「@ 这个文件」，文本会带一段行号范围】
//
//      @path/to/file.ts#L10-20      ← 行范围
//      @path/to/file.ts#L10          ← 单行
//      @path/to/file.ts              ← 整个文件
//
//  三个分支对应三种粒度。注意 path.relative(getCwd(), filePath) 用的是
//  **相对路径**：绝对路径在 prompt 里既长又泄露本机目录结构。
//
//  第 1292-1295 行有一个很细的处理：看光标前一个字符是不是空白，
//  不是就先补一个空格。因为 IDE 注入时用户的光标可能贴在某个词后面
//  （`看看这个函数|`），不补空格就变成 `看看这个函数@src/a.ts`，
//  粘在一起会解析不出引用。
//
//  同一个「补空格」问题在这个文件里出现了三次：
//    · onImagePaste 的 lazy space（延迟到下一个键）
//    · 这里的即时判断（看光标前一个字符）
//    · QuickOpen 的 insertWithSpacing（第 2134 行）
//  三种实现说明它们出现的时机不同，无法统一 —— 但**规则是同一个：
//  引用类文本前后必须有空白**。'''),

    (1301, 'before', '''// 【撤销：五样东西要一起回滚】
//
//      trackAndSetInput(text) / setCursorOffset / setPastedContents
//
//  只有前两个的话，撤销一张图片会导致文本回来了、附件表没有 ——
//  占位符解析不出来。所以 useInputBuffer 存的是完整的快照
//  （text + cursorOffset + pastedContents），撤销就是整体替换。
//
//  第 1302 行 `if (canUndo)` 是多余的兜底：undo() 内部一定也会判。
//  这类「双保险」在关键路径上可以接受，但它会让「为什么按了没反应」
//  更难排查（因为有两处可能拦住）。
//
//  注意这个 handler 和下面十几个 handler 一样，都用 useCallback 包了，
//  依赖里把用到的每个值都列了出来 —— 因为它们是给键位系统注册的，
//  引用不稳定会导致每帧重新注册。'''),

    (1321, 'before', '''// 【外部编辑器：整个输入框被替换成一行提示】
//
//  流程：setIsExternalEditorActive(true) → 打开 $EDITOR → 等它关闭 →
//  读回内容 → 有变化就替换输入 → setIsExternalEditorActive(false)。
//
//  第 2236 行的 `if (isExternalEditorActive) return <提示行>` 是这个状态的用处：
//  编辑器接管终端的时候，我们的 UI 不能继续画（否则会和 vim 抢屏幕）。
//  所以整个输入框变成一个占位提示「Save and close editor to continue…」。
//
//  三个细节：
//    · 传了 pastedContents，因为编辑器里要**展开**折叠的粘贴内容
//      （用户编辑的是真文本，不是 `[...Pasted text #1 +50 lines]`）
//    · 内容没变就不替换（`result.content !== input`），避免无意义地清掉撤销栈
//    · try/catch/finally：finally 里一定复位状态，否则编辑器崩了之后
//      输入框会永远卡在「提示行」状态，整个应用不能输入 —— 这是最严重的失败模式
//
//  **凡是「切换到外部程序」的操作，必须保证异常路径也能恢复本地状态。**'''),

    (1357, 'before', '''// 【草稿暂存：一个键做两件事，取决于输入是否为空】
//
//    输入为空 + 有草稿  → 取出草稿（pop）
//    输入非空          → 存草稿并清空输入（push）
//    其他              → 什么都不做
//
//  这是个很省按键的设计（一个键切换两个方向），但有个隐含约束：
//  **不能暂存空草稿**。否则用户连按两次 ctrl+s，第一次存、第二次取，
//  看起来像「没反应」。
//
//  第 1358 行 `input.trim() === ''` 用的是 trim：全是空格的输入也算空。
//  这很重要 —— 用户按了一堆空格再按 ctrl+s，期望的是取出草稿，而不是
//  把一堆空格存进去。
//
//  第 1375-1381 行顺手记了 hasUsedStash，用来停止显示「ctrl+s 可以存草稿」的提示。
//  注意它用的是「已经为真就返回原对象」的写法，避免重复写盘。
//
//  存的内容有三样：text / cursorOffset / pastedContents。
//  和撤销快照完全一样 —— 因为它们本质是同一件事：**完整状态快照**。'''),

    (1410, 'before', '''// 【handleCycleMode：全文件最复杂的 handler，因为它要处理「第一次进 auto」】
//
//  正常情况（第 1450 行以后）：算下一个模式 → cyclePermissionMode 应用副作用
//  → setAppState → setToolPermissionContext → 同步给配置文件。
//
//  特殊情况（第 1457-1493 行）：用户第一次进入 auto 模式。这时不能直接应用，
//  因为 auto 模式意味着「模型自己判断权限」，必须先给用户看一段说明并让他同意。
//  所以：
//
//    1. 只改 UI 上的模式标签（让用户看到「auto on」），**不调用任何副作用函数**
//    2. 400ms 后弹出同意对话框
//    3. 用户点同意 → 才调 transitionPermissionMode（真正激活分类器、剥离危险权限）
//    4. 用户点拒绝 → 回滚模式，并把 auto 从模式轮盘里摘掉（本次会话）
//
//  第 1484 行那个 setTimeout 有两个额外参数（setShowAutoModeOptIn 和 ref）：
//  因为回调在 400ms 后执行，那时渲染闭包已经过期，所以把 setter 和 ref
//  **显式传进去**，回调里就能安全地置空 ref。
//
//  为什么要 400ms 延迟：立刻弹窗会让 shift+tab 的连续按（用户可能连按两次
//  跳过 auto）变成「弹窗闪一下就消失」。延迟给了「继续按」一个机会。
//
//  这也解释了第 1495-1513 行那段看起来奇怪的逻辑：如果用户在 400ms 内
//  又按了一次 shift+tab，视为「不想进 auto」，于是取消弹窗、继续轮盘。
//  **连续按键被解释成「跳过」** —— 这是模态切换延迟的常见副产品。'''),

    (1495, 'before', '''// 【「shift+tab 不代表拒绝」—— 这段注释解释了为什么不能回滚】
//
//  注释原文的意思是：用户在 auto 模式（弹窗还没弹或已弹）时又按了 shift+tab，
//  这时**不能**把模式回滚到 previousModeBeforeAuto。
//
//  为什么：因为 shift+tab 的语义是「在轮盘上前进一格」。如果回滚到上一个模式，
//  那么「上一个模式的下一个模式」又是 auto —— 用户会陷入 auto ↔ 上一个模式
//  的来回弹跳，永远出不去。
//
//  这个推理很值得记：**回滚类逻辑必须检查「回滚后的默认下一步会不会回来」**。
//
//  所以这里只是清掉弹窗状态（第 1505-1510 行），让流程继续往下走到
//  cyclePermissionMode —— 那时当前模式已经是 auto，它的下一个是 default，
//  于是用户成功离开 auto。
//
//  真正的回滚只发生在弹窗的「拒绝」按钮里（handleAutoModeOptInDecline）——
//  那是用户明确表达「我不要」，和 shift+tab 的「我要下一个」是两回事。'''),

    (1537, 'before', '''// 【为什么既要 setAppState 又要 setToolPermissionContext】
//
//  注释（第 1533-1536 行）说得很直接：setToolPermissionContext **故意不接收
//  mode**（它内部会保留现有 mode），目的是防止「协调者模式的 mode 被 worker
//  覆盖」这种数据损坏。
//
//  所以想真正改模式，必须绕过它直接写 AppState。但又要调它一次 ——
//  因为它的副作用是「重新检查排队中的权限请求」（那些请求是带着旧模式排的）。
//
//  于是就有了这个看起来重复的双写：
//
//      setAppState(prev => ({...prev, toolPermissionContext: {...preparedContext, mode: nextMode}}))
//      setToolPermissionContext({...preparedContext, mode: nextMode})
//
//  两份状态，同一个值。**这是历史修复留下的结构性重复** ——
//  正确的解法是让 setToolPermissionContext 支持改 mode 并自己防住 worker 覆盖，
//  但那需要改调用方。这类「防御性 API 逼出的双写」在长期项目里很常见。
//
//  第 1550 行的 syncTeammateMode 是第三处写入：teammate 进程要把模式写进
//  共享的 config.json，否则 leader 看不到它切了模式。'''),

    (1644, 'before', '''// 【chat:submit 不走 useKeybindings，而是直接注册 handler】
//
//  注释（第 1637-1642 行）给了完整理由：
//
//  · 用 useKeybindings 会让 Enter 的处理器**抢占**这个键（stopImmediatePropagation），
//    于是补全列表就看不到 Enter 了 —— 用户按回车想选建议，结果直接提交了半截命令。
//  · 直接注册到 handler registry 后，只有 ChordInterceptor（处理组合键的模块）
//    会在「组合键完成」时调用它，比如 ctrl+e s。
//
//  也就是说：**同一个键在两条不同的通道上流动**。
//  普通 Enter 走 TextInput 自己的 onSubmit（第 2174 行），
//  组合键的末尾 Enter 走这里。
//
//  这是键位系统里最容易搞混的地方：同一个物理键，按「是否在组合键序列中」
//  分成两条路径。改任何一条之前，先确认另一条不会受影响。'''),

    (1660, 'before', '''// 【chatHandlers：一张「动作名 → 函数」的表，交给 useKeybindings 注册】
//
//  八个动作：undo / newline / externalEditor / stash / modelPicker /
//  thinkingToggle / cycleMode / imagePaste。
//
//  用表而不是八次 useKeybinding，好处是 useKeybindings 内部可以一次订阅、
//  一次注册，减少键位系统的开销。代价是依赖数组列了八个函数，
//  任何一个不稳定都会导致整批重新注册 —— 所以上面那八个 handler
//  全都用了 useCallback。
//
//  第 1672 行 `isActive: !isModalOverlayActive`：弹窗打开时整批键位失效。
//  这是「总闸」在键位层的体现。注意它拦的是**这一批**，
//  help:dismiss / app:quickOpen 那些是各自单独注册的，各有各的 isActive。
//
//  这种「一组共享 isActive + 个别单独注册」的结构，说明作者是按
//  「这批快捷键属于同一个上下文」来组织的 —— 而不是按功能分类。'''),

    (1691, 'before', '''// 【help:dismiss 用 Help 上下文，是为了抢优先级】
//
//  注释（第 1688-1690 行）：注册在 Help 上下文而不是 Chat，这样它的优先级
//  高于 CancelRequestHandler（那个在 Chat 或 Global 上下文里）。
//
//  场景：帮助菜单打开时按 esc。如果走 Chat 上下文的 esc 处理，
//  会先被「取消请求」抢走 —— 用户按 esc 关了帮助，同时也取消了正在跑的请求。
//
//  所以把一个键的语义按**上下文**分层：Help 上下文只在帮助打开时激活，
//  此时它拥有 esc 的第一解释权。
//
//  这是终端 UI 里实现「焦点」的办法：没有真正的焦点系统，就用
//  「激活的上下文集合 + 优先级」模拟。上下文越具体，优先级越高。
//
//  同一段里还有三个 `feature(...)` 门控的注册（quickOpen / globalSearch /
//  historySearch），它们的写法是「hook 无条件调用，handler 内部判 feature」——
//  注释（第 1698-1700 行）解释了原因：hook 不能写在条件里，
//  而 handler 体内的 feature() 能让相关代码在外部构建里被剔除。'''),

    (1742, 'before', '''// 【footer 的六个键位，每个都有「先处理局部，再交给全局」的顺序】
//
//  footer:up（第 1743 行）：
//      if (任务胶囊选中 && 有任务行 && index > 最小) index-1   ← 先在任务列表里往上
//      else navigateFooter(-1, true)                          ← 否则离开这一层
//
//  footer:down（第 1751 行）：
//      if (任务胶囊选中 && 有任务行) { index+1; return }        ← **永远不离开胶囊**
//      else if (任务胶囊选中 && 非队友模式) { 打开任务对话框 }
//      else navigateFooter(1)
//
//  注意 up 和 down 不对称：down 在任务列表里「到底了也不出去」，
//  而 up 到头会离开。为什么？因为任务是「你按 ↓ 进来的」，
//  进来之后 ↓ 是「浏览列表」，浏览到底不代表要退出。
//  而 ↑ 是「往回退」的语义，退到顶就该回到上一层。
//
//  这种不对称不是疏忽，是**方向本身带语义**：↓ 是深入，↑ 是返回。
//
//  第 1759 行那个分支更特殊：非队友模式下按 ↓，直接打开任务对话框 ——
//  因为此时胶囊代表「有一批后台任务」，按 ↓ 是「我想看详情」。'''),

    (1783, 'before', '''// 【footer:openSelected：一个 switch 分发六种「打开」】
//
//    companion → 发 /buddy 命令
//    tasks     → 队友模式：切到选中队友的视图；非队友：进任务对话框
//    tmux      → 切换 tmux 面板可见性（对外构建里是死分支）
//    bagel     → 什么都不做（浏览器面板还没接上）
//    teams     → 打开团队对话框
//    bridge    → 打开 Bridge 对话框
//
//  注意每个 dialog 分支都是「先 selectFooterItem(null) 再打开」：
//  因为对话框是模态的，选中状态留着会让用户按 esc 关闭对话框后
//  发现自己还停在 footer 上，程序继续吃掉方向键。
//
//  第 1784-1786 行的守卫 `if (viewSelectionMode === 'selecting-agent') return`
//  是必须的：那个模式下回车已经用来「确认选择 agent」，
//  如果再走这里，会同时触发两件事。
//
//  第 1803 行 `coordinatorTaskIndex === 0 && coordinatorTaskCount > 0` 时
//  执行 exitTeammateView —— 也就是「选中第 0 行 = 退出队友视图，回到队长」。
//  第 0 行在 UI 上是队长自己，语义对齐得很自然。'''),

    (1841, 'before', '''// 【footer:close：返回 false 表示「我不处理这个键」】
//
//  这个键绑的是 'x'（用来终止或移除一个 agent）。逻辑分三支：
//
//    1. 选中的行就是当前正在看的 agent → **把 x 打进输入框**
//       （因为此时 x 应该是「给这个 agent 发消息」的第一个字母）
//    2. 其他行 → stopOrDismissAgent
//    3. 没选中任务行 → return false，让 'x' 落到输入框里正常打字
//
//  第 1845-1848 行的注释解释了分支 1：当你在看某个 agent 的会话时，
//  输入框是给它的（steering input），所以 x 必须变成文本。
//  这一条的判据是 `viewSelectionMode === 'viewing-agent' && task.id === viewingAgentTaskId`——
//  两个条件都要，因为「看着 A 但选中的是 B」时，x 应该是终止 B。
//
//  返回 false 的语义在键位系统里叫「未消费」。它的价值是：
//  **同一个键在有意义的时候拦截，没意义的时候放行**。
//  如果这里无脑 return true，用户在 footer 选中状态下就永远打不出 x 了。'''),

    (1865, 'before', '''// 【useInput 的兜底处理器：全文件最后一个收到按键的地方】
//
//  它排在所有键位注册之后，所以到这里说明「没有更具体的处理器认领这个键」。
//  内容只有五块，但每一块都在处理「没人要的键」：
//
//    ① 弹窗打开时直接 return（防 esc 泄漏到双击逻辑）
//    ② macOS Option 键被当成特殊字符时，弹提示（但**仍然让字符打进去**）
//    ③ footer 选中时，可打印字符 → 转成输入（type-to-exit）
//    ④ 光标在 0 位置时，退格/esc/delete/ctrl+u → 退出特殊模式
//    ⑤ esc 的五种含义（推测中 / 侧问题 / 帮助 / footer / 排队命令 / 双击）
//
//  第 1874-1888 行那段 macOS 处理很有意思：Option+某键在终端里会变成
//  一个特殊字符（比如 Option+p 是 π），于是「alt+p 切换模型」失效。
//  这里的做法不是吞掉字符，而是**弹一个说明并让字符照常输入** ——
//  因为用户可能真的想打 π。注释最后一句 "Don't return" 就是这个意思。
//
//  这是「诊断性提示」的范式：不改变行为，只解释为什么你的操作没生效。'''),

    (1898, 'before', '''// 【type-to-exit：footer 选中状态下，敲字就回到输入框】
//
//      if (footerItemSelected && char && !ctrl && !meta && !escape && !return) {
//        onChange(input.slice(0, cursorOffset) + char + input.slice(cursorOffset))
//        setCursorOffset(cursorOffset + char.length)
//        return
//      }
//
//  实现方式是**手工插入一个字符**，而不是「把焦点还给输入框然后重放这个键」。
//  为什么：重放键需要模拟一次按键事件，在 Inko 里没有这种能力（输入是从
//  stdin 读的）。所以只能直接改文本。
//
//  这就解释了为什么这里要自己拼字符串：TextInput 此刻 focus=false，
//  它不会处理这个键，只能由这里代劳。
//
//  四个排除条件对应四类「不该当打字处理」的键：控制键、元键、esc、回车。
//  注意**没有排除方向键** —— 因为方向键的 char 是空字符串，
//  第一个条件 `char` 就把它们过滤掉了。用「有没有字符」来区分「是不是可打印」，
//  比逐个列举方向键更稳。
//
//  第 1897 行注释也点明：onChange 会顺手清掉 footerSelection，
//  所以不需要显式取消选中。**隐式副作用代替显式调用**，省了一行，
//  但读代码时要注意 onChange 里确实有这一步（第 896 行）。'''),

    (1915, 'before', '''// 【esc 的五种含义，按优先级排列】
//
//    1. 有推测在执行      → 中止推测
//    2. 侧问题（/btw）在显示 → 收起侧问题
//    3. 帮助菜单开着       → 关帮助
//    4. footer 有选中      → （交给 Footer 上下文的键位处理，这里 return）
//    5. 队列里有可编辑命令  → 捞回来编辑
//    6. 有消息 且 输入为空 且 没在加载 → 双击打开消息选择器
//
//  注释本身（第 1915-1920 行）列了四种，实际代码是六种 —— 因为「取消请求」
//  那一种不在这个文件里（由 CancelRequestHandler 处理，它在别的上下文）。
//
//  这六种之所以能共存，靠的是**条件互斥**：每个条件都对应一个明确的模式。
//  但要注意顺序：如果两个条件同时成立，先命中的赢。比如「帮助开着 + 队列里有命令」，
//  按 esc 会关帮助（第 3 条），不会捞命令。
//
//  第 1944 行 `if (footerItemSelected) return` 是个「故意不作为」：
//  它把 esc 让给 Footer 上下文（那里绑的是 footer:clearSelection）。
//  如果没有这个 return，这里的逻辑会继续往下走到第 5 条，把排队命令捞出来 ——
//  用户想取消选中，结果输入框里多了一堆文字。
//
//  **「让路」也是逻辑的一部分，而且必须写在正确的位置。**'''),

    (1962, 'before', '''// 【横幅与 fast 图标：两处「按身份/状态决定显示什么」】
//
//  useSwarmBanner 返回 {text, bgColor} 或 null（同目录 useSwarmBanner.ts，
//  六档优先级：队友自己 → tmux attach 提示 → 正在看的队友 → 后台 agent →
//  独立 agent → --agent 参数）。
//
//  showFastIcon 是三个条件的与：fast 模式开启、且（可用 或 在冷却中）。
//  注意「冷却中」也算可见 —— 因为冷却中更需要让用户看到图标（否则他会一直
//  按 alt+o 想知道为什么没反应）。
//
//  第 1991 行 `textInputColumns = columns - 3 - companionReservedColumns(...)`：
//  左边 3 列给 ❯ 和空格，右边扣掉「电子宠物」占的位置。
//  也就是说 **输入框的实际宽度取决于有没有养宠物** —— 这种「功能互相挤占空间」
//  在终端 UI 里是常态，因为没有绝对定位可用。'''),

    (1999, 'before', '''// 【点击定位光标：终端也能点，但要自己把坐标换成文本偏移】
//
//  能点的前提是开了鼠标追踪，而注释（第 1993-1994 行）说得很清楚：
//  鼠标追踪**只在 <AlternateScreen> 里开启**，所以普通模式下这段是死代码。
//
//  换算链是三步：
//
//    e.localRow / e.localCol          点击相对于那个 Box 左上角的坐标
//    → + viewportStart                加上视口起点（多行输入滚动过的话）
//    → measuredText.getOffsetFromPosition({line, column})
//                                     再换成字符串下标
//
//  第三步是关键：终端里「列」不等于「字符下标」—— 中日韩字符占两列、
//  emoji 可能占两列、组合字符占 0 列。所以必须用 MeasuredText（它记录
//  每个字符的实际宽度）来换算，不能用简单的算术。
//
//  第 2002-2004 行还有两个守卫：输入为空时不处理（没东西可定位），
//  搜索历史时不处理（此时显示的文本是 historyMatch，不是 input，
//  算出来的偏移会落到错误的字符串上）。
//
//  **一切「坐标 → 文本位置」的换算，都必须经过宽度模型，不能自己数。**'''),

    (2172, 'before', '''// 【baseProps：一次组装 22 个 prop，全部塞给 TextInput】
//
//  这份对象是「输入框的能力清单」，值得逐个看几个特别的：
//
//    value            —— historyMatch 存在时用匹配项（显示账 vs 状态账）
//    onHistoryUp/Down —— 通过 prop 传而不是键位注册（让 TextInput 内部
//                        先尝试移动光标，移不动才翻历史）
//    disableCursorMovementForUpDownKeys —— 补全列表或 footer 选中时，
//                        上下键不被当成光标移动（否则会同时动两处）
//    focus            —— 四个条件的与；footer 选中时输入框真的失焦
//    showCursor       —— 光标停在图片胶囊左边界时不画光标（反色块就是光标）
//    highlights       —— 全部高亮合成一个数组（render-border 那边的格式）
//    inputFilter      —— lazy space 的挂钩点
//    inlineGhostText  —— 补全的行内灰字预览
//
//  第 2193 行那个 `disableCursorMovementForUpDownKeys` 是「按键仲裁」的
//  又一处体现：同一个键在不同模式下归不同的人管。
//
//  第 2212 行 `inputFilter: lazySpaceInputFilter` 是唯一一个「改写输入」的钩子 ——
//  它能在字符进入文本之前动手，这是其他 prop 都做不到的。'''),

    (2214, 'before', '''// 【边框颜色：三级优先，最后一档是「不许上色」】
//
//    1. 按模式取值（只有 bash 有专属色）—— 用一个只有一项的映射表
//    2. 进程内 teammate → 直接返回默认色（**不上队友色**）
//    3. 环境里有队友色 → 用队友色
//    4. 都没有 → 默认 promptBorder
//
//  第 2224-2227 行那句 `if (isInProcessTeammate()) return 'promptBorder'`
//  是把「进程内 teammate 是无头的」这件事落到颜色上：它跑在 leader 的进程里，
//  如果给它上队友色，leader 的输入框会突然变色，看起来像换了身份。
//
//  第 2215 行那个只有一项的 Record 值得看：
//
//      const modeColors: Record<string, keyof Theme> = { bash: 'bashBorder' }
//
//  为什么不写成 `mode === 'bash' ? 'bashBorder' : undefined`：
//  因为这是一张**等着被扩充的表**。将来加 plan 模式、auto 模式的颜色，
//  只需要往表里加一行，判断逻辑不动。
//
//  （对比 PromptInputModeIndicator 里那个 switch，两者解决同一个问题，
//  一个用表一个用分支 —— 说明这两处不是同一个人/同一时期写的。）'''),

    (2236, 'before', '''// 【外部编辑器激活时，整个输入框变成一个只有边框的提示条】
//
//  borderLeft={false} borderRight={false} borderBottom —— 只保留上边框？
//  不对，是**去掉左右和上**：只画下边框。所以视觉上是一条横线加一行灰字。
//
//  为什么这么设计：编辑器（vim/nano）占满屏幕，我们的 UI 只剩终端最后一行
//  可用的空间。一条横线 + 一句「保存并关闭编辑器继续」是最省地方的做法。
//
//  这个早退在 baseProps 之后、textInputElement 之前 —— 顺序很关键：
//  baseProps 已经算完（它含 highlights 等较贵的计算），但因为早退，
//  TextInput 完全不会挂载。**省掉的是子树的挂载，不是计算。**
//
//  如果这段提前到 baseProps 之前，能省掉那些计算；但 baseProps 里没有副作用，
//  放在后面读起来更顺（所有渲染分支集中在一处）。这是可读性换来的微小开销。'''),

    (2244, 'before', '''// 【最终结构：一个纵向 Box，从上到下五层】
//
//    ① PromptInputQueuedCommands   排队中的消息预览（**仅在非全屏**）
//    ② 「Waiting for permission…」  有弹窗被抑制时的说明
//    ③ PromptInputStashNotice       「已暂存」提示
//    ④ 输入行                       swarm 横幅 or 带边框的输入框
//    ⑤ PromptInputFooter            状态行 / 建议列表 / 帮助菜单
//    ⑥ （全屏时）绝对定位的通知层
//
//  第 2245 行 `{!isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}`
//  是个有意思的取舍：全屏模式下不显示排队预览。因为全屏布局里
//  每一行都要从正文区抢，而排队消息是「次要信息」—— 用户可以在
//  footer 的任务胶囊里看到它们。
//
//  marginTop 由 briefOwnsGap 决定：brief 模式下为 0（让 spinner 贴着输入框），
//  否则为 1。注释（第 317-321 行）说过这个 gap 的归属问题 ——
//  两个组件（BriefSpinner 和这里）都在管这个间距，靠一个布尔保证不加倍。'''),

    (2297, 'before', '''// 【回头补一句：上面那个绝对定位的通知层，为什么用 height 0 而不是卸载】
//
//  第 2293 行那个 Box 有 position="absolute"、height={有建议或弹窗时 ? 0 : 1}。
//
//  用 height=0 而不是条件卸载（不渲染），原因是注释（第 2287-2292 行）说的：
//  它渲染在树的后段，会盖在建议列表/弹窗的底部一行上。改成不渲染当然更彻底，
//  但会导致 Notifications **重新挂载** —— 而 AutoUpdater 在挂载时会做一次
//  初始检查（PR#22413 就是这个 bug），于是每次补全列表开合都会重新检查更新。
//
//  所以选择「保持挂载、把高度压成 0」。这是典型的「卸载有副作用，所以选择隐藏」。
//
//  另外三个数值也是精确调过的：
//    marginTop = briefOwnsGap ? -2 : -1   拉进上方那一行间距里
//    justifyContent="flex-end"            多行通知时显示最后一行（最新的）
//    overflow="hidden"                    多余的行裁掉
//
//  第 2276-2295 行整段只在全屏时渲染（非全屏时通知在 footer 里正常显示，
//  不需要叠在输入框上）。'''),

    (2303, 'before', '''// 【getInitialPasteId：扫历史消息，找出用过的最大编号】
//
//  --continue / --resume 恢复会话时，历史消息里可能已经有 `[Image #7]`
//  `[...Pasted text #12]`。如果新粘贴从 #1 开始，就会和旧附件撞号 ——
//  提交时还原出错误的内容。
//
//  所以这里扫两条路径：
//    1. message.imagePasteIds（图片的 id 列表，直接是数字）
//    2. 文本块里的引用（用 parseReferences 正则解析）
//
//  返回 maxId + 1，也就是「下一个可用号」。
//
//  第 2314 行 `Array.isArray(message.message.content)` 是必要的：
//  用户消息的 content 可能是字符串（老格式）也可能是块数组（新格式）。
//  只处理数组分支意味着**老格式里的引用不会被统计** —— 如果历史里有
//  很老的会话，ID 仍可能撞。这是兼容性妥协。
//
//  这个函数只在挂载时跑一次（见第 366 行的哨兵），所以 O(消息数) 的遍历
//  不会造成性能问题。'''),

    (2328, 'before', '''// 【buildBorderText：把 fast 图标画在边框上】
//
//  返回值是 {content, position: 'top', align: 'end', offset: 0} ——
//  也就是「在上边框、靠右、不偏移」。
//
//  这是 Ink 的 borderText 能力：边框本来是一条连续的线，可以在其中
//  「挖一段」放文字。用在这里，/fast 状态的图标就长在边框右上角，
//  不占用任何布局高度。
//
//  三个状态：
//    没开 fast        → undefined（不画）
//    开了，首次提示中  → 图标 + 暗色的 /fast
//    开了，提示已用完  → 只有图标
//
//  `chalk.dim('/fast')` 是这里唯一一处直接用 chalk 的地方（其余都用
//  <Text dimColor>）。因为 content 是**字符串**不是 JSX —— borderText 只接受
//  已经带 ANSI 的字符串，所以必须用 chalk 手工上色。
//
//  也就是说：**渲染层用组件，字符串层用 chalk**，两者不能混。
//  看到文件里只有这一处 import chalk，原因就在这里。'''),
]
