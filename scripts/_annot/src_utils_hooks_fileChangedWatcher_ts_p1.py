# 数据文件：src/utils/hooks/fileChangedWatcher.ts

ANNOTATIONS = [
    (1, 'before', '''文件级：用 chokidar 监听 cwd 下由 FileChanged 钩子匹配的文件变化，触发钩子执行并把结果通知给 UI；同时处理切换工作目录（CwdChanged）时的重算。'''),
    (20, 'after', '''模块级状态：watcher 持有 chokidar 实例，currentCwd 记录当前目录，dynamicWatchPaths / dynamicWatchPathsSorted 收集并缓存钩子运行期动态返回的额外监听路径。'''),
    (26, 'after', '''setEnvHookNotifier：注入一个回调，用于把钩子产生的系统消息或错误回显到 UI。'''),
    (46, 'after', '''initializeFileChangedWatcher：仅初始化一次；根据快照判断是否含有 env 钩子，若有则注册清理函数，解析监听路径后启动监听。'''),
    (65, 'after', '''resolveWatchPaths：把 FileChanged 匹配器里的文件名（竖线分隔）与动态路径合并去重，绝对路径原样、相对路径拼到 currentCwd。'''),
    (78, 'after', '''startWatching：用 chokidar 监听，忽略初始事件、写完成后稳定 500ms 再触发，绑定 change / add / unlink 三类事件到统一处理函数。'''),
    (106, 'after', '''handleFileEvent：执行 FileChanged 钩子，根据返回更新监听路径、把系统消息与失败输出通过回调通知 UI，异常也归一到回调。'''),
    (120, 'after', '''updateWatchPaths：若动态路径集合发生变化则更新缓存并重启监听，避免无谓重建。'''),
    (131, 'after', '''restartWatching：关闭旧 watcher 后按最新路径重新监听。'''),
    (175, 'after', '''onCwdChangedForHooks：工作目录切换时重算钩子配置、清理旧 cwd 的环境文件、执行 CwdChanged 钩子，并据返回刷新动态监听路径后重启监听。'''),
    (187, 'after', '''dispose：关闭 watcher、清空所有模块级状态，供清理注册与测试重置复用。'''),
    (191, 'after', '''resetFileChangedWatcherForTesting：测试用入口，直接调用 dispose 复位全部状态。'''),
]
