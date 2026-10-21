# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  api/errors：1,207 行的「错误翻译层」
// ═══════════════════════════════════════════════════════════════
//
//  这是 services/api/ 里最长的文件，也是最没有算法、最考验耐心的一个。
//  它做三件事，各自服务于不同的读者：
//
//      常量 + getXxxErrorMessage   给**用户**看的中文/英文句子
//      getAssistantMessageFromError  把异常转成一条「assistant 消息」
//      classifyAPIError            给**埋点**用的标签（Datadog tag）
//
//  为什么错误要转成「assistant 消息」而不是 throw 出去？这是这份代码
//  最重要的一个设计，见第 425 行。'''),

    (54, 'before', '''// 【一个前缀常量，被两处反向解析】
//
//      API_ERROR_MESSAGE_PREFIX = 'API Error'
//      startsWithApiErrorPrefix(text)  用 startsWith 判断
//
//  注意：**文案是被人解析的**。写文案和读文案分在两个文件里 ——
//  这里生成 'API Error: ...'，UI 那边用 startsWith 认出「这是一条错误」，
//  然后换一种渲染方式（标红、不折叠）。
//
//  这就是一个隐式的协议：改文案等于改协议。所以下面几十个常量全部是
//  `export const`，而且 UI 那边不是硬编码字符串而是 import 这个常量。
//
//  判据：**当一个字符串要同时被「展示」和「判断」，它就该是常量，
//  而且不该在判断侧硬编码字面量。**'''),

    (79, 'before', '''// 【解析 token 数，正则写得故意很松】
//
//      /prompt is too long[^0-9]*(\\d+)\\s*tokens?\\s*>\\s*(\\d+)/i
//
//  注释（第 82 行）说明了为什么要松：raw string 可能被 SDK 前缀包住、
//  可能被 JSON 信封包住、大小写还可能不同（Vertex）。
//
//  所以策略是：**只锚定「不变的部分」**，中间的噪音用 `[^0-9]*` 一锅吞。
//  这样写出来的正则对格式变化极有韧性 —— 只要「prompt is too long」
//  后面跟着两个数字、中间有个大于号，就能解析出来。
//
//  反面写法是把整句 `prompt is too long: 137500 tokens > 135000 maximum`
//  完整匹配，那样服务端改一个空格就全废。
//
//  解析结果用 undefined 而不是 0 表示「不知道」—— 因为 0 是个合法值
//  （0 tokens 超出？不可能，但类型上不能排除），用 0 会让下游误判。'''),

    (120, 'before', '''// 【这段 13 行的注释在描述一个循环依赖，值得逐句读】
//
//  三个地方必须保持同步：
//
//      第 523 / 560 / 573 行左右   getAssistantMessageFromError 里设置 errorDetails 的分支
//      第 929-946 行左右           classifyAPIError 里对应的分支
//      本函数 isMediaSizeError     判断 errorDetails 是不是「媒体太大」
//
//  然后注释说了一件很微妙的事：
//
//      The closed loop: errorDetails is only set after those branches already
//      matched these same substrings, so isMediaSizeError(errorDetails) is
//      tautologically true for that path.
//
//  翻译：errorDetails 只会在「那三个分支已经匹配过同样的子串」之后才被设置。
//  所以只要 errorDetails 有值，isMediaSizeError 必然为真 —— **恒真**。
//
//  那还判断它干什么？为了「防御未来的漂移」：
//
//      API wording drift causes graceful degradation (errorDetails stays
//      undefined, caller short-circuits), not a false negative.
//
//  也就是说，如果哪天服务端改了措辞，导致那三个分支匹配不上，
//  errorDetails 就不会被设置，于是 isMediaSizeError 返回 false，
//  调用方走「不重试」的分支 —— 功能降级，但**不会误判成媒体错误然后
//  把图片全删了**。
//
//  这是一个「恒真判断为什么还要写」的完整答案：它守的不是当下，是未来。
//  代价是三处字符串必须同步，作者用注释把这个隐性契约写下来了。'''),

    (170, 'before', '''// 【同一句话，两个版本 —— 交互模式和非交互模式】
//
//      PDF too large (...). Double press esc to go back and try again, ...
//      PDF too large (...). Try reading the file a different way (e.g., pdftotext).
//
//  差别不是措辞，是**用户能做什么**：
//
//      交互模式   有界面、能按 esc 回到上一步 → 告诉他按 esc
//      非交互模式 claude -p 或 SDK 调用，没有「上一步」→ 告诉他换个做法
//
//  这是全文件里出现最频繁的一个模式（第 170 / 176 / 181 / 186 / 191 /
//  200 / 206 行都是），而且每一处都是 getIsNonInteractiveSession() 三目。
//
//  判据：**错误文案必须针对「当前这个用户能采取的动作」写，不能只描述错误。**
//  在 -p 模式下告诉用户「双击 esc」，等于什么都没说。
//
//  顺带注意 limits 那一行把常量拼进文案：API_PDF_MAX_PAGES 和
//  PDF_TARGET_RAW_SIZE 是 import 来的，所以服务端限制改了，文案自动跟着改。'''),

    (222, 'before', '''// 【为了发一条埋点，写了一个 150 行的函数】
//
//  这个函数只在一种错误下被调用：400「tool_use ids were found without
//  tool_result blocks immediately after」。也就是消息序列里工具调用和
//  结果没配对。
//
//  它做的事：在**归一化后**的 messages 里找到那个 tool_use 的位置，
//  在**原始的** messages 里也找到，然后把两边「这条之后的所有块」都
//  压成一个字符串序列，一起上报。
//
//  为什么要两份？因为归一化会合并/拆分消息，原始序列才是用户实际发生的。
//  两边的差异就是 bug 的线索 —— **对照两个视图，是定位「转换过程中丢东西」
//  这类 bug 的标准手法。**
//
//  注意整个函数包在 try 里（第 227 行），注释写着 Temp helper。
//  也就是说：这是一个**排障用的临时代码**，它自己出错绝不能让错误处理
//  流程崩掉 —— 因为它的调用点在错误处理链上。
//
//  这类代码的判据：功能是「采样诊断」，那么它的可靠性要求低于宿主流程，
//  必须自己吞掉异常。'''),

    (425, 'before', '''// 【核心设计：错误被转成一条「assistant 消息」，而不是抛出去】
//
//  返回类型是 AssistantMessage，内容是「模型说的话」，只是带了
//  isApiErrorMessage: true 标记。
//
//  为什么？三个后果，每一个都很重要：
//
//  1. **错误进入对话历史**。下一轮请求会把它带给模型，模型能看到
//     「上一轮我这边出错了」，从而调整（比如不再重复那个超大请求）。
//     如果只是 throw，模型永远不知道发生过什么。
//
//  2. **UI 不需要错误通道**。终端里「显示一条消息」和「显示一个错误」
//     走同一条渲染链，错误只是样式不同。少了一套并行的错误 UI。
//
//  3. **错误可以被压缩、被 /rewind、被持久化**。因为它就是消息，
//     所有对消息生效的机制自动对它生效。
//
//  代价是：错误和正常内容共用一套数据结构，所以必须有 isApiErrorMessage
//  这个标记，而且**每个消费方都要记得检查它**。这是这套设计的税。
//
//  下面这一长串 if 的顺序就是优先级 —— 先认最具体的（超时、图片校验），
//  再认状态码 + 文案组合，最后落到通用分支。改顺序会改变归类结果。'''),

    (465, 'before', '''  // 【429 分两条完全不同的路，靠「有没有统一的限流头」区分】
  //
  //     有 anthropic-ratelimit-unified-* 头  →  是配额限制，能算出具体是哪一种、
  //                                            什么时候恢复，给出精确文案
  //     没有这些头                          →  不是配额限制，把 API 原话透出来
  //
  //  注释（第 537 行）把第二种说得很清楚：Entitlement rejections
  //  (e.g. 1M context without Extra Usage) and infra capacity 429s land here.
  //
  //  也就是说 429 这个状态码被**过度复用**了：既表示「你超配额了」，
  //  也表示「你套餐不支持这个功能」，还表示「我们这边容量不够」。
  //  只能靠头来区分。
  //
  //  这是一个很典型的现实：**HTTP 状态码的语义比业务语义粗**。
  //  所以凡是「状态码 + 响应头 + 文案」三层一起判断的地方，都别嫌它啰嗦。'''),

    (527, 'before', '''      // 【返回 NO_RESPONSE_REQUESTED —— 一个「静默但有记录」的特殊值】
      //
      //  getRateLimitErrorMessage 返回 null 意味着：这次限流**会由降级机制
      //  自动处理**（比如 Opus 满了自动换 Sonnet）。所以不该弹错误给用户。
      //
      //  但也不能什么都不返回 —— 注释说得很准确：
      //
      //      Return NO_RESPONSE_REQUESTED so no error is shown to the user,
      //      but the message is still recorded in conversation history
      //      for Claude to see.
      //
      //  两个需求同时满足：**用户看不见，模型看得见。**
      //
      //  这个技巧在整份源码里反复出现：一个特殊的内容值（不是 null、不是空串）
      //  用来表达「这条消息存在，但不要显示」。第 62 行那个常量就是它的定义处。
      //
      //  判据：当你需要「记录但不显示」，不要用空内容（容易被过滤掉），
      //  用一个可识别的哨兵值。'''),

    (644, 'before', '''  // 【`AFK_MODE_BETA_HEADER &&` 这个守卫，是构建期门控的运行时残留】
  //
  //  注释写明了：AFK_MODE_BETA_HEADER is '' in non-TRANSCRIPT_CLASSIFIER
  //  builds, so the truthy guard keeps this inert there.
  //
  //  也就是说：在不开那个 feature 的构建里，这个常量被折成空字符串，
  //  于是 `'' && ...` 恒假，整个 if 块永远不执行。
  //
  //  但注意 —— **代码还在包里**。这和上一批读到的 `false &&` 残留是同一类现象：
  //  打包器做了常量折叠，没做死代码消除。
  //
  //  差别在于这里用的是**变量**（常量 import）而不是字面量 false，
  //  所以折叠结果取决于跨模块的常量传播能力。能折成 `''` 说明打包器
  //  确实做了跨模块的内联 —— 但依然没有删掉这个 if。
  //
  //  这也解释了为什么作者选择用「空字符串 + 真值守卫」而不是 feature() 包 if：
  //  两种写法在产物里留下的东西差不多，而空字符串不需要额外 import。'''),

    (687, 'before', '''    // 【内部用户和外部用户，两条完全不同的文案】
    //
    //  内部（USER_TYPE === 'ant'）：
    //      API Error: 400 <原始 message>
    //      Run /share and post the JSON file to <内部频道>。
    //      然后用 /rewind 恢复。
    //
    //  外部：
    //      API Error: 400 due to tool use concurrency issues.
    //      Run /rewind to recover the conversation.
    //
    //  差别有两层：
    //
    //  1. 内部版把 API 的原始 message 透出来了 —— 外部用户看不懂，也不需要看
    //  2. 内部版引导去 /share 上报，外部版只给恢复路径
    //
    //  这是「同一件事对不同人给不同信息量」的典型处理。注意它不是简单的
    //  「藏信息」，而是**换了一套动作指引**：内部用户该做的是上报，
    //  外部用户该做的是恢复。
    //
    //  顺带看 MACRO.FEEDBACK_CHANNEL：一个构建期替换的宏。
    //  这就是为什么内部频道名不会出现在开源版本里。'''),

    (940, 'before', '''// 【`@[MODEL LAUNCH]` —— 一个给「发新模型时」用的待办标记】
//
//  注释原文：@[MODEL LAUNCH]: Add a fallback suggestion chain for the new
//  model → previous version for 3P.
//
//  这个标记在仓库里是**可搜索的待办**：发新模型时要来这里加一条降级建议。
//  比 TODO 好的地方是它带了一个可 grep 的精确前缀，而且语义明确
//  （不是「以后可能要做」，是「发版流程的一步」）。
//
//  函数本身只对第三方 provider 生效（第 941 行 firstParty 直接返回 undefined），
//  因为官方 API 上新模型和旧模型同时在线，不需要建议降级；
//  而 Bedrock/Vertex 上新有延迟，用户选了还没上线的模型就会 404。
//
//  所以这里的三条 if 就是「新模型 → 上一个可用版本」的映射表。
//  注意匹配用的是 includes 而且同时匹配连字符和下划线两种写法 ——
//  因为不同 provider 的模型 ID 命名规范不同。'''),

    (1163, 'before', '''// 【categorizeRetryableAPIError：只判状态码，和上面那个函数分工明确】
//
//  两个分类函数的区别值得记住：
//
//      classifyAPIError              给埋点用，认得几十种具体错误（含文案匹配）
//      categorizeRetryableAPIError   给重试决策用，只看状态码
//
//  为什么重试决策不需要那么细？因为重试逻辑只关心一件事：
//  **再试一次有没有意义。** 而这件事基本由状态码决定：
//
//      529 / overloaded  → 服务端过载，等一会儿再试 ✓
//      429               → 限流，退避后重试 ✓
//      401 / 403         → 认证问题，重试多少次都一样 ✗
//      >= 408            → 服务端/网络类，可以试
//      其他              → unknown（由上层决定）
//
//  注意 529 被归到 rate_limit 而不是单独一类 —— 因为对重试策略来说，
//  它们的处理完全一样（指数退避）。**分类的粒度由消费方决定，
//  做同一个次就够了。**
//
//  这也解释了为什么状态码 >= 408 就归 server_error：4xx 里的 400/404/413
//  是「你的请求有问题」，408（超时）和 5xx 才是「服务端/链路的问题」。'''),

    (1184, 'before', '''// 【refusal 不是错误，是模型的一次正常回答 —— 但要好心处理】
//
//  模型可以选择「拒绝回答」（stop_reason === 'refusal'）。这在协议上是
//  一次成功的响应，不是 HTTP 错误。所以这个函数接的是 stopReason
//  而不是 error。
//
//  它做了三件事：
//
//      1. 埋点（tengu_refusal_api_response）—— 用来观察拒绝率
//      2. 一句解释 + 用法政策链接，并给出「改一下说法」的建议
//      3. 如果当前不是 Sonnet，建议切到 Sonnet 再试
//
//  第 3 条很有意思：**换模型也是一种「改说法」**。不同模型对同一边界请求的
//  判定不完全一致，所以换一个模型可能就过了。
//
//  注意它对模型名的比较是硬编码字面量 'claude-sonnet-4-20250514'，
//  而不是走 getModelStrings()。这和本目录其他地方的做法不一致 ——
//  属于「历史遗留 + 懒得改」，读到不用深究，但要知道这是个例外。'''),
]
