# source: src/utils/computerUse/computerUseLock.ts
ANNOTATIONS = [
    (10, 'after', '''锁文件名固定为 computer-use.lock，放在 Claude 配置主目录下。'''),
    (14, 'after', '''持有解锁函数的引用：加锁时登记、释放时清掉，用于关机清理。'''),
    (24, 'after', '''AcquireResult：加锁结果——acquired（分 fresh 与 reentrant 两种）或 blocked（by 谁持有）。'''),
    (34, 'after', '''isComputerUseLock：运行时类型守卫，校验锁文件 JSON 的形态（sessionId 为字符串、pid 为数字）。'''),
    (44, 'after', '''getLockPath：锁文件完整路径 = 配置主目录 + 文件名。'''),
    (48, 'after', '''readLock：读锁文件并 JSON 解析，形态不符或读取失败都视为无锁。'''),
    (65, 'after', '''isProcessRunning：用 signal 0 探测进程是否还活着（存在 PID 复用的极小窗口，实践中极罕见）。'''),
    (79, 'after', '''tryCreateExclusive：用 O_EXCL（wx 标志）原子创建锁文件，已存在则返回 false，其余错误上抛。'''),
    (94, 'after', '''registerLockCleanup：登记关机清理，保证即便没走到回合末清理（如 /exit 中途）也会释放锁。'''),
    (110, 'after', '''checkComputerUseLock：只查不抢（defersLockAcquire 契约）——request_access 等工具用它判断是否阻塞，不触发进入通知。'''),
    (130, 'after', '''isLockHeldLocally：零系统调用判断本进程是否认为自己持有锁，用于门控 cleanup.ts 的每回合释放（非 CU 回合不碰磁盘）。'''),
    (148, 'after', '''tryAcquireComputerUseLock：用 O_EXCL 做原子 test-and-set，至多一个进程创建成功；陈旧锁则 unlink 后重试一次。'''),
    (202, 'after', '''releaseComputerUseLock：仅当本会话拥有锁才 unlink 并返回 true（调用方据此发退出通知）；幂等，重复调用返回 false。'''),
]
