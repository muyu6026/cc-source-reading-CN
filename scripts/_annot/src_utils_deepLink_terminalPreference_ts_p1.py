ANNOTATIONS = [
    (1, 'after', '''文件级摘要：记住用户当前用的终端，供深链接处理器稍后使用。
单独成文件是为了摇树——`interactiveHelpers.tsx` 只需要这一个写入函数，
不该为此把整个终端启动器模块拖进启动路径。'''),
    (26, 'after', '''`TERM_PROGRAM` 的自报值与 `.app` 包名并不一致，必须显式映射。
例如 iTerm 报 `iTerm.app`、系统终端报 `Apple_Terminal`，而启动器的 switch 认的是 `iTerm` 和 `Terminal`。
键统一小写，查表前对原值做 toLowerCase。'''),
    (38, 'after', '''写入入口。语义是「顺手记一下」，所以是 fire-and-forget，不返回 Promise、不阻塞启动。
调用点在交互式启动流程里，和 updateGithubRepoPathMapping 并列。'''),
    (41, 'after', '只有 macOS 的终端探测会读这个字段，其他平台直接跳过，省一次全局配置写入。'),
    (47, 'after', '查不到映射就放弃——宁可让处理器回退到静态优先级表，也不要存一个猜出来的名字。'),
    (50, 'after', '值没变就不写盘。全局配置文件可能被多个进程同时持有，无谓写入只会制造竞争。'),
    (54, 'after', '落盘用函数式更新，基于最新配置展开，避免覆盖并发写入的其他字段。'),
]
