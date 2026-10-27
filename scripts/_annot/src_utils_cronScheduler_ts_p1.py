# -*- coding: utf-8 -*-
# src/utils/cronScheduler.ts  L565
ANNOTATIONS = [

(8, 'after', r'''文件总览：非 React 的定时任务调度内核，管 .claude/scheduled_tasks.json。被 REPL（经 useScheduledTasks）与 SDK/-p 模式（print.ts）共用。生命周期：轮询开关标志直到为真 → 加载任务 + 监听文件 + 起 1 秒检查定时器 → 到点调 onFire(prompt)。核心难点是「多 Claude 共享 cwd 时如何不重复触发」与「进程崩溃后如何接手」。'''),

(60, 'after', r'''isRecurringTaskAged：判断周期性任务是否「过期该删」。maxAgeMs 为 0 表示永不过期；否则超过创建时间阈值且非永久任务即老化。抽出成纯函数是为了可测——check() 埋在 setInterval/chokidar/锁 之下。'''),

(128, 'after', r'''CronSchedulerOptions：调度器的回调与开关集合。onFire 是触发入口；assistantMode 绕过 isLoading 闸门并自动启用；dir 提供时调度器完全不碰 bootstrap 状态（给 SDK daemon 用）；filter 是「任务可见性闸门」，返回 false 的任务对调度器完全隐形。'''),

(140, 'after', r'''CronScheduler：对外契约——start/stop/getNextFireTime。getNextFireTime 返回最近一次触发的 epoch 毫秒，无任务返回 null（daemon 据此决定要不要保活空闲子进程）。'''),

(157, 'after', r'''createCronScheduler 的开头：解构选项、算 lockOpts，并声明一组模块级可变状态——任务列表、每任务下次触发时间、已问过的 missed 集合、在途集合（防重复触发）、三个定时器与文件监听器、以及 isOwner 所有权标记。'''),

(228, 'after', r'''load：读任务文件。只在初次加载时上报 missed 任务（一次性任务需用户决定立即跑还是丢弃）；chokidar 触发的重载把过期任务留给 check() 立即触发。守护进程路径（dir 给定）不读 missed。'''),

(345, 'after', r'''process：check 的共享循环体，isSession 决定一次性任务的清理路径——会话任务同步从内存删，文件任务走异步 removeCronTasks + chokidar 重载。首次见到某任务时从 lastFiredAt（周期性）或 createdAt 锚定下次触发，避免空闲子进程释放后重新锚定导致每轮都触发。'''),

(394, 'after', r'''check：每 1 秒跑一次。先过 isKilled/isLoading 闸门；只对「持有调度锁」的任务做文件触发（多 Claude 同 cwd 防双触发），会话任务不受锁约束；空闲（无活任务）时清空整个 schedule 让 getNextFireTime 返回 null。'''),

(461, 'after', r'''enable：真正启动。动态 import chokidar；抢调度锁——抢到才跑 check，抢不到就每 5 秒探测一次接管（原主崩溃时顶上）。监听文件的增改删，起 1 秒检查定时器，并 unref 以免进程被调度器单独保活。'''),

(531, 'after', r'''createCronScheduler 返回三方法：start 在守护路径直接 enable，否则按开关标志与是否有任务决定是否启用/轮询；stop 拆除全部定时器、监听器并释放锁；getNextFireTime 过滤掉 Infinity（永不触发）后取最小值。'''),

(565, 'after', r'''buildMissedTaskNotification：把「漏跑的一次性任务」拼成通知文本。先说明已删除、需先问用户再执行；每条任务用比提示里任何反引号都长的代码围栏包起来，防止提示内含 ``` 提前闭合围栏造成提示注入。'''),

]
