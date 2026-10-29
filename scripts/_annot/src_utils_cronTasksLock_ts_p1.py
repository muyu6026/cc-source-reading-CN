# -*- coding: utf-8 -*-
slug = 'src_utils_cronTasksLock_ts'
ANNOTATIONS = [
    (1, 'after_block', '''文件总述：.claude/scheduled_tasks.json 的调度器租约锁。同一项目目录跑多个 Claude 会话时，只有一个会话应驱动 cron 调度器；首个拿到锁的成为调度器，其余被动轮询；拥有者进程死亡（PID 不再运行）时被动会话接管。模式照搬 computerUseLock.ts：O_EXCL 原子创建、PID 存活探测、陈旧锁恢复、退出清理。'''),
    (23, 'after', '''LOCK_FILE_REL：锁文件相对项目根的路径（.claude/scheduled_tasks.lock）。'''),
    (32, 'after', '''schedulerLockSchema 与 SchedulerLock 类型：用 zod 惰性 schema 描述锁内容（sessionId、pid、acquiredAt）。'''),
    (43, 'after', '''SchedulerLockOptions 类型：供没有 bootstrap 状态的调用方（Agent SDK 守护进程）传入目录与稳定锁身份。'''),
    (51, 'after', '''getLockPath：拼锁文件绝对路径，未提供目录时回退 getProjectRoot()。'''),
    (62, 'after', '''readLock：读锁文件并校验 JSON，损坏或缺失返回 undefined。'''),
    (91, 'after', '''tryCreateExclusive：用 O_EXCL（flag wx）原子创建；EEXIST 表示已存在返回 false，ENOENT 时建目录重试一次。'''),
    (98, 'after', '''registerLockCleanup：注册退出时释放锁的清理钩子（先注销旧的再注册新的）。'''),
    (111, 'after', '''tryAcquireSchedulerLock 入口：尝试获取当前会话的调度器锁。'''),
    (173, 'after', '''tryAcquireSchedulerLock 收尾：覆盖三条分支——已是我们自己（幂等重取）、另一存活会话（返回 false）、陈旧锁（删后重试一次，竞争失败者返回 false）。'''),
    (178, 'after', '''releaseSchedulerLock 入口：若当前会话持有锁则释放。'''),
    (195, 'after', '''releaseSchedulerLock 收尾：注销清理钩子并删除锁文件，文件已不存在则忽略。'''),
]
