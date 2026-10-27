ANNOTATIONS = [
    (43, 'after', '''进程内队友的生成与强制终止：与面板式队友不同，进程内队友同 Node 进程、用 AsyncLocalStorage 做上下文隔离。'''),
    (54, 'after', '''SpawnContext：生成所需的最小上下文，仅含 setAppState 与可选 toolUseId。'''),
    (90, 'after', '''InProcessSpawnOutput：生成结果类型，含成功标志、agentId、taskId、AbortController 与队友上下文。'''),
    (216, 'after', '''spawnInProcessTeammate：创建独立 AbortController 与队友身份，注册到 AppState 并返回生成结果；实际执行由 InProcessTeammateTask 驱动。'''),
    (328, 'after', '''killInProcessTeammate：在状态更新内中止控制器、调用清理、移除团队成员并触发 SDK 终止事件，最后回收输出与终端显示。'''),
]
