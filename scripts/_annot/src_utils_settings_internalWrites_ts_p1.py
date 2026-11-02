# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件记录「进程内设置文件写入」的时间戳，供 changeDetector.ts 中的 chokidar 监听器忽略自身写回声。它从 changeDetector 抽离出来，打破 settings→changeDetector→hooks→…→settings 的循环依赖。'''),
    (15, 'before', '''timestamps：路径到写入时间戳的共享 Map，是本模块与 changeDetector 之间唯一的共享状态。'''),
    (17, 'before', '''markInternalWrite：在真正落盘前由 settings.ts 调用，标记某路径即将被写入，记录当前时间。'''),
    (26, 'before', '''consumeInternalWrite：当 chokidar 触发时判断该路径是否在 windowMs 窗口内被标记过。命中则消费掉该标记（避免抑制下一次真实外部改动）并返回 true。'''),
    (35, 'before', '''clearInternalWrites：清空全部时间戳标记，一般用于设置系统复位或测试清理。'''),
]
