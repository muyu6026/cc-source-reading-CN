ANNOTATIONS = [
    (1, 'before', '''【第 1-15 行】`sink.ts` 是遥测的**路由中枢**：它决定一个事件最终去哪几个后端。
    注释说「应在 app 启动期初始化」，对应 `main.tsx` 的 `setupBackend()`。
    注意它 import 了 `datadog`、`firstPartyEventLogger`、`growthbook` 三个模块——
    这三个加上本文件，构成一个「分发 → 后端」的小闭环，但从 `index.ts` 看进来只有 `attachAnalyticsSink` 一个入口。'''),

    (20, 'after', '''【第 20-23 行】`DATADOG_GATE_NAME`（tengu_log_datadog_events）和 `sinkKillswitch.ts`
    里的 `tengu_frond_boric` 是两层不同的开关：
    - gate = 「这个用户群体要不要走 Datadog」（按人群灰度）
    - killswitch = 「此刻这个 sink 强制关停」（紧急止血）
    两者都通过 GrowthBook 下发，但语义不同：gate 是预期内的渐进，killswitch 是预期外的熔断。'''),

    (29, 'before', '''【第 29-43 行】`shouldTrackDatadog()` 体现了「三层回退」的兜底逻辑：
    1. 先问 killswitch（紧急熔断优先）
    2. 再问模块级 `isDatadogGateEnabled`（本进程启动期已从服务器取过）
    3. 都没有时，**回退到上一个 session 的磁盘缓存值**，失败时 fail-open（返回 false 不报）
    这第三层是给「进程刚启动、gate 还没取回」的窗口期用的—— 宁可先用旧值，也不让早期事件丢失或误报。'''),

    (45, 'after', '''【第 45-72 行】`logEventImpl` 是真正干活的地方，几个细节：
    - **采样检查在第 50 行**：`sampleResult === 0` 表示「没被选中」，直接 return；
      `!== null` 表示「被选中且带了采样率」，把采样率写进 metadata。
    - **第 64-66 行是 PII 边界的关键一步**：Datadog 是「通用访问」后端，
      所以调 `stripProtoFields()` 把 `_PROTO_*` 前缀的字段摘掉——
      那些字段是只该进 1P 特权列的、未脱敏的 PII 标记值。
    - **第 71 行 1P 收到的是完整 payload**（含 `_PROTO_*`），由 exporter 自己再处理。
      → 一次 strip 守住所有非 1P 后端，不用在每个 sink 各写一遍过滤。'''),

    (74, 'after', '''【第 74-86 行】`logEventAsyncImpl` 现在只是包一下同步实现、返回 resolved Promise。
    注释解释了它为什么还在：Segment 被移除后，剩下的两个 sink 都是 fire-and-forget，
    但仍要保留这个异步签名来「维持 sink 接口契约」。
    → 接口兼容性有时比实现简洁更重要：删掉它要改 `AnalyticsSink` 类型、改所有调用点，
    收益却只是少一个薄包装层，不划算。'''),

    (88, 'after', '''【第 88-114 行】两个初始化函数分工明确：
    - `initializeAnalyticsGates()` 提前把 Datadog gate 取回（避免用缓存值太久）
    - `initializeAnalyticsSink()` 调 `attachAnalyticsSink` 把真正的路由函数挂上
    两者都标注了「幂等」：早期事件在 sink 挂上前会入队，`attachAnalyticsSink` 内部会异步排空。
    这是「先消费、后连接」模式—— 不让启动路径阻塞在遥测初始化上。'''),
]
