ANNOTATIONS = [
    (1, 'before', '''【模块总览】`watcher.ts` 是团队记忆同步的**后台守护进程**部分：监听本地团队记忆目录的改动，
在安静 2 秒后触发一次「推」到服务器（防抖），并在启动时先做一次「拉」。
它和 `index.ts` 是配套的两个文件——`index.ts` 是无状态同步纯函数，本文件是**有状态的单例 watcher**。
注意第 10 行 `import { feature } from 'bun:bundle'`：`TEAMMEM` 是构建期开关，关掉时整个同步系统不启用。'''),

    (35, 'after', '''【第 35 行】`DEBOUNCE_MS = 2000`：最后一次改动后等 2 秒再推送。
为什么需要防抖？编辑器/工具连续写文件会瞬间触发一大波事件，每次都立刻推送会打爆服务器；
等 2 秒让写入「落定」后只推一次，既省流量又避免半截内容被同步上去。'''),

    (38, 'before', '''【第 38-51 行】本文件刻意用**模块级可变状态**（`watcher` / `debounceTimer` / `pushInProgress` /
`hasPendingChanges` / `currentPushPromise` / `watcherStarted`）—— 这和 `index.ts`「零模块状态」是
两种不同取舍：`index.ts` 是纯函数库、状态由调用方持有以保证测试隔离；而 watcher 本身就是个全局唯一
的监听器，天然需要这些状态。
最值得讲的是 `pushSuppressedReason`（第 45-51 行）：它是「不可自愈的失败」护栏。BQ 上曾有一个
`no_oauth` 设备 2.5 天吐了 16.7 万次 push 事件、形成无限重试循环——所以一旦遇到永久失败
（无 OAuth / 无 repo / 4xx 非 409/429），就记下原因并**停止自动重试**，直到用户删文件（unlink，
是 too-many-entries 的恢复动作）或进程重启才解除。'''),

    (53, 'after', '''【第 53-73 行】`isPermanentFailure` 判定哪些失败「重试也没用」：
· `no_oauth` / `no_repo`：请求前就能确定的客户端错误，没有状态码；
· `4xx`（除 409/429）：客户端错误（404 找不到 repo、413 太多条目、403 没权限）。
  409 是**瞬时冲突**（服务器状态在我们之下变了，下次 pull 后重推可能成功），429 是**限流**
  （watcher 自己的退避就够）——这两种不算永久失败。'''),

    (78, 'after', '''【第 78-127 行】`executePush` 执行一次推送并管理生命周期。
关键点：推送对磁盘是**只读**的（只有 delta + 探针，没有合并写盘），所以不需要压制事件——
推送途中到达的编辑会进入 `schedulePush()`，在本次推送完成后防抖重新计时。
成功后清 `hasPendingChanges`；失败后若判为永久失败且还没压过，就设置 `pushSuppressedReason`
并上报 `tengu_team_mem_push_suppressed` 遥测（带原因，绝不带密钥值/路径）。'''),

    (129, 'after', '''【第 129-145 行】`schedulePush` 是防抖调度：先标 `hasPendingChanges`，清掉旧定时器、
2 秒后触发 `executePush`。若触发时正好有推送在进行（`pushInProgress`），就**再 schedule 一次自己**
（重新防抖），等当前推送结束后由它的收尾逻辑再排一次——这样就形成「推送期间来的编辑一定会再被排到」的闭环。'''),

    (147, 'after', '''【第 147-229 行】`startFileWatcher` 用 `fs.watch({recursive: true})` 直接监听目录（**不用 chokidar**）。
为什么不用 chokidar？chokidar 4+ 丢弃了 fsevents，而 Bun 的 fallback 用 kqueue 会**每个被监听文件占一个 fd**——
500+ 个团队记忆文件就是 500+ 个常驻 fd（已用 lsof 复现确认）。用 FSEvents 递归监听是 O(1) 个 fd。
另一个坑：`fs.watch` 在目录上**不分 add/change/unlink**，三者都发 `rename` 事件。为了能在
「too-many-entries 恢复路径」（用户删文件）时解除压制，每个事件都 `stat` 一下文件名：
`ENOENT` → 当成 unlink → 清 `pushSuppressedReason`。对于 `no_oauth` 压制这逻辑也正确
（no_oauth 用户不会靠删文件恢复，他们改完权限重启就好）。'''),

    (231, 'after', '''【第 231-305 行】`startTeamMemoryWatcher` 是入口，在创建任何状态**之前**就尽早返回：
`TEAMMEM` 关闭 / 功能禁用 / 没 OAuth / 当前 repo 没有 github.com remote 都直接 return。
那个 github.com 提前检查很关键：否则 watcher 启动后，本地每次编辑都会触发永远失败的
`no_repo` 日志刷屏。团队记忆在服务端就是按 GitHub 隔离的，非 github.com 的 remote 根本同步不了。
接着做**初始拉取**（在 watcher 启动前，所以它的写盘不会触发 schedulePush），然后**无条件**启动 watcher——
即使服务端还没内容（全新仓库），也必须监听，否则 Claude 第一次写团队记忆会卡在「只能靠 PostToolUse
钩子触发」的鸡生蛋死区里（新伙伴可能好几天都进不了引导区）。'''),

    (307, 'after', '''【第 307-319 行】`notifyTeamMemoryWrite` 是钩子显式调用的「兜底排推」：万一 `fs.watch`
漏了某次写（watcher 启动那一 tick 内写的文件可能不触发事件；某些平台会合并连续快速写入），
这里手动排一次。如果 watcher 真的触发了，只不过让防抖定时器重置一下，无害。'''),

    (321, 'after', '''【第 321-352 行】`stopTeamMemoryWatcher` 负责优雅关闭：清定时器、关 watcher、
等在途推送完成、最后**尽力 flush** 还没推的待改内容。注意整个流程在 2 秒关机预算内，
HTTP PUT 不一定来得及完成——赶不上就被 `process.exit()` 杀掉，所以这是 best-effort。'''),

    (354, 'after', '''【第 354-387 行】两个测试专用函数：
`_resetWatcherStateForTesting` 重置模块状态并可选注入 `syncState`——因为 `startTeamMemoryWatcher`
顶部的 `feature('TEAMMEM')` 在 bun test 下永远是 false，测试走不了正常路径，只能靠它直接驱动
`notifyTeamMemoryWrite` / `stopTeamMemoryWatcher`。`_startFileWatcherForTesting` 则真正启动
`fs.watch`，供「fd 数量回归测试」使用（验证不会因递归监听泄漏 fd）。'''),
]
