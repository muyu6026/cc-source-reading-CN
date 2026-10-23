ANNOTATIONS = [
    (38, 'after', '''// 预取阈值：scrollTop 距顶 40 行内就触发加载更旧页——
// 等用户真的滚到顶再拉会有可见空窗。'''),
    (42, 'after', '''// 挂载时补满视口的链式上限：防止事件全被过滤成 0 条可见消息时
// 无限自链。'''),
    (47, 'after', '''// 三个哨兵文案共用一个稳定 UUID（见 sentinelUuidRef）——
// 虚拟滚动把同一 UUID 视为同一个 item，文案变化只是原地 mutate，
// 不是 删除+插入，不会丢滚动位置。'''),
    (60, 'after', '''// 转换选项与 viewer 模式保持一致；非 message 型事件直接丢弃。'''),
    (62, 'after', '''// 惰性加载 claude assistant 历史：挂载时拉最新一页
// （anchor_to_latest），上滚近顶时按 before_id 拉更旧一页，
// 前置插入并保持视口不动。
// 仅 viewerOnly 生效；REPL 侧还有 feature('KAIROS') 门控，
// 关闭时整个 hook 被静态消除。'''),
    (77, 'after', '''// 注意 onPrepend 是可选回调：把「新增了几条、增高了多少」透出去，
// 让 useUnseenDivider 能同步平移分割线。'''),
    (82, 'after', '''// 游标三态：undefined = 首页还没拉；null = 没有更旧页了；
// string = 更旧页的 before_id。纯 ref，不触发重渲染。'''),
    (89, 'after', '''// 滚动锚点快照：prepend 前记下高度与条数，
// commit 后按真实高度差补偿。'''),
    (95, 'after', '''// 补满预算只在首次加载时设定一次；用户主动上滚不需要预算限制
// （maybeLoadOlder 会在下次滚轮事件重新触发）。'''),
    (99, 'after', '''// 稳定哨兵 UUID：跨 loading / failed / start 三种文案复用，
// 让虚拟滚动视其为同一行。'''),
    (111, 'after', '''// 哨兵是 system/informational 消息：走消息渲染通道，
// 不需要为它单独造 UI 分支。'''),
    (118, 'after', '''// 游标推进：还有更旧页 → 记 firstId 作下一页 before_id；
// 否则置 null 封底，后续 loadOlder 直接短路。'''),
    (125, 'after', '''// 非首次加载才记锚点：首屏前置发生在挂载时，
// 视口本来就在顶，无需补偿。'''),
    (127, 'after', '''// 没有更旧页时插入「start of session」哨兵——
// 用户滚到顶知道到底了。'''),
    (133, 'after', '''// O(1) 摘除旧哨兵：哨兵恒定在 index 0 且 UUID 已知，
// 不必整表 find。'''),
    (137, 'after', '''// 调试日志带原始事件数与可见消息数：两者差异即被过滤掉的事件量，
// 排查「拉了一页却看不到东西」时看这行。'''),
    (141, 'after', '''// useCallback 依赖只有 setMessages；scrollRef/mkSentinel 都走 ref，
// 身份永远稳定（eslint 特批）。'''),
    (154, 'after', '''// 首屏走 prepend(page, true)：不记锚点，
// 同时把补满预算设为 10 页。'''),
    (161, 'after', '''// 挂载效应只依赖 enabled：config 在 main.tsx 创建后不再重建
// （eslint 特批）；cancelled 标志防卸载后 setState。'''),
    (167, 'after', '''// 三态游标在这里分流：null = 已到底，undefined = 首页未回，
// 两者都直接返回，只有 string 游标才发请求。'''),
    (174, 'after', '''// 拉取期间把哨兵换成 loading 文案：O(1) slice，
// 因为哨兵恒在 index 0。'''),
    (186, 'after', '''// 失败不回打消游标：哨兵换成 failed 文案，下次上滚会重试
// （游标仍指向同一页）。'''),
    (190, 'after', '''// finally 里释放 in-flight 锁：允许下一个滚轮事件再次触发。'''),
    (208, 'after', '''// 布局效应做滚动锚点补偿：用 getFreshScrollHeight 直读 Yoga，
// 拿到的是 commit 后的真实高度；sticky（钉底）态不做补偿——
// 那时前置内容不可见。onPrepend 也在这里调，拿到的是真实高度差
// 而不是预估值。'''),
    (239, 'after', '''// 补满链：Ink 画完（useEffect 而非 layout effect）后量高度，
// 内容不超视口就再拉一页，自链到预算耗尽或出现滚动条为止。
// 用 <= 而非 <：ScrollBox 内容壳 flexGrow:1 flexShrink:0，
// 内容永远不低于视口，只有「还没有可滚余量」时才继续拉。'''),
    (247, 'after', '''// REPL 把 maybeLoadOlder 组合进 onScroll：距顶 40 行内即触发，
// 与挂载时的补满链共用同一个 loadOlder（有 in-flight 锁，不会重入）。'''),
]
