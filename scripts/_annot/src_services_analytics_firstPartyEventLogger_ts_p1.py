ANNOTATIONS = [
    (1, 'before', '''【第 1-26 行】`firstPartyEventLogger.ts` 是 1P（第一方）遥测后端，基于 **OpenTelemetry logs SDK**。
    和 `datadog.ts`（直接 axios POST 到 Datadog intake）不同，这里走的是 OTel 的
    `LoggerProvider` + `BatchLogRecordProcessor` + 自定义 `Exporter`，最终导出到自家
    `/api/event_logging/batch`。选用 OTel 是为了和「客户自己的 OTLP 遥测」共用一套 SDK 生态，
    但**两套 LoggerProvider 必须隔离**（见第 381 行的注释）。'''),

    (32, 'after', '''【第 32-48 行】`EventSamplingConfig` 的**采样率语义**值得注意：每个事件名映射到 `{ sample_rate: 0~1 }`，
    没在配置里出现的事件按 100% 上报。配置名 `tengu_event_sampling_config` 走 GrowthBook 动态下发，
    所以可以**不发布新版本就实时调采样率**（高流量事件临时降采样）。'''),

    (57, 'before', '''【第 57-85 行】`shouldSampleEvent` 又是一个**三态返回值**，和 `datadog.ts` 里那套「采样率」同源但更彻底：
    - 返回 `null` = 没配置 → 全量上报（不需要往 metadata 里塞采样率）
    - 返回 `sampleRate`（0~1 之间） = 被选中，且把采样率带出去
    - 返回 `0` = 被丢弃
    第 69-81 行对 `sample_rate` 的边界做了严格校验：不在 [0,1] 当成「全量」，
    `>= 1` 全量、`<= 0` 丢弃。把「采样」和「丢弃」都变成**普通返回值**，而不是异常或副作用，
    调用方拿到数字就能决定，不用各自 try/catch。'''),

    (87, 'after', '''【第 87-102 行】`BATCH_CONFIG_NAME`（tengu_1p_event_batch_config）控制批处理参数：
    延迟、批大小、队列上限、是否跳过 auth、重试次数、路径、baseUrl—— 全部可远端调。
    `BatchConfig` 类型里 `skipAuth?` / `path?` / `baseUrl?` 都是可选的，意味着**同一个动态配置
    既能调性能（批大小），也能做紧急止血（skipAuth / 改 endpoint）**。'''),

    (104, 'after', '''【第 104-110 行】模块级状态：`firstPartyEventLogger` / `firstPartyEventLoggerProvider` 是单例，
    `lastBatchConfig` 用来在 GrowthBook 刷新时**判断是否需要重建 provider**（见第 407 行的 reinitialize）。
    这种「缓存上次的配置、和这次比对」的模式，和 `growthbook.ts` 里 `setupPeriodicGrowthBookRefresh` 的
    `isEqual` 判定如出一辙—— 远端开关变化要不要「重建长生命周期对象」，靠的是同一套思路。'''),

    (116, 'before', '''【第 116-128 行】`shutdown1PEventLogging` 在进程退出前**最后一步**调用，确保迟到事件（比如 API 响应里才产生的）
    也被导出。注释点出为什么必须显式调：`forceExit()` 会阻止 `beforeExit` 处理器触发，
    所以 graceful shutdown 路径要主动 flush。这是 Node 进程退出的老坑——「能退」和「退干净」是两件事。'''),

    (141, 'before', '''【第 141-144 行】`is1PEventLoggingEnabled()` 直接 `return !isAnalyticsDisabled()`，
    和 Datadog 共用同一套禁用判定（`config.ts`）。注释特别说明：1P 事件日志**不**查组织级 metrics 的 opt-out
    （和 BigQuery metrics 不同），它遵循和 Statsig 事件日志相同的口径—— 说明「哪些开关对哪些后端生效」
    是逐后端约定的，不是全局统一。'''),

    (156, 'before', '''【第 156-207 行】`logEventTo1PAsync` 在**上报时刻**才用 `getEventMetadata` 补充核心元数据
    （模型、session、环境上下文等），注释说「类似 Statsig 的模式」。
    第 194-197 行把对象**直接**作为 OTel 属性传（OTel 原生支持嵌套 AnyValueMap，不用先 JSON 序列化）。
    错误处理有个**分级**：开发环境直接 throw（让开发者立刻看到），否则 ant 记 error、其他吞掉——
    生产路径上「上报失败」不该影响主流程，这是遥测代码的通则（和 `datadog.ts` 的 catch/logError 一致）。'''),

    (216, 'before', '''【第 216-230 行】`logEventTo1P`（同步入口）自己不 await，而是 `void logEventTo1PAsync(...)` fire-and-forget。
    两层守卫：整体禁用 → 直接 return；logger 还没初始化 或 sink 被 killswitch 杀掉 → 也 return。
    注意这里**同时**查了 `isSinkKilled('firstParty')`，和 `sink.ts` 的 Datadog 守卫对称——
    每个 sink 在自己的入口处各自做 killswitch 检查，而不是只在总路由处查一次。'''),

    (232, 'after', '''【第 242-247 行】`getEnvironmentForGrowthBook()` 永远返回 `'production'`——
    注释解释：api.anthropic.com 只服务 production 环境的 GrowthBook（staging/dev 不导出到生产 API）。
    所以哪怕你在本地 dev 构建里，拿到的也是 production 开关集。这是一个容易踩的坑：
    本地测开关发现不生效，可能就是因为环境被强行归并到了 production。'''),

    (300, 'after', '''【第 300-302 行】三个默认常量：导出间隔 10s、批上限 200、队列上限 8192。
    队列上限 8192 是「内存里最多能攒多少条」的护栏—— 超过就丢（或落盘，见 exporter），
    防止某个 endpoint 长期挂掉时内存被未发送事件撑爆。'''),

    (312, 'before', '''【第 312-389 行】`initialize1PEventLogging` 自建一个**独立的** `LoggerProvider` + `BatchLogRecordProcessor`。
    这段很长，但核心目的只有一个：**把内部事件和客户遥测彻底隔开**。
    第 341-361 行注释明确说「don't register this globally」——
    因为如果混进全局 provider，内部事件可能漏到客户端点、客户事件可能漏到内部端点，两者都不可接受。'''),

    (381, 'after', '''【第 381-388 行】第 382-384 行的注释是理解这套隔离的关键：必须 `loggerProvider.getLogger()` 从**本地**
    provider 拿 logger，**不能**用全局 `logs.getLogger()`（那是给客户 telemetry 用的）。
    `logs.getLogger()` 返回的是全局 provider 的 logger，和内部事件是两套上下文。
    → 这种「同名 API、不同来源、绝不能混用」的陷阱，只能靠注释和代码 review 挡住。'''),

    (391, 'after', '''【第 407-449 行】`reinitialize1PEventLoggingIfConfigChanged` 是「长生命周期对象如何安全重建」的范本，
    注释里的**事件丢失安全三步**写得非常到位：
    1. **先把 logger 置 null**（第 426 行）—— 并发的 `logEventTo1P` 撞上 `!firstPartyEventLogger` 守卫，
       在交换窗口期直接丢弃少量事件，但**不会**发往正在排空的旧 provider
    2. `forceFlush()` 把旧 processor 缓冲区**排空到 exporter**，失败的已经落盘（按 BATCH_UUID+sessionId 隔离），
       新 exporter 的磁盘重试能接管
    3. 再 swap 到新 provider；旧 provider 在后台 shutdown（缓冲已空，只剩清理）
    最精妙的是第 435-446 行的失败恢复：如果重建抛错，**把 oldProvider / oldLogger 还原回去**，
    否则两个变量都 null、顶部的 `!firstPartyEventLoggerProvider` 守卫会让后续永远无法恢复。'''),
]
