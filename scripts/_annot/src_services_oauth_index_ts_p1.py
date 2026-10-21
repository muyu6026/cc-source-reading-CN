# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  oauth/index：OAuthService —— 一次登录的全部编排
// ═══════════════════════════════════════════════════════════════
//
//  这个类只做一件事：**把「两条并行的获取授权码的路径」收敛成一个 Promise。**
//
//      自动路径  开浏览器 → 服务端重定向回 localhost:port/callback
//      手动路径  用户自己复制授权码粘进来（无浏览器环境）
//
//  两条路谁先到谁赢，另一条立刻作废。这个「赛跑」结构就是本文件的全部。'''),

    (21, 'before', '''// 【四个字段，各有各的「一边在等另一边」】
//
//      codeVerifier           构造函数里就生成，全程不变
//      authCodeListener       自动路径的本地服务器
//      port                   它监听的端口，要拼进 redirect_uri
//      manualAuthCodeResolver 手动路径的 Promise resolve 函数
//
//  关键在最后一个：它存的是**别人的 resolve 函数**。手动输入时调用它，
//  就等于替那个 Promise 完成。这是「从外部触发一个内部 Promise」的标准手法。
//
//  注意 codeVerifier 在 constructor 里生成而不是在 startOAuthFlow 里 ——
//  保证同一个 service 实例的所有流程用同一个 verifier。虽然实际上一实例
//  只用一次，但这个位置暗示了「它是身份的根」。'''),

    (32, 'before', '''// 【authURLHandler 参数：把「怎么打开」交给调用方】
//
//  这个函数不收 URL 而是收一个**回调用**，因为「给用户看两个 URL」这件事
//  在不同的宿主里做法完全不同：
//
//      终端   渲染一个提示 + 尝试 openBrowser
//      SDK    通过控制协议把两个 URL 发回客户端，由客户端决定怎么展示
//
//  所以第 47 行的 skipBrowserOpen 就是为此存在的，注释写得很清楚：
//
//      Don't call openBrowser(). Caller takes both URLs via authURLHandler
//      and decides how/where to open them. Used by the SDK control protocol
//      (claude_authenticate) where the SDK client owns the user's display,
//      not this process.
//
//  **「谁拥有用户的屏幕」决定了谁能开浏览器。** 这是一个很容易被忽略的边界：
//  在别人的进程里偷偷 openBrowser 会打开一个用户意料之外的窗口。'''),

    (69, 'before', '''    // 【两个 URL 同时构造好，因为不知道用户会走哪条路】
    //
    //      manualFlowUrl     redirect_uri 指向一个静态页面，用户手动复制 code
    //      automaticFlowUrl  redirect_uri 指向 http://localhost:<port>/callback
    //
    //  差别全在 redirect_uri 上（见 client.ts 第 75 行）。
    //
    //  为什么要**同时**给两个？因为自动路径可能失败：企业网络限制 localhost
    //  回环、浏览器在另一台机器上、或者用户根本不想开浏览器。
    //  这时手动路径是兜底，而它必须在同一时刻就可用 —— 否则用户等半天
    //  才看到「也可以手动」。
    //
    //  注意 state 和 codeChallenge 是两个 URL 共用的：同一个 verifier、
    //  同一个 state，所以无论走哪条路，最后换 token 的逻辑都一样。'''),

    (89, 'before', '''    // 【isAutomaticFlow 的判断时机值得注意：在拿到 code 之后、换 token 之前】
    //
    //      const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false
    //
    //  hasPendingResponse() 检查的是「本地服务器手里是否攥着一个还没回应的
    //  HTTP 响应」—— 有，说明 code 是从浏览器重定向来的；没有，说明是手动输入的。
    //
    //  为什么用这个间接判断，而不是记一个布尔量？因为**自动路径的成功与否
    //  由服务器端决定，不由本类的控制流决定**。手动路径会把 listener 关掉，
    //  关掉之后 pendingResponse 就是 null —— 这个状态自然地表达了「走的哪条路」。
    //
    //  然后用它做三件事：
    //
    //      1. 埋点（automatic: true/false）—— 用来统计哪种路径更常用
    //      2. 换 token 时传 isManual = !isAutomaticFlow
    //      3. 成功/失败后决定要不要给浏览器回一个重定向页
    //
    //  第 3 条最关键：如果是自动路径，用户的浏览器还停在「等待回调」的白屏上，
    //  必须回一个 302 把它送到成功页，否则用户以为卡住了。'''),

    (134, 'before', '''// 【waitForAuthorizationCode：把两条路塞进一个 Promise】
//
//  结构很巧，值得逐行读：
//
//      this.manualAuthCodeResolver = resolve        ← 先把手动路径接上
//      this.authCodeListener?.waitForAuthorization(state, onReady)
//        .then(code => { this.manualAuthCodeResolver = null; resolve(code) })
//        .catch(err  => { this.manualAuthCodeResolver = null; reject(err) })
//
//  两个细节：
//
//  1. **先设 manualAuthCodeResolver，再启动自动流程**
//     顺序不能反 —— 反了的话，如果自动流程同步失败，手动路径还没接上，
//     用户此时粘贴 code 会静默无效。
//
//  2. then/catch 里都先清空 resolver 再 resolve
//     清空是为了让「后到的那个」失效：自动成功了就把手动入口关掉，
//     否则用户再粘一个 code 会调用一个已经 resolve 过的函数（无害但混乱）。
//
//  这是一个「多个 Promise 赛跑、只取第一个」的手写实现。
//  Promise.race 做不到，因为手动那条不是 Promise，是「等一个外部调用」。'''),

    (157, 'before', '''// 【handleManualAuthCodeInput：从外部完成任务的那个入口】
//
//  它做的事只有三行，但每一行都有原因：
//
//      if (this.manualAuthCodeResolver)          ← 没有等待者就什么都不做
//        this.manualAuthCodeResolver(code)        ← 替内部 Promise 完成
//        this.authCodeListener?.close()          ← 立刻关掉本地服务器
//
//  第一行的判空很重要：自动路径已经成功时 resolver 是 null，此时用户
//  再粘贴 code 会被静默忽略。这是正确的行为 —— 不能因为用户多贴一次就
//  重新走一遍流程。
//
//  第三行是资源释放：手动成功之后，本地服务器还在监听端口，没有用了。
//  如果不关，`startOAuthFlow` 的 finally 里还会再关一次（close 是幂等的），
//  但早点关能早一点释放端口 —— 而端口是靠 OS 分配的，占着没意义。'''),

    (169, 'before', '''// 【formatTokens：把服务端的 snake_case 响应转成本地的 camelCase】
//
//  这一段最容易出错，因为它是「协议 → 类型」的边界。三处细节：
//
//  1. expiresAt 存的是**绝对时间**（Date.now() + expires_in * 1000）
//     不是相对秒数。因为本地判过期时要和当前时间比，存相对值每次都要
//     重新加，而且进程重启后就没意义了。
//
//  2. tokenAccount 是条件字段（response.account 存在才建）
//     注意 organization?.uuid 用的是可选链 —— 因为账号可能不属于任何组织
//     （个人账号），这时 organization 是 undefined。
//
//  3. profile 整个塞进 tokens（rawProfile 原样保留）
//     这样调用方既能用解析后的 subscriptionType，也能拿到原始结构。
//     **原样保留原始响应**是处理第三方协议的好习惯：将来要用新字段时
//     不用改这里。'''),
]
