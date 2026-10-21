# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  api/client：把「哪个 provider、什么凭据、走哪个 fetch」拼成一个 SDK 客户端
// ═══════════════════════════════════════════════════════════════
//
//  这个文件是主循环真正发请求的入口。389 行，结构很简单：
//
//      getAnthropicClient      一个函数四个分支（Bedrock / Foundry / Vertex / 官方）
//      configureApiKeyHeaders  非订阅者的 key 注入
//      getCustomHeaders        解析 ANTHROPIC_CUSTOM_HEADERS
//      buildFetch              包一层 fetch：注入 request-id + 打日志
//
//  四个分支的代码高度相似，但**不能合并** —— 因为每个 SDK 的构造参数不同。
//  读的时候不要试图找「抽象」，这里没有也不需要抽象。'''),

    (32, 'before', '''// 【71 行的环境变量文档，值得单独讲】
//
//  这段注释是全文件最有价值的部分，因为它回答了「这个 CLI 到底支持哪些部署形态」：
//
//      Direct API    ANTHROPIC_API_KEY
//      Bedrock       AWS 凭据 + region（含小模型单独 region 覆盖）
//      Foundry       Azure 资源名或完整 base URL + key 或 Azure AD
//      Vertex        GCP 项目 + 一堆 per-model region 变量
//
//  注意 Vertex 那段写了**四级优先级**：
//
//      1. 模型专属变量（VERTEX_REGION_CLAUDE_3_5_HAIKU 等）
//      2. CLOUD_ML_REGION
//      3. 配置里的默认 region
//      4. 兜底 us-east5
//
//  「模型专属变量优先于全局变量」这个顺序很关键：它允许用户只把某个模型
//  指向另一个区域（比如某区域 Haiku 更便宜或延迟更低），其余不动。
//
//  读这类长注释的方法：**先找「有几个 provider」，再找每个的「必填项」和
//  「优先级链」**。剩下的都是细节。'''),

    (73, 'before', '''// 【SDK 的日志重定向到 stderr，而且四个级别都用 console.error】
//
//  四个方法全是 console.error，包括 info 和 debug。为什么？
//  因为**这是终端应用，stdout 是画面**。任何写到 stdout 的东西都会
//  插进正在渲染的界面里，把版式打乱。stderr 不参与渲染，所以安全。
//
//  biome-ignore 注释写了原因：SDK logger must use console。
//  也就是说不走项目自己的日志系统（那个系统可能有缓冲、有级别过滤），
//  因为 SDK 的日志要在最早期就能出来 —— 这时候项目日志系统可能还没初始化好。
//
//  这个 logger 只在 isDebugToStdErr() 时挂上（见第 168 / 216 / 294 / 312 行），
//  所以正常情况下这些 console.error 一次都不会执行。'''),

    (88, 'before', '''// 【函数签名：所有可选输入都从参数进来，没有一个从全局读】
//
//      { apiKey?, maxRetries, model?, fetchOverride?, source? }
//
//  只有 maxRetries 是必填的。这个设计的好处是**可测试**：
//  想测「重试 3 次的行为」，直接传 maxRetries: 3，不用改全局配置。
//
//  但也别高估这个「纯」—— 函数体内还是读了大量全局：process.env、
//  getSessionId()、getAPIProvider()、isClaudeAISubscriber()。
//  所以它其实是「半纯」：入口参数控制行为，环境变量控制分支。
//
//  读这种函数时，先看参数（决定它想被怎么用），再看 env（决定它实际会走哪条路）。'''),

    (101, 'before', '''  // 【四个环境变量被读进了局部变量 —— 为什么先读出来】
  //
  //      CLAUDE_CODE_CONTAINER_ID
  //      CLAUDE_CODE_REMOTE_SESSION_ID
  //      CLAUDE_AGENT_SDK_CLIENT_APP
  //      （加上 getCustomHeaders() 里的 ANTHROPIC_CUSTOM_HEADERS）
  //
  //  先读进局部变量的意义在于：**下面的 defaultHeaders 构造是一次性的语义**。
  //  如果在对象字面量里直接写 process.env.X，读代码的人会以为每次访问
  //  都重新读环境（虽然实际也是一次）。抽出来更清楚地表达「这四个值在
  //  构造这个客户端时被快照了」。
  //
  //  这对调试很重要：如果运行中改了环境变量但客户端没变，看这一段就知道
  //  为什么 —— 值在创建时已经固定。'''),

    (118, 'before', '''  // 【这行调试日志的字段选择透露了一个真实问题】
  //
  //  它记的是「有没有 ANTHROPIC_CUSTOM_HEADERS」和「有没有 Authorization 头」，
  //  而不是把头的**内容**记下来。注释写的是 for HFI debugging。
  //
  //  为什么只记布尔？因为 Authorization 里有 token，custom headers 里
  //  也可能有密钥。**调试日志的第一原则是不得泄露凭据**，所以只能记「有/无」。
  //
  //  而这两个布尔恰好够定位问题：
  //
  //      自定义头存在但 Authorization 不在 → 用户配的头没被解析出来
  //      两者都在 → 自定义头覆盖了 Authorization，401 就说得通了
  //
  //  判据：**日志里该记的是「判断分支所需的最小信息」，不是「全部信息」。**'''),

    (135, 'before', '''  // 【非订阅者才注入 key —— 订阅者用的是 OAuth accessToken】
  //
  //  这两条路径在下面的 clientConfig 里合流：
  //
  //      apiKey:    isSubscriber ? null : (apiKey || getAnthropicApiKey())
  //      authToken: isSubscriber ? getClaudeAIOAuthTokens()?.accessToken : undefined
  //
  //  注意 apiKey 那一行是**三目里再套或**：订阅者传 null（而不是 undefined），
  //  SDK 对 null 和 undefined 的处理可能不同 —— 显式给 null 是「我知道这里
  //  应该没有 key」，给 undefined 是「没设置」。这类区别在 SDK 里经常有意义。
  //
  //  另一件事：checkAndRefreshOAuthTokenIfNeeded() 在这一行之前 await 过
  //  （第 132 行），所以下面读到的 accessToken 是刷新后的。
  //  **顺序敏感：先刷新、再读 token、最后构造。**'''),

    (153, 'before', '''  // 【Bedrock 分支：三个 SDK 都是动态 import】
  //
  //  `await import('@anthropic-ai/bedrock-sdk')` 而不是顶部静态 import，
  //  原因很直接：**绝大多数用户不用 Bedrock**，静态 import 会让每个人
  //  都加载这三个大包（还带各自的依赖树）。
  //
  //  这是「按部署形态分包」的标准手法：顶层只 import 类型，运行时按需加载实现。
  //  代价是这一个函数变成 async —— 但 getAnthropicClient 本来就是 async。
  //
  //  顺带看第 157 行那个三重条件：
  //
  //      model === getSmallFastModel() && process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
  //        ? ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
  //        : getAWSRegion()
  //
  //  「只有查小模型时才用专属 region」—— 这个特例的存在说明：有人在
  //  某个区域没有小模型，但主模型有。**特例的注释价值往往比主逻辑高。**'''),

    (188, 'before', '''    // 【这行注释承认了一件事：返回类型是假的】
    //
    //  原文：we have always been lying about the return type - this doesn't
    //  support batching or models
    //
    //  函数声明返回 Promise<Anthropic>，但这里返回的是 AnthropicBedrock，
    //  用 `as unknown as Anthropic` 强行转过去。也就是说**类型系统在这里
    //  被关掉了**，因为 Bedrock SDK 没有实现 Anthropic 客户端的全部能力
    //  （batching、models 端点）。
    //
    //  这句话在三个分支里各出现了一次（Bedrock / Foundry / Vertex），
    //  措辞完全一样。这是一次**诚实的妥协被记录了三次**，而不是三次失误。
    //
    //  读代码时的启发：看到 `as unknown as`，先找旁边的注释。
    //  有注释说明是「已知妥协」，没注释就可能是「类型打架绕过去」。'''),

    (266, 'before', '''    // 【Vertex 的 mock GoogleAuth —— 测试和代理场景专用】
    //
    //  当设了 CLAUDE_CODE_SKIP_VERTEX_AUTH 时，用一个只有 getClient 的假对象
    //  顶替 GoogleAuth，它返回空的请求头。
    //
    //  这解决的是「本地起一个 Vertex 兼容代理，但不想配 GCP 凭据」的场景 ——
    //  代理自己会加认证。所以这里只要能通过 SDK 的类型检查、不发真实认证请求即可。
    //
    //  注意第 273 行那个 projectId 的条件注入（只在没有环境变量、
    //  也没有凭据文件时才用 ANTHROPIC_VERTEX_PROJECT_ID），注释解释了原因：
    //  **避免 google-auth-library 去敲 GCE metadata server，那会在 GCP 之外
    //  造成 12 秒超时。**
    //
    //  12 秒是一个可怕的数字 —— 它出现在启动路径上就是「打开 CLI 卡 12 秒」。
    //  这类「看起来无害的第三方默认行为」，往往比自己的 bug 更致命。'''),

    (301, 'before', '''  // 【官方 API 分支：baseURL 只在内部 + staging OAuth 时才覆盖】
  //
  //      ...(process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.USE_STAGING_OAUTH)
  //          ? { baseURL: getOauthConfig().BASE_API_URL }
  //          : {})
  //
  //  这个写法（展开一个空对象来实现条件属性）在本仓库里非常常见。
  //  好处是**类型上不需要 optional 标记**，对象字面量的形状始终完整。
  //
  //  注意条件是 AND：既要是内部用户，又要显式开了 staging。
  //  只判一个都有风险 —— 内部用户误连 staging，或外部用户改个环境变量就指到内网。
  //  **两个开关串联的写法，通常是「这个能力只给特定人群 + 还要他们主动开启」。**'''),

    (356, 'before', '''// 【请求 ID 头：为了「超时的时候也能对上日志」】
//
//  正常的关联方式是服务端的 request-id（响应头里带）。但**超时的时候
//  没有响应**，所以没有服务端 ID，客服/API 团队就无法从日志里找到这次请求。
//
//  所以客户端自己生成一个 UUID 提前塞进请求头：即使请求超时，
//  服务端日志里也有这个 ID。
//
//  两个条件限定了它只发往官方 API（见第 366 行）：
//
//      getAPIProvider() === 'firstParty'
//      isFirstPartyAnthropicBaseUrl()
//
//  注释给了原因：Bedrock/Vertex/Foundry 不记这个头，而且严格的企业代理
//  可能因为不认识的头而拒绝请求（inc-4029 那一类问题）。
//
//  这是「为可观测性加的头」必须付的代价：**任何自定义头都可能撞上严格的网关。**
//  所以只在确实需要、且确定服务端会接收的地方加。'''),

    (358, 'before', '''// 【buildFetch：一层薄薄的 fetch 装饰器，但它做了三件正确的事】
//
//  1. 先 clone headers 再改
//         new Headers(init?.headers) —— 不改调用方传进来的对象
//  2. 已有的 request-id 不覆盖
//         !headers.has(...) —— 让调用方可以自己指定（比如上层要追踪）
//  3. 日志包在 try 里，且注释写明 never let logging crash the fetch
//         new URL(url) 对非法 URL 会抛，而这是「记日志」不是「发请求」，
//         绝不能因为它失败而让请求发不出去
//
//  第三点在终端的调试输出里尤其重要：一个「日志代码把自己的 URL 解析挂了
//  导致整个请求失败」的 bug，排查起来会非常费劲，因为错误信息指向 URL。
//
//  另外注意 `inner` 的取值：fetchOverride ?? globalThis.fetch。
//  所以在测试里可以传一个假的 fetch，而这个装饰器仍然会生效 ——
//  **装饰的位置在「注入点之后」，不是在「注入点之前」**，这决定了
//  测试能覆盖到 buildFetch 本身。'''),
]
