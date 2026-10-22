ANNOTATIONS = [
    (6, 'after',
     "文件级警告：这是 [ANT-ONLY] 模块——整个文件所有公开函数第一句都是 if (process.env.USER_TYPE !== 'ant') return，\n"
     "所以普通用户零开销、零影响。存在的意义是让 Anthropic 内部员工在本地复现各种限流态（429、warning、overage、org 额度……），\n"
     "而不必真的去把配额用光。文件头自己承认：mock 头不保证和真实 API 规范逐字一致，上生产前必须对照真实响应校准。"),

    (41, 'after',
     "MockHeaders 就是「一次 API 响应里所有跟限流有关的头」的形状摹本：\n"
     "- unified-status / unified-reset / representative-claim 是订阅配额三件套（allowed / allowed_warning / rejected）；\n"
     "- overage-* 一族是「超额用量（extra usage）」状态，disabled-reason 解释为什么超额被禁；\n"
     "- fallback / fallback-percentage 表示有备用模型可用；\n"
     "- 5h/7d utilization + reset + surpassed-threshold 是「早期预警」族——还没超限，但用量已越过预警线；\n"
     "- retry-after 是标准 HTTP 头，唯一不带 anthropic-ratelimit-unified- 前缀的。"),

    (58, 'after',
     "MockHeaderKey 是上面那套长头名的「短键」：setMockHeader('status', 'rejected') 比写全称方便得多。\n"
     "映射规则在 setMockHeader 里：retry-after 原样用，其余一律拼上 anthropic-ratelimit-unified- 前缀。"),

    (80, 'after',
     "19 种 mock 场景，按族分：\n"
     "- 普通：normal / clear；\n"
     "- 订阅配额：session-limit-reached（5 小时会话窗）、approaching-weekly-limit、weekly-limit-reached（7 天周窗）；\n"
     "- 超额用量：overage-active / overage-warning / overage-exhausted / out-of-credits（钱包空）；\n"
     "- 组织额度（Team/Enterprise）：org-zero-credit-limit、org-spend-cap-hit、member-zero-credit-limit、seat-tier-zero-credit-limit；\n"
     "- 分模型：opus-limit/warning、sonnet-limit/warning；\n"
     "- fast mode：fast-mode-limit / fast-mode-short-limit；\n"
     "- extra-usage-required：headerless 429（只有 4xx 没有限流头）。"),

    (89, 'after',
     "全部状态都是模块级单例（mockHeaders / mockEnabled / exceededLimits / fastMode 两个时间戳 / mockSubscriptionType）。\n"
     "测试代码不追求纯函数化——一个进程同时只演一种限流态，模块级状态就是最直接的实现。\n"
     "DEFAULT_MOCK_SUBSCRIPTION = 'max'：没显式设订阅类型时，对外一律谎称 max，因为大多数限流 UI 分支要按订阅等级走。"),

    (97, 'after',
     "ExceededLimit 不存「哪个窗口超了」的布尔，而是每条超限自带 resetsAt（Unix 时间戳）。\n"
     "这样同时命中 5h 和周窗时，能用「reset 最远的那条」当 representative claim——见 updateRepresentativeClaim。"),

    (99, 'before',
     "setMockHeader 是新方式：逐个头切换，可组合。旧方式（setMockRateLimitScenario）是整包场景，一次覆盖所有头。\n"
     "两者共享同一份 mockHeaders，所以可以先用场景打底、再单独微调某个头。"),

    (106, 'after',
     "USER_TYPE !== 'ant' 早退是这个文件的统一闸门：非 Anthropic 员工进程里，下面所有 setter 都是 no-op。\n"
     "注意它只挡「写入」；getter 里也各有一次同样的判断（见 getMockHeaders / shouldUseMockSubscription）。"),

    (124, 'after',
     "删除语义：value 传 undefined 或字面量 'clear' 都表示「删掉这个头」，而不是设成空串。\n"
     "顺手维护两条不变量：删 claim 时 exceededLimits 整体清空（没有代表claim了，超限列表也没意义）；\n"
     "删 status / overage-status 后重算 retry-after。"),

    (133, 'after',
     "人性化输入：reset / overage-reset 如果传的是纯数字，按「多少小时后」解释并换算成 Unix 时间戳。\n"
     "传非数字则原样当时间戳用——测试里两种写法都见过。"),

    (166, 'after',
     "claim 分支的处理链：\n"
     "1) validClaims 白名单校验，不认识的值直接落到下面的通用赋值（不会污染超限列表）；\n"
     "2) 按 claim 类型推 reset 时间——five_hour +5 小时，三个 seven_day_* +7 天，兜底 +1 小时；\n"
     "3) 同类型先去重再 push（重复设同一个 claim 是覆盖，不是叠加）；\n"
     "4) 最后重算 representative claim 并 return——claim 分支不走通用头赋值。"),

    (171, 'after',
     "这里必须 widen：MockHeaders 的值是字符串字面量联合（'allowed' | 'rejected' | ...），\n"
     "直接把用户传进来的裸 string 赋进去 TS 不干。转成 Partial<Record<keyof MockHeaders, string>> 绕开——\n"
     "原文注释自己承认这在生产代码里不可接受，但 mock/测试代码可以。"),

    (182, 'after',
     "自动关闸：所有头都被删光时把 mockEnabled 置回 false。\n"
     "否则会留下「开着 mock 但一个头都没有」的中间态，getMockHeaders 的三条件检查虽然也能兜住，\n"
     "但 getMockStatus 会打出 'Active mock headers:' 后面一片空白。"),

    (207, 'after',
     "retry-after 的写入条件是三合一：status 必须是 rejected，且（没配 overage 或 overage 也是 rejected），且有 reset 值。\n"
     "翻译成业务语言：只有「真的被挡住且没有超额额度兜底」时才告诉客户端该等多久。\n"
     "超额可用时删掉 retry-after——客户端应该直接走超额，而不是等待。"),

    (246, 'after',
     "representative claim = 超限列表里 resetsAt 最远的那条（reduce 比较）。\n"
     "同时命中 5h（今晚重置）和周窗（下周重置）时，对外展示周窗——它才是「用户实际被挡到什么时候」的答案。\n"
     "retry-after 同样只在「rejected 且超额不可用」时出现；超额可用就删掉。"),

    (270, 'after',
     "addExceededLimit 是 setMockHeader claim 分支的「自定义 reset 时间」版：小时数任意指定。\n"
     "副作用：只要超限列表非空就把 status 改 rejected——超限和 rejected 在这里是绑定的。"),

    (289, 'after',
     "先清干净所有 early warning 头再设新的，原因是优先级：5h 预警先于 7d 预警判定。\n"
     "如果测 7d 时不显式清 5h，上一轮测试残留的 5h utilization 会抢先触发预警，测出来的就不是你想要的那条路径。"),

    (309, 'after',
     "surpassed-threshold 头也置成 utilization 值——这个头是「预警已越过阈值」的信号位，客户端靠它决定要不要弹提示。\n"
     "最后：如果 status 还没设过就补一个 'allowed'。不补的话预警逻辑没有升级起点（allowed → allowed_warning 的跳变需要基态）。"),

    (352, 'after',
     "overage 三兄弟（active/warning/exhausted）显式保留已有的 exceededLimits，其他场景一律清空。\n"
     "因为超额用量的前提就是「订阅已经超限」——清掉超限列表会让 overage 场景变成无源之水。"),

    (397, 'after',
     "overage-active：订阅 rejected + 超额 allowed，即「可以继续用，走超额计费」。\n"
     "超额的重置周期是月度，所以 reset 取「下个月 1 号 0 点」（setMonth(getMonth()+1, 1) 再清零时分秒）——\n"
     "注意先设日期再 setHours(0,0,0,0) 的顺序，反了会把日期也带回当天。"),

    (448, 'after',
     "out-of-credits：订阅超限 + 超额 rejected，disabled-reason = out_of_credits，语义是「钱包空了，不是政策不让用」。\n"
     "这和下面几个 org/member 级的零额度场景区分开——那些是「配额被设成 0」，UI 文案不同。"),

    (476, 'after',
     "org 级零额度两种（org-zero-credit-limit / org-spend-cap-hit）：管理员把整个组织的支出上限设为 0 或撞到月度 cap。\n"
     "原文注释特意标注：这类场景下非管理员的 Team/Enterprise 用户「不应该」看到 Request extra usage 入口——\n"
     "组织层面被禁，个人申请无意义。mock 它们就是为了验证这条 UI 分支。"),

    (516, 'after',
     "member / seat-tier 级零额度两种：被禁的粒度细到个人或席位档位。\n"
     "原文注释特意标注：这类场景下非管理员「应该」看到 Request extra usage——管理员可以给这个用户/档位加额度，\n"
     "所以入口要保留。和 org 级两种正好相反，是 UI 上最容易搞混的一对。"),

    (544, 'after',
     "opus-limit 故意总是发 rejected 状态，不自己做 fallback 判断。\n"
     "原文注释说得很直白：该显示错误、还是静默返回 NO_RESPONSE_REQUESTED（让上层换模型重试），\n"
     "由错误处理器按 fallback 资格决定——mock 层只负责如实呈现「被限流了」这个事实。"),

    (579, 'after',
     "fast mode 限流的关键是 20 秒阈值：fast-mode-limit 的 duration 是 10 分钟（远超阈值，触发冷却），\n"
     "fast-mode-short-limit 是 10 秒（低于阈值，不触发冷却）。\n"
     "两个场景只差这一个数字，专门用来验证「短时限流不该把 fast mode 打进冷却」这条边界。"),

    (595, 'after',
     "extra-usage-required 是 headerless 429：不设任何限流头，只给一条消息。\n"
     "它对应真实世界里「1M 长上下文需要额外用量额度」这类 entitlement 拒绝——响应是 4xx 但没有任何 ratelimit-* 头，\n"
     "专门用来 exercise errors.ts 里那条不依赖响应头的 entitlement-rejection 路径。"),

    (614, 'after',
     "headerless 429 的取值有两条路：环境变量优先（给 -p / SDK 测试用，那些场景没有 slash command 可调），\n"
     "否则走内存里的 mockHeaderless429Message；mock 没启用时返回 null。"),

    (687, 'after',
     "clearMockHeaders 是「全量复位」：除了六七个模块级变量，还顺手调 setMockBillingAccessOverride(null)。\n"
     "不连带清 billing override 的话，会出现「限流头清了但还冒充着 admin 身份」的半污染状态——\n"
     "下一个场景从干净基线开始，是 mock 可复现的前提。"),

    (709, 'after',
     "applyMockHeaders 是整个文件对生产的唯一出口：发请求前把 mock 头盖到真实 Headers 上。\n"
     "做法是 new Headers(headers) 拷一份再 set 覆盖，绝不原地改调用方传进来的对象（避免调用方复用同一份头时互相污染）。\n"
     "那条 eslint-disable 是误报：eslint-plugin-n 的 node builtins 特性检测不认 globalThis.Headers。"),

    (756, 'after',
     "getCurrentMockScenario 是反向工程：从当前 headers 反推「这看起来像哪个场景」，供 /status 之类的界面显示。\n"
     "判定顺序有讲究：先看 representative claim 是不是 opus/sonnet（这两个最具体），\n"
     "再按 overage 三态（rejected → warning → active）分流，最后才落到 status + claim 的组合。\n"
     "顺序颠倒会把 overage-active 误判成 session-limit-reached——两者的 status 都是 rejected。"),

    (822, 'after',
     "没显式设过订阅类型时回退 DEFAULT_MOCK_SUBSCRIPTION（'max'）而不是 null——\n"
     "调用方拿到 null 会走「无订阅」分支，而 mock 场景下我们想演的是「有 max 订阅但被限流」。"),

    (872, 'after',
     "expiry 在「第一次真报错」时才设，不是配场景时设。\n"
     "这样 duration 的计时从客户端第一次撞上限流开始算，而不是从测试人员敲下命令开始算——\n"
     "否则中间隔几分钟才发请求，冷却早就白送了。过期时先 clearMockHeaders 再返回 null，顺带复位。"),

    (882, 'after',
     "retry-after 按剩余毫秒动态算，并用 Math.max(1, ...) 兜底至少 1 秒。\n"
     "0 秒会被客户端理解成「立即重试」，既可能触发真实限流，也让冷却逻辑在测试里显得没生效。"),
]
