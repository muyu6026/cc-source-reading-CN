# -*- coding: utf-8 -*-
"""ink/ink.tsx 批注 p1：构造、帧循环前半（1-600）。"""

ANNOTATIONS = [
(42, 'before', '''// 三个常量对象对应 alt 屏每帧发出的三种「补丁」：
//   ALT_SCREEN_ANCHOR_CURSOR  假装「上一帧光标在 (0,0)」，让 diff 从已知点算起
//   CURSOR_HOME_PATCH         帧首那条 CSI H（把物理光标钉回去）
//   ERASE_THEN_HOME_PATCH     清屏 + 归位，只在 resize 之后的那一帧用
//
// 都是 Object.freeze 的模块级单例 —— 这类「每帧都要塞进 patches 数组」的对象，
// 如果每次新建，就是每帧几次无意义的分配。省下来的量很小，
// 但这段代码整体是 profile 过之后才这么写的，不是先验的正确性。'''),

(76, 'before', '''// ═══════════════════════════════════════════════════════════════
//  Ink 实例 = 一个终端上的一个 React root
// ═══════════════════════════════════════════════════════════════
//
//   它有四个身份，读的时候容易被绕晕，先分开：
//
//   ① **React 容器的持有者**：持 FiberRoot，render() 往里面塞元素
//   ② **帧循环的驱动者**：scheduleRender（节流）→ onRender（画一帧）
//   ③ **终端模式的管理者**：raw mode、alt screen、鼠标、kitty 键盘、
//      光标可见性 —— 所有「进程和终端之间的约定」都在这里
//   ④ **交互状态的宿主**：选区、搜索高亮、hover、光标声明
//
//   为什么后两件事不放在 React 里：它们必须**跨帧保持一致**，
//   而且要在 React 之外被读写（鼠标事件、终端信号、渲染中间层）。
//   放 React state 会引入「下一帧才生效」的延迟，对光标和选区是致命的。
//
// 【一帧的完整路径】（记住这条线，全文件就通了）
//
//   React commit → resetAfterCommit → onComputeLayout（算布局）
//     → useLayoutEffect（可能改光标声明）
//     → scheduleRender（throttle）→ 微任务 → onRender
//       → renderer()      前后帧 + 尺寸 → 新 Frame
//       → overlay         选区/高亮直接改屏幕缓冲
//       → damage          决定 diff 范围
//       → log.render()    算最小写入序列
//       → optimize()      合并写入
//       → 光标定位        主屏相对移动 / alt 屏绝对定位
//       → writeDiffToTerminal  唯一真正写终端的地方
//       → 埋点 onFrame'''),

(180, 'before', '''// 构造函数的顺序不是随意的：
//   patchConsole（先接管 console，避免后面的日志打乱界面）
//   → 读终端尺寸 → 建三个 pool → 建前后帧 → 建 LogUpdate
//   → 建 scheduleRender（throttle）
//   → 注册退出钩子（onExit）与 TTY 钩子（resize / SIGCONT）
//   → 建 rootNode → focusManager → renderer
//   → 建 React container
//
// 注意 rootNode 的三个回调（237-258 行）必须在 createContainer **之前**挂好：
// React 一挂载就会 commit，commit 里就会调 onComputeLayout。
// 顺序反了，第一帧就没有布局。'''),

(203, 'before', '''// 【为什么要推迟到微任务，而且必须是微任务】
//
//   resetAfterCommit 执行时，React **还没跑 layout effect**。
//   而 useDeclaredCursor 正是在 layout effect 里设置「光标该停在哪」。
//   同步渲染会读到上一帧的声明 —— 表现是打字时光标慢一个字符。
//
//   为什么微任务够：同一个事件循环 tick 内，layout effect 已经执行完，
//   而浏览器的宏任务（下一帧）还没开始。既不慢一帧，也不打乱顺序。
//
//   测试环境例外（reconciler.ts 292 行）：走 onImmediateRender 直接同步渲染，
//   因为测试要 after render 立刻读 lastFrame()。'''),

(212, 'before', '''// 【throttle 的 leading + trailing 各有各的用处】
//
//   leading    用户按一个键，立刻出帧 —— 否则会有 FRAME_INTERVAL_MS 的延迟，
//              在「打字感」上是能感觉到的
//   trailing   高频更新（spinner、流式输出）时，保证**最后一帧**一定画出来；
//              只有 leading 的话，一串更新里最后那个状态会被丢掉
//
//   两者同时开，等于「立刻响应 + 一定收敛到最终状态」。
//   代价是短时间内可能画两帧（leading 一帧、trailing 一帧），可以接受。'''),

(222, 'before', '''// 进程退出也要 unmount：否则终端留在 raw mode / alt screen / 鼠标跟踪开启的状态。
// 对一个 CLI 来说这是最严重的 bug —— 用户回到 shell 后看不到自己打的字。
//
// alwaysLast: false 表示这个回调不排在最后执行（还可以被其他 onExit 回调插队）。
// 具体顺序上的坑见 932 行 detachForShutdown 的注释。'''),

(233, 'before', '''// rootNode 上挂三个回调，这就是 dom 层与帧循环之间的**唯一接口**：
//   onRender            → throttled scheduleRender（一帧的请求）
//   onImmediateRender   → onRender（测试用，绕过节流）
//   onComputeLayout     → 同步算 yoga 布局（commit 阶段）
//
// 三个都在 237-258 行赋值。除此之外 dom 层不 import ink.tsx，
// 反向的依赖只有 ink.tsx → dom，没有环。'''),

(239, 'before', '''// 【每次 commit 都全树重算布局】
//
//   看起来浪费，但注意两件事：
//   ① setWidth(terminalColumns) 只在根上设一次宽度，剩下是 yoga 自己传播
//   ② yoga 内部有缓存（getYogaCounters 的 cacheHits 就是统计它的命中率），
//      没变的子树不会重新求解
//
//   所以这里不是「放弃增量」，而是**把增量交给 yoga**。
//   我们只负责在最外层给一个宽度约束。
//
//   为什么要在这里同步算（而不是等 onRender 时再算）：
//   紧接着的 useLayoutEffect 要读布局结果（光标定位、滚动边界）。
//   详见 reconciler.ts 247 行。'''),

(262, 'before', '''// createContainer 的九个参数里，三个 noop 是错误处理器：
// onUncaughtError / onCaughtError / onRecoverableError。
//
// **所有 React 错误都被吞掉**。这是有意的：终端里没有 DOM 可以展示错误边界，
// 抛出去会直接崩掉整个 TUI（用户正在输的内容全丢）。
// 代价是 React 内部错误完全静默 —— 只能靠日志排查。
//
// 如果哪天出现「界面某块不更新但也不报错」，第一个该怀疑的就是这里。'''),

(270, 'before', '''// 【这一行是「编译期常量折叠」的痕迹，不是运行时判断】
//
//   "production" 会被 bundler 替换成当前构建模式的字面量，
//   于是整句变成 `if ("production" === "development")` —— 永远 false，
//   整个 devtools 块在产物里被删掉。
//
//   读的时候要知道：这不是「生产环境跳过」，而是「生产构建里这段代码不存在」。
//   文件里凡是看到 `"production" === 'x'` 这种写法，都是同一个套路。'''),

(280, 'before', '''// SIGCONT（进程被恢复）之后要重置一切：
//   主屏：双帧清空 + log.reset()。因为挂起期间 shell 可能往屏幕上写过东西，
//         diff 的基准（frontFrame）已经和物理屏幕不一致了。
//   alt 屏：直接重新进入（reenterAltScreen），因为可能已经被踢出 1049 模式。
//
// 关键的一行是 300 行 `displayCursor = null`：挂起期间物理光标位置未知，
// 如果还按旧位置算相对移动，第一帧就会把内容写歪。'''),

(303, 'before', '''// 【为什么 resize 不能 debounce —— 这段注释值得逐句读】
//
//   debounce 会制造一个窗口：stdout.columns 已经是新值，而
//   this.terminalColumns / yoga 布局还是旧值。
//   这个窗口里任何一个 scheduleRender（spinner、时钟）都会：
//     log-update 发现「宽度变了」→ 清屏
//   → 然后 debounce 到期 → 又一次 resize 处理 → 再清一次
//   结果是「白 → 画 → 白 → 画」的双闪。
//
//   同步处理则保证：读到新尺寸的那一刻，所有内部尺寸同时更新。
//   **一致性比省几次计算重要** —— 尤其是在「计算本来就不贵」的时候。'''),

(315, 'before', '''// 同尺寸事件直接返回：终端一次拖拽窗口会连发好几个 resize 事件
// （窗口管理器 settle 的过程），每一个都触发全树重渲染显然不必要。'''),

(330, 'before', '''// alt 屏 resize 的三个「不做」，每个都是踩出来的：
//
//   ① 不重发 ENTER_ALT_SCREEN —— iTerm2 把 ?1049h 当「清屏」处理，
//      即使已经在 alt 屏里。发了就是一次白屏闪烁。
//   ② 不同步写 ERASE_SCREEN —— render() 要 80ms，先擦就等于让用户看 80ms 空白。
//      改成置 needsEraseBeforePaint，让它进 BSU/ESU 原子块（644 行）。
//   ③ 不假设退出过 alt 屏 —— 真被踢出去的情况由 SIGCONT 和睡眠唤醒检测兜。
//
//   保留的一个「做」：resetFramesForAltScreen。因为新宽高下旧缓冲完全不可用。'''),

(343, 'before', '''// 【resize 的处理方式是「重新渲染同一棵树」，而不是「通知某个 resize 事件」】
//
//   注意传的是 this.currentNode —— 上一帧那棵 React 元素树，原封不动。
//   真正的变化在 App 的 props 里（terminalColumns / terminalRows）。
//   重渲染让 context value 变，下游组件自然拿到新尺寸。
//
//   注释里那句「不调 scheduleRender」是重点：
//   scheduleRender 会在布局更新**之前**画一帧，viewport 和内容尺寸对不上。
//   走 render() → commit → onComputeLayout → onRender 才是正确顺序。'''),

(357, 'before', '''// 交接给外部 TUI（git commit 编辑器、vim、less）的第一步。
//
// 顺序：pause（把当前内容画稳）→ suspendStdin（放开键盘）→ 写一长串复位序列。
//
// 364 行把「关 kitty 键盘协议」放在最前面，理由在注释里：
// 不认 CSI-u 的编辑器（nano）会把每个 Ctrl+键都显示成 "Unknown sequence"。
// 这类「我们开了某个终端特性，子进程不认识」的坑，是 TUI 嵌 TUI 的常态。'''),

(392, 'before', '''// 【exitAlternateScreen 里的 re-enter 技巧】
//
//   全屏模式下我们本来就在 alt 屏，按理说退出编辑器后什么都不用做。
//   但编辑器退出时会写 rmcup（?1049l），把我们**踢回主屏**。
//   此时如果直接 2J 清屏，清的是用户的主屏 + 滚动历史 —— 灾难。
//
//   所以先重新 ENTER_ALT_SCREEN，再清。
//
//   最后那行 pop-before-push（418 行）是另一半：Kitty 键盘协议是**栈**，
//   编辑器进出会 push/pop 自己的层级。不回 pop 一次，深度会一轮轮累积，
//   最终导致 Ctrl+C 泄漏成转义序列。'''),

(420, 'before', '''// ═══════════════════════════════════════════════════════════════
//  onRender —— 一帧的全部。这是全文件最核心的函数
// ═══════════════════════════════════════════════════════════════
//
//   九个阶段，按顺序：
//     ① 440  renderer()         前帧+后帧+尺寸 → 新 Frame（纯计算）
//     ② 462  滚动跟随           把选区按滚动量平移
//     ③ 536  叠加层             选区反色、搜索高亮（直接改屏幕缓冲）
//     ④ 559  damage             决定 diff 的范围
//     ⑤ 586  log.render()       算最小写入序列（diff）
//     ⑥ 621  optimize()         合并写入、去掉冗余光标移动
//     ⑦ 660  光标定位           IME 需要物理光标停在 caret 上
//     ⑧ 736  writeDiffToTerminal 唯一真正写终端的地方
//     ⑨ 772  onFrame            埋点
//
//   读这个函数最容易迷失的地方：它很长，但**没有分支嵌套**。
//   每一段都是「做完一件事，然后下一件」，可以直接按上面九段切开读。'''),

(424, 'before', '''// 进入渲染先取消 drain 定时器：这一帧会把待消费的滚动量一起处理掉，
// 并在帧末（757 行）按需重新排一个。
//
// 不取消的话会出现「滚轮触发的一帧」和「drain 定时器的一帧」几乎同时执行，
// 两帧之间只差零点几毫秒 —— 用户看到的是抖动。'''),

(432, 'before', '''// 交互时间戳（用于「多久没输入」这类判断）在这里统一 flush 一次：
// 每帧一次 Date.now()，而不是每次按键一次。
//
// 放在渲染**之前**是为了不弄脏状态 —— 如果在渲染中更新它，
// 可能又触发一轮 React 重渲染，一帧变两帧。'''),

(440, 'before', '''// 【renderer 是纯函数式的】
//
//   输入：前帧、后帧、是否 TTY、宽、高、是否 alt 屏、前帧是否被污染
//   输出：一个新 Frame（含 screen 缓冲、viewport、cursor）+ frame.scrollDrainPending
//
//   它不做 IO、不改 this 上的状态。所以「画出来的东西不对」这件事
//   可以只在这一个函数里查 —— 这也是为什么它被单独拆成一个文件（renderer.ts）。'''),

(451, 'before', '''// 【选区锚在「文本」上，不锚在「屏幕坐标」上】
//
//   用户选中了第 10~12 行，然后内容向上滚了一行 —— 选区应该跟着文本走，
//   而不是钉在那三个屏幕行号上。这是原生终端的行为。
//
//   实现方式：每帧把选区按滚动量平移（shift*），同时把「即将滚出屏幕的行」
//   抄进 scrolledOff 缓冲（capture*），这样滚出去的部分还能被复制。
//
//   476-482 行那段注释是本文件最细的一条警告：
//   capture 和 shift 必须**成对**出现在每个分支里。
//   只 capture 不 shift → 同一批行每帧都被重复捕获 → 复制出来的文本无限增长。
//   这类 bug 不会崩，只会让「复制」这个动作越来越离谱。'''),

(489, 'before', '''// 【flag-3 守卫：两端都在视口内才平移】
//
//   上面 470 行只检查了 anchor 在 scrollbox 里。但用户可以从 scrollbox
//   拖进 footer 再松手 —— 此时 focus 在 footer 上。
//   如果照常平移，focus 会被 clamp 到 viewportBottom，
//   高亮就从 footer「瞬移」回 scrollbox 底部。
//
//   所以跨界的选区**两端都不动**：footer 那个端点把选区钉住，
//   文本在下面滚走，getSelectedText 读的是当前屏幕内容 —— 不会累积。
//
//   拖动分支不需要这个判断：shiftAnchor 不看 focus，anchor 该移还是要移
//   （否则 capture 会漏）。'''),

(515, 'before', '''// 【把选区写进屏幕缓冲，而不是加一条渲染路径】
//
//   做法：把选中的格子直接在 Screen 里换成反色/底色（setCellStyleId）。
//   于是「选区」对 diff 引擎来说就是普通的内容变化，LogUpdate 完全不需要
//   知道有选区这回事。
//
//   这是一个很值钱的设计选择：**把 UI 状态编码进数据，而不是增加一条渲染分支**。
//   代价在 519 行：写缓冲不走 damage 统计，所以必须手工把整帧标成全 damage。'''),

(519, 'before', '''
// ── 另一个兜底：全屏 damage ──
//
// 【全屏 damage 是正确性兜底，不是性能退让】
//
//   PR #20120 描述的 bug：flexbox 兄弟在帧间调整大小时
//   （spinner 出现 → 底部变高 → scrollbox 变矮），
//   按节点跟踪的 damage 会在边界漏掉过渡格子，留下残影。
//
//   关键判据是 didLayoutShift()：只有**布局真的动了**才需要全屏重绘。
//   稳态帧（spinner 转动、时钟走、文字流进固定高度的盒子）布局不变，
//   照常走局部 diff。
//
//   所以这里不是「一直全屏」，而是「布局一动就全屏」。
//   代价可接受，因为布局变化本来就是低频事件。'''),

(536, 'before', '''// 选区与搜索高亮只在 alt 屏生效。
// 原因和 dispatchClick 一样（1260 行）：主屏的坐标系含滚动历史，
// 屏幕行号 ≠ 视口行号，点击/选中都无法映射。
//
// 545 行的 searchPositions 是第二层高亮（当前项，黄色），
// 叠在「所有匹配项反色」之上。位置由 1071 行扫描一次得到，
// 之后每帧只按 rowOffset 平移 —— 见 1103 行的说明。'''),

(554, 'before', '''// 这个兜底对两种屏幕都生效（不止 alt 屏）：
// 布局位移导致的残影，在主屏上同样会发生 —— 只是主屏更常用、
// 用户更容易注意到「这行字怎么叠了」。
//
// 四个条件是「或」的关系，任一成立就整帧重绘。'''),

(568, 'before', '''// 【alt 屏每帧先把物理光标锚到 (0,0)】
//
//   log-update 里所有光标移动都是**相对**的：从上一帧的光标位置算增量。
//   这假设物理光标真的还在那里。但 tmux 重画状态栏、Cmd+K 清屏、
//   pane 重排都会**背着我们挪动光标**。
//   一旦物理位置偏了，相对移动就会逐帧累积偏移 —— 内容是「每帧上爬一行」。
//
//   解法：每帧先发 CSI H 把光标钉回 (0,0)，并让 diff 从 (0,0) 开始算。
//   这样任何外部干扰都会被下一帧自动纠正。
//
//   主屏不能这么做：那里的光标 y 可能是滚动历史里的第 3000 行，
//   CSI H 只能到可视区第一行，回不去。'''),

(585, 'before', '''// diff 引擎只做一件事：对比两份屏幕缓冲，算出「用最少的写入让屏幕变成目标状态」。
// 它不知道内容是什么，也不知道为什么变 —— 这正是它快的原因。
//
// 第三个参数 altScreen 决定「能不能用删除行/插入行这类滚动优化」，
// 第四个参数 SYNC_OUTPUT_SUPPORTED 决定要不要包 BSU/ESU 原子块
// （tmux 不支持 DEC 2026，只能靠外层时序）。'''),

(593, 'before', '''// 双缓冲交换。三个 Frame 的关系：
//   frame        这一帧刚算出来的（马上要显示）
//   frontFrame   屏上现在显示的（下一帧的「前帧」）
//   backFrame    上一帧的（渲染时复用作「后帧」，避免每帧分配两个大数组）
//
// 屏幕缓冲是 rows × cols 的格子数组，每帧新建一份在 60 帧下会产生大量垃圾，
// 所以这里做循环复用。'''),

(597, 'before', '''// 字符串池/超链接池是无界去重表（格子只存索引，不存字符串）。
// 长时间运行的会话里，流式输出的每一段文字都会进池 —— 不重置会一直涨。
//
// 5 分钟一次，成本是 O(cells) 的迁移（见 1561 行 resetPools）。
// 频率低到这个程度，迁移开销可以忽略。'''),

(604, 'before', '''// 整屏重绘（clearTerminal）是「症状」，不是「事件」。
// 这里把它变成结构化数据交给 onFrame —— 上层可以据此统计
// 「这个会话闪了多少次、每次是因为什么原因」。
//
// 612 行的 debug 分支才是真正有用的部分：它把触发行的内容
// （prevLine / nextLine）和 owner chain 一起写进日志，
// 于是「谁导致的闪烁」这个问题有了答案。'''),

(620, 'before', '''// 【diff 之后为什么还要 optimize 一趟】
//
//   diff 回答的是「哪些格子变了」，输出是逐格/逐段的写入指令。
//   optimize 回答的是「怎么用最少的字节写出去」：
//     · 相邻同色写入合并
//     · 连续的相对光标移动合并成一条
//     · 能被一次 SGR 覆盖的样式变化不重复发
//
//   两层分开的好处：diff 逻辑可以保持简单直白，字节级优化单独演进，
//   互不影响。终端带宽不是瓶颈，但**写入次数**影响滚动流畅度。'''),
]
