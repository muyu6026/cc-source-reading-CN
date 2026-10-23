ANNOTATIONS = [
    (1, 'after', '''// REPL 侧 SSH 会话集成钩子。与 useDirectConnect 是姊妹（同样的
// isRemoteMode/sendMessage/cancelRequest/disconnect 形状、同样的 REPL 接线），
// 但驱动的是 SSH 子进程而不是 WebSocket。为什么不合并泛化：
// 生命周期不同——ssh 进程和 auth proxy 在本钩子运行前就已创建
// （启动期 main.tsx）并交进来；useDirectConnect 的 WebSocket
// 是自己在 effect 里建的。'''),
    (38, 'after', '''// 对 REPL 暴露的四件套：isRemoteMode 决定 REPL 走远程分支；
// sendMessage 返回 boolean 让调用方知道有没有真正发出去。'''),
    (46, 'after', '''// props 里 session 为 undefined 即「非远程模式」，整个钩子退化成
// 恒 false 的 isRemoteMode 加三个空操作。'''),
    (55, 'after', '''// 远程模式判定就是「有没有 session」：
// undefined 走本地 REPL 原链路。'''),
    (64, 'after', '''// tools 进 ref：onPermissionRequest 回调闭包不能过期，
// 但 tools 数组身份每轮都可能变，不能进 effect 依赖。'''),
    (70, 'after', '''// 每次 session 变化重置 init 去重标志：
// 新会话要重新收第一条 init。'''),
    (82, 'after', '''// stream-json 模式下服务端每轮都发一条 system/init，只放行第一条——
// 否则 transcript 里会出现一排重复的初始化消息。'''),
    (90, 'after', '''// onMessage 只管转换和入列；session end 消息顺带把 loading 灭掉
// （SSH 侧没有单独的「轮次结束」信号）。'''),
    (98, 'after', '''// 本地没注册这个工具名时造 stub：权限弹窗要渲染工具名和描述，
// 不能因为找不到工具定义就整个丢掉请求。'''),
    (111, 'after', '''// 远程权限请求统一降级成 behavior:'ask'：判定权在远端，
// 本地只负责弹窗和把用户选择回传。'''),
    (119, 'after', '''// 远程会话没有本地 toolUseContext，cast 个空对象占位——
// PermissionRequest 组件只会读它的个别字段。'''),
    (152, 'after', '''// 重检权限在远程模式下是空操作：本地缓存不了远端的判定逻辑，
// 每次都是新请求。'''),
    (155, 'after', '''// 入队即展示：三个交互回调都从这里挂载，
// 用户一动就回传远端。'''),
    (156, 'after', '''// 注意顺序：先入队再灭 loading，避免弹窗出现前 spinner 先闪一下。'''),
    (172, 'after', '''// 断线时插一条 warning 级系统消息：让用户知道发生了什么，
// 下一条 onConnected 会清掉这个状态。'''),
    (181, 'after', '''// 重连中的三个动作：灭 loading、发提示消息、把 isConnectedRef 置 false
// （供 onDisconnected 判断「从未连上」与「连上又断」）。
// 在途请求救不回来：远端 --continue 会重放历史，
// 但没有进行中的轮次要恢复。'''),
    (190, 'after', '''// 断开文案按「是否曾连上」分流：从未连上 = 失败；
// 连上又断 = 正常结束。'''),
    (195, 'after', '''// stderr 只在该看的时候拼：连接前失败必看；连接后仅当退出码非 0
//（否则 --verbose 的常规输出会淹没真正的错误）。'''),
    (198, 'after', '''// 走到这里就是终局：gracefulShutdown(1) 带 finalMessage 退出，
// reason 'other' 表示非用户主动退出。'''),
    (203, 'after', '''// managerRef 存一份供 sendMessage/cancelRequest/disconnect 用；
// connect() 立即发起连接。'''),
    (214, 'after', '''// 清理三件套：断开 manager、停 auth proxy、清 ref。
// proxy 是在 main.tsx 启动期创建的，这里只负责停。'''),
    (224, 'after', '''// manager 不存在（已卸载）时静默返回 false，不抛。'''),
    (229, 'after', '''// cancelRequest 发的是 interrupt 不是 disconnect：
// 远端停当前轮，会话保持。'''),
    (235, 'after', '''// disconnect 是「用户主动断」：停 manager 并清 ref，
// 与 effect 清理的区别是不触发 gracefulShutdown。'''),
    (240, 'after', '''// useMemo 稳住返回对象身份：消费者（REPL）把它放进 effect 依赖，
// 每渲染新对象会导致反复重连。'''),
]
