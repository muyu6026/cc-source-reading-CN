ANNOTATIONS = [
    (1, 'before', '''【第 1-2 行】这里又出现一个 mangled name（`tengu_frond_boric`）。
    和 `sink.ts` 里的 `tengu_log_datadog_events` 一样—— 这些是 GrowthBook 后端的
    动态配置键，名字被压缩成无意义的字符串，目的是**防止被轻易枚举/猜测**，
    也避免名字本身泄露这个开关是干什么的。读代码时要把它和 `sink.ts` 的 gate 名字对照看。'''),

    (8, 'after', '''【第 8-17 行】注释把这套 killswitch 的安全语义写得很清楚：
    - 形状是 `{ datadog?: boolean, firstParty?: boolean }`
    - 某个 sink 对应值为 `true` = 停止向该 sink 派发（不是「停止所有遥测」）
    - **Fail-open**：配置缺失或畸形时，sink 保持开启（宁可多报，不可把遥测静默关掉）
    最危险的是第 14-16 行的 NOTE：**绝不能从 `is1PEventLoggingEnabled()` 内部调用本函数**——
    因为那条函数会调 `isGrowthBookEnabled()`，而 `isGrowthBookEnabled()` 又调回 `is1PEventLoggingEnabled()`，
    直接**递归爆栈**。所以 killswitch 只能在「每次事件分发点」调用，不能放在「判断整体是否启用」的层。'''),

    (18, 'before', '''【第 18-25 行】`isSinkKilled(sink)` 的返回值判定用 `=== true` 而不是 truthy，
    注释解释了原因：`getDynamicConfig_CACHED_MAY_BE_STALE` 对 `!== undefined` 做守卫，
    所以缓存里一个 JSON `null` 会**漏过** `|| {}` 的回退、原样返回 `null`。
    如果这里写成 `return config?.[sink]`，那 `null` 会被当成 falsy 当「没杀」——
    但实际上服务器可能显式下发了 `null`，意图未必如此。显式 `=== true` 把「没下发 / 下发 null / 下发 false」
    统一收敛为「没杀」，和 fail-open 语义一致。'''),
]
