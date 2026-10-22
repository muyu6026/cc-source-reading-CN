ANNOTATIONS = [
    (17, 'after',
     "整个文件是 **[ANT-ONLY] 的内部埋点**：三个导出的第一行几乎都是 `process.env.USER_TYPE !== 'ant'` 早退，所以开源构建里它等于一段死代码——但它留在 bundle 里，说明这层门是**运行时判断而非编译期删除**。`memoize` 加在这里是因为调用点在初始化路径和 summary 路径各一次，而 namespace 在一个进程生命周期里不会变。"),
    (35, 'after',
     "容器 ID 的取法：读 `/proc/self/mountinfo`——进程自己看到的挂载表里会带容器运行时注入的路径。这是个 Linux 特性，macOS 上文件不存在，所以走 catch 返回 `containerIdNotFound` 字符串。**注意返回的是「描述性字符串」而不是 `null`**（只有非 ant 才是 `null`）：这样埋点里能区分「没权限读」和「读到了但没匹配上」。"),
    (51, 'after',
     "正则同时覆盖两种容器运行时的路径形态：Docker 是 `docker/containers/<64位hex>`，containerd/CRI-O 是 `sandboxes/<64位hex>`。抓的是 64 位小写十六进制——这是容器 ID 的完整长度（短 ID 是截断显示，mountinfo 里是全量）。接下来逐行扫而不是整篇正则，是因为 mountinfo 一行一条挂载，逐行找第一个命中即可，避免跨行匹配出意外结果。"),
    (71, 'before',
     "`logPermissionContextForAnts` 负责把「当时的权限上下文」和「在哪个环境」一起发出去。`moment` 参数区分两个时点：`initialization`（刚启动，配置已加载但还没开始对话）和 `summary`（会话结束时的快照）。两处都发是为了回答同一个问题——**权限配置在这段会话里有没有被改过**。"),
    (79, 'after',
     "`void logEvent(...)` 前面的 `void` 是有意的：这个函数返回 Promise，但调用方不需要等埋点上报完成（也不该等——上报是网络请求）。`as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 这一串强行类型转换是本仓的另一条约定：那个类型名本身就在提醒**传进去的必须是标签类数据、不能是代码或文件路径**，否则会把用户内容带进遥测。"),
]
