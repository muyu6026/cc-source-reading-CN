ANNOTATIONS = [
    (14, 'after', '''// 1 秒去抖比 useTasksV2 的 50ms 粗得多：这里等的是「人来建任务」，
// 不是「自己刚写完文件」，没必要那么敏感。'''),
    (25, 'after', '''// onSubmitTask 返回 boolean：提交成功 true、被拒 false——
// watcher 据此决定继续占有还是释放 claim。'''),
    (27, 'after', '''// 「任务模式」的发动机：盯住任务列表目录，自动捡无人认领的
// open 任务，一次一个提交给 Claude 干。taskListId 同时充当 agentId。'''),
    (38, 'after', '''// 两个 ref 是全部状态：当前任务 id、去抖定时器句柄。
// 不放进 state 是因为它们不驱动渲染。'''),
    (42, 'after', '''// 为什么用 ref 中转 props：isLoading 每轮翻转、onSubmitTask 的
// 身份随 onQuery 依赖变。若 effect 直接依赖它们，每轮都会
// close()+watch() 一遍——这正是 Bun PathWatcherManager 死锁的
// 触发条件（oven-sh/bun#27469）。'''),
    (50, 'after', '''// 渲染期直接写 ref（不在 effect 里）：保证 watcher 回调读到的
// 永远是最新值，且不引入新函数身份。'''),
    (53, 'after', '''// 未显式传 taskListId 时用默认 id：单例「tasks mode」会话。'''),
    (59, 'after', '''// checkForTasks 也存 ref：effect 依赖里只有 [enabled, taskListId]，
// 函数身份变化不会重搭 watcher。'''),
    (68, 'after', '''// 正在干活不捡新任务：一次一个是本模式的铁律。'''),
    (83, 'after', '''// 当前任务已被标 completed（或消失）→ 清 ref 准备捡下一个；
// 还在跑就 return，不并发。'''),
    (91, 'after', '''// 没有可捡的任务：安静返回，等下一个文件事件。'''),
    (98, 'after', '''// claimTask 是原子的（文件锁语义）：多个 watcher 可能同时看到
// 同一个开放任务，只有抢到锁的能继续。'''),
    (105, 'after', '''// 抢锁失败（被别人抢先）→ 记日志放弃，等下次事件。'''),
    (107, 'after', '''// 先记 currentTask 再提交：提交是同步 bool，失败时下方负责释放。'''),
    (122, 'after', '''// 提交被拒（REPL 忙/队列满）→ 主动释放 claim（owner 置 undefined），
// 否则这个任务会被永远卡在「有人认领但没人干」的状态。'''),
    (124, 'after', '''// 释放后清 ref：下一次事件到达时可以重新捡起它。'''),
    (130, 'after', '''// 去抖函数同时服务两个触发源：文件事件 + 下方「转空闲」effect。
// setTimeout 第三参直接传 ref，省一层闭包。'''),
    (150, 'after', '''// 把 debouncedCheck 存进 ref：空闲 effect 不需要依赖 watcher effect
// 的内部变量就能排一次检查。'''),
    (161, 'after', '''// ensureTasksDir 应该已建好目录，但 watch 对「刚建好还没落盘」的
// ENOENT 是同步抛的——兜底记日志，不崩溃。'''),
    (164, 'after', '''// 挂载即检查一次：会话恢复时目录里可能已有排队任务。'''),
    (177, 'after', '''// 清理只在 taskListId 变化或卸载时发生——永不逐轮，
// 这是躲开 Bun PathWatcherManager 死锁窗口的关键。'''),
    (188, 'after', '''// 补偿效应：以前 watcher effect 依赖 checkForTasks（传递依赖 isLoading），
// 转空闲会顺带重搭 watcher 并触发一次检查。现在依赖剃掉后，
// 把「转空闲 → 排一次检查」显式写在这里，行为不变。'''),
    (207, 'after', '''// 可捡任务三条件：pending + 无 owner + 所有 blockedBy 都已完成。
// 未完成 id 集合先算好，blockedBy.every 里查表是 O(1)。'''),
    (220, 'after', '''// 提交 prompt 的拼法：固定开场白 + 任务号 + 主题 + 描述。
//「Complete all open tasks. Start with...」是给模型的排序暗示——
// 让它从这一个开始，而不是自己重排。'''),
]
