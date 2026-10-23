ANNOTATIONS = [
    (18, 'after', '''// 三个时间常数一次定齐：5s 隐藏延迟、50ms 去抖、5s 兜底轮询
// （fs.watch 在某些平台会丢事件，轮询是安全网）。'''),
    (20, 'after', '''// 为什么是单例 store：REPL、Spinner、PromptInputFooterLeftSide
// 多处消费同一份任务列表。若每个 hook 实例各自 fs.watch 同一目录，
// Spinner 每轮挂载/卸载都会造成 watch/unwatch 抖动。
// store 实现 useSyncExternalStore 契约（subscribe/getSnapshot）。'''),
    (31, 'after', '''// 稳定引用：只有 fetch 到新数组才替换，
// Object.is 比较才能命中缓存。'''),
    (38, 'after', '''// 隐藏标志初值 false 是有意的——首帧也会走「全完成 → 排 5s 隐藏」
// 路径，恢复会话时已完成的任务能短暂显示一下，与原行为一致。'''),
    (47, 'after', '''// #started 防重入：只有第一个订阅者触发启动，
// 最后一个退出才真正停止。'''),
    (55, 'after', '''// hidden 时快照返回 undefined：React 侧拿到 undefined 即
// 「不渲染列表」，比返回空数组少一次 diff。'''),
    (66, 'after', '''// 进程内更新（TaskCreateTool 等写者）不走 fs.watch，
// 直接订阅事件总线。'''),
    (69, 'after', '''// 首拉 fire-and-forget：subscribe 在 commit 后调用，不是渲染期，
// 这里发起 I/O 安全；结果由 store 自己 notify。'''),
    (79, 'after', '''// 退订幂等：重复调用同一个 unsubscribe 只减一次计数；
// 计数归零才 #stop()——REPL 整个会话持有订阅，
// Spinner 的来回挂载不会把计数打到 0。'''),
    (85, 'after', '''// 重盯目录的两个时机：启动时；fetch 发现 taskListId 变了
// （TeamCreateTool 会在会话中途设置 leaderTeamName）。'''),
    (98, 'after', '''// watch 直接绑 #debouncedFetch：文件事件不需要额外加工，
// 去抖逻辑复用在事件回调上。unref() 让 watcher 不拖住事件循环退出。'''),
    (104, 'after', '''// 目录可能还没被写者创建（ensureTasksDir 由写入方负责）——
// watch 抛 ENOENT 时静默：进程内事件 + 轮询双保险已经覆盖。'''),
    (105, 'after', '''// 同一目录不重盯，除非上一次 watch 失败（#watcher 仍是 null）——
// 给「目录晚点出现」留一次重试机会。'''),
    (111, 'after', '''// 50ms 去抖：一次批量写会产生多个 fs 事件，合并成一次 fetch。'''),
    (121, 'after', '''// 过滤 _internal：合成/内部任务不进 UI 列表，
// 与 TaskList 的过滤规则保持一处实现。'''),
    (125, 'after', '''// 有未完成任务（或列表空）→ 重置隐藏态并清掉隐藏定时器；
// 列表为空时直接 hidden = true，省一个定时器。'''),
    (129, 'after', '''// 全部刚变成 completed → 排 5s 隐藏；已排过（或已隐藏）不重排。'''),
    (138, 'after', '''// 每次 fetch 完都 notify：订阅者按快照引用变化
// 自行决定是否重渲染。'''),
    (151, 'after', '''// 轮询只在有未完成任务时才排：全完成/无任务时 fs.watch 加事件总线
// 足够感知新活动，持续空转轮询只会白烧 CPU 和重渲染。'''),
    (159, 'after', '''// 隐藏定时器触发时先核对 taskListId：5 秒窗口内队伍可能已建/已散，
// 不能拿旧的 id 去 reset 错误的列表。'''),
    (161, 'after', '''// 二次确认：定时器到点后重新拉一次列表，确认「仍然全部 completed」
// 且非空，才真正 resetTaskList——防止定时器排下后又来了新任务。'''),
    (172, 'after', '''// reset 成功后本地缓存也清空并置 hidden：
// UI 侧随即收到 undefined 快照。'''),
    (181, 'after', '''// #stop 只停 watcher/定时器/订阅，保留 #tasks/#hidden 缓存：
// 重新订阅时第一帧就能渲染上次已知状态，不闪空。'''),
    (198, 'after', '''// #started 复位让下一次订阅重新走懒启动；缓存不清（见上方注释）。'''),
    (204, 'after', '''// 模块级单例，进程内唯一；不导出 store 本身，只通过 hook 暴露。'''),
    (210, 'after', '''// 禁用路径（TodoV2 关或非 leader）用三个稳定 no-op 占位：
// useSyncExternalStore 的 subscribe/getSnapshot 引用不变，
// 不会每渲染重新订阅。'''),
    (212, 'after', '''// useTasksV2：TodoV2 开启且（无队伍上下文或是 leader）才返回列表，
// 其余返回 undefined。所有实例共享同一个 store 的 fs.watch。'''),
    (221, 'after', '''// 双闸门：功能开关 + 队伍身份。队友（非 leader）不显示任务列表——
// 那是 leader 的 UI。'''),
    (228, 'after', '''// useSyncExternalStore 的两个参数按启用与否整体切换，
// 保证禁用时引用恒定（见 NOOP 三件套）。'''),
    (231, 'after', '''// useTasksV2WithCollapseEffect 只给一个常驻组件（REPL）用：
// 列表隐藏时自动收起展开态，效果只跑一次，
// 不会 N 个消费者各跑一遍。'''),
    (247, 'after', '''// 依赖 [hidden, setAppState]：hidden 由 undefined 与 数组 驱动，
// 只在「有→无」那一刻触发收起。'''),
]
