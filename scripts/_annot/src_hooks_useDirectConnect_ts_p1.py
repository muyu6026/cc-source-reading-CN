ANNOTATIONS = [
    (46, 'after', '''// 同样是「有 config 就是远程模式」；与 useSSHSession 的区别只在于
// 传输层（WebSocket 与 SSH 子进程），REPL 侧接口完全一致。'''),
    (52, 'after', '''// tools 进 ref 的动机：onPermissionRequest 闭包不能过期，
// 但 tools 数组每轮身份都变，进依赖会让 manager 反复重建。'''),
    (56, 'after', '''// 只依赖 [tools]：ref 更新和 manager 生命周期解耦。'''),
    (63, 'after', '''// config 变化 = 换服务器：重置 init 去重，重新收首条 init。'''),
    (78, 'after', '''// 服务端每轮都重发 system/init，同样只放行第一条。'''),
    (86, 'after', '''// session end → 灭 loading；其余消息转成 Message 追加进 transcript。'''),
    (99, 'after', '''// 合成 assistant 消息：远端只发权限请求，本地要把 tool_use 包成
// 一条 assistant 消息，权限弹窗才有挂载点。'''),
    (119, 'after', '''// onUserInteraction 空实现加注释 No-op for remote：
// 远程会话没有本地交互中间态。'''),
    (131, 'after', '''// 三种终局都做同一件事：回传 deny/allow 给远端 + 把弹窗从队列摘掉。
// allow 时额外 setIsLoading(true)——远端又要开始跑了。'''),
    (142, 'after', '''// onAllow 多带一个 updatedInput：用户可能在弹窗里改过参数
//（如权限建议里追加的路径），要原样回传。'''),
    (156, 'after', '''// ToolUseConfirm 入队前最后一站：permissionPromptStartTimeMs
// 记的是「弹窗出现时刻」，供慢权限告警用。'''),
    (159, 'after', '''// 入队 + 灭 loading：spinner 让位给权限弹窗。'''),
    (167, 'after', '''// 断开时分岔：从未连上（isConnectedRef=false）多半是认证被拒或
// 地址错；连上又断是服务端退出或网络掉。'''),
    (177, 'after', '''// 两条路都 gracefulShutdown(1)：WebSocket 断了没有本地回退，
// 只能退出让用户重连。'''),
    (183, 'after', '''// managerRef + connect()：与 useSSHSession 相同的收尾模式。'''),
    (193, 'after', '''// 清理只断 manager：config 为 undefined 时 effect 直接 return，
// 本地模式完全不碰这套。'''),
    (207, 'after', '''// manager 不存在时返回 false（已卸载/未连接），不抛异常。'''),
    (211, 'after', '''// cancelRequest 用 interrupt 而非 disconnect：停当前轮、保会话。'''),
    (215, 'after', '''// 与 cancelRequest 共享 setIsLoading(false)：远端已收到中断，
// 本地 spinner 没有理由再转。'''),
    (221, 'after', '''// disconnect 空依赖：只操作 ref 和 manager 方法。'''),
    (224, 'after', '''// useMemo 的理由与 useRemoteSession 相同：返回对象进消费者的
// effect 依赖，身份不稳会反复重建连接。'''),
    (228, 'after', '''// 收尾：四件套交回 REPL，本地/远程两种模式对 REPL 是同一套接口。'''),
]
