ANNOTATIONS = [
    (1, 'after', r'''【文件定位】swarm worker 侧的权限响应轮询器。worker 没有权限对话框可弹——它把权限请求发给 team leader（useCanUseTool.ts 的 worker 侧集成创建待定请求），这个 hook 每 500ms 轮询 leader 的回复文件，收到后调 onAllow/onReject 放行或拒绝。这是 worker 权限链的「接收端」，与 interactiveHandler 的主 agent 五方竞速完全对称。'''),
    (35, 'after', r'''外部来源（mailbox IPC、磁盘轮询）的 permissionUpdates 必须逐条过 zod schema。队友进程可能是旧版本或有 bug 的，畸形条目过滤掉而不是原样传进 callback.onAllow()——权限放行路径上唯一信得过的输入是「schema 认可的输入」。'''),
    (76, 'after', r'''模块级 Map 而非 React state：pendingCallbacks 必须在渲染之间存活（工具调用挂起期间组件树会重渲染），且 processMailboxPermissionResponse 被 inbox poller 直接调用（不走 hook），模块级是唯一两边都够得着的位置。'''),
    (116, 'after', r'''clearAllPendingCallbacks 连沙箱回调一起清。/clear 时清掉陈旧待定状态；测试也用它做隔离。'''),
    (145, 'after', r'''先删注册表再调回调——回调内部可能同步触发新的工具调用（allow 后继续执行），若还挂在表里，响应文件的重复轮询会二次触发。删除先于调用是幂等闸门。'''),
    (173, 'after', r'''沙箱权限是第二套并行注册表：网络/文件访问的 allow 决策走 resolve(allow: boolean)——比 onAllow 简单得多，没有 updatedInput/permissionUpdates。两套表共用 requestId 空间但分开存，clearAllPendingCallbacks 一起清。'''),
    (231, 'after', r'''processResponse 与 processMailboxPermissionResponse 逻辑几乎镜像（都是先删后调），区别在来源：前者走磁盘轮询（pollForResponse），后者走 mailbox 消息推送。两条路径都要防「回调已不在」——重复响应文件或迟到消息。'''),
    (283, 'after', r'''三个提前退出：不是 worker 不轮；上一轮还没跑完不并发轮（isProcessingRef 串行化，磁盘 IO 慢时避免轮询叠加）；没有待定回调不轮（省 IO）。'''),
    (298, 'after', r'''逐个待定请求查响应文件。查到的先 processResponse（成功才 removeWorkerResponse）——处理失败要留下响应文件供下次重试或调试，不能吞。'''),
    (322, 'after', r'''useInterval 的 delay 参数传 null 即停。只有 worker 身份才轮询——leader 和主 agent 的 pendingCallbacks 永远是空的，轮询是纯浪费。'''),
    (329, 'after', r'''挂载时立即轮询一次——不等第一个 500ms 周期，worker 启动时可能已有等着的响应（比如 leader 在 worker 挂载前就批了）。'''),
]
