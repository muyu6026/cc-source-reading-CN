ANNOTATIONS = [
    (6, 'after', r'''KAIROS_CRON_REFRESH_MS = 5 分钟：GrowthBook 开关的刷新窗口。拉远程配置不必每次调用都发起，5 分钟是「开关翻转生效速度」与「请求量」的折中。'''),
    (8, 'before', r'''DEFAULT_MAX_AGE_DAYS 从 jitter 配置推导而非硬编码——循环任务的寿命上限与抖动配置同源，改一处即同步。'''),
    (36, 'before', r'''isKairosCronEnabled 是构建期 feature('AGENT_TRIGGERS')（死代码消除）与运行期 tengu_kairos_cron 开关（5 分钟刷新）的合取。注释记录了三个关键决策：① 默认值是 true——/loop 已 GA，Bedrock/Vertex/Foundry 与关遥测用户拿不到 GrowthBook，默认 false 会把他们挡在功能外（GH #31759）；② GB 开关现在只是舰队级急停，翻成 false 会让运行中的调度器在下一个轮询 tick 停机，不只是拦新的；③ CLAUDE_CODE_DISABLE_CRON 本地覆盖优先于 GB。'''),
    (56, 'before', r'''isDurableCronEnabled 是更窄的急停：只关「落盘持久化」，session-only 循环任务不受影响。注释特别点明它不查 CLAUDE_CODE_DISABLE_CRON——那个是连调度器一起关的总闸，这里只管持久化这一层。'''),
    (64, 'before', r'''三个工具名 + 两套 description/prompt 构建函数。文案按 durableEnabled 分档——关掉持久化时连「.claude/scheduled_tasks.json」这个路径都不出现在提示词里，模型无从请求一个不存在的功能。'''),
    (68, 'before', r'''buildCronCreateDescription：开持久化时主动教模型 durable: true 的用法与落盘位置；关闭时只说「本会话内」。description 是模型对工具的第一认知，分档措辞就是能力边界教育。'''),
    (74, 'before', r'''buildCronCreatePrompt 是本目录最有运维意识的文案：① 一次性任务教模型把 minute/hour/dom/month 全钉死（「提醒我」= 精确时刻而非每天重复）；② 明确要求避开 :00 和 :30 整点——全世界说「9 点」的用户都生成 0 9，请求会在同一瞬间砸到 API，错峰几分钟用户无感、舰队受益；③ 抖动说明（循环任务最多晚 10% 周期、上限 15 分钟；落在整点的一次性任务最多早 90 秒）——把调度器的内部行为诚实告知，模型才能给用户合理的预期。'''),
    (123, 'before', r'''CRON_DELETE_DESCRIPTION 与删除提示同样分档：durable 版明说「从 scheduled_tasks.json 或内存存储移除」，session-only 版只说内存——删除操作的作用域必须与创建时的能力描述严格对称。'''),
    (130, 'before', r'''CRON_LIST_DESCRIPTION 分档同上：durable 版列「落盘 + 会话内」两类，session-only 版只列会话内。三件套的文案构成一条一致的能力叙事。'''),
]
