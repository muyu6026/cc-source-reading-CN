# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  oauth/auth-code-listener：本地临时 HTTP 服务器，只为接一个回调
// ═══════════════════════════════════════════════════════════════
//
//  第 16 行的注释先把定位钉死了：
//
//      Note: This is NOT an OAuth server - it's just a redirect capture mechanism.
//
//  「不是 OAuth 服务器，只是个重定向捕获器」—— 这句话很重要，因为它
//  解释了为什么这个类可以这么简单：它不做认证、不签 token、不存会话，
//  只从一次 GET 的 query 里读两个参数，然后回一个 302。
//
//  211 行里唯一需要小心的是「这个服务器什么时候关」—— 见第 199 行。'''),

    (18, 'before', '''// 【六个字段，其中三个是「Promise 的两半」】
//
//      promiseResolver / promiseRejecter   外部等待者的两个回调
//      expectedState                       要校验的 state
//      pendingResponse                     攥着不放的那个 HTTP 响应
//
//  pendingResponse 是这个类最特殊的地方。收到正确的回调时，它**不回响应**，
//  而是把 res 存起来，让浏览器停在那里转圈 —— 因为这时候 token 还没换到，
//  不知道成功还是失败。
//
//  等 OAuthService 那边换完 token，再调 handleSuccessRedirect /
//  handleErrorRedirect 把那个响应补上。**用户的浏览器会一直等到最后一步。**
//
//  这是「延迟响应」的正当用法：让浏览器成为流程的一部分，而不是
//  「先回个 OK 再说」。代价是这个响应对象必须被正确释放（close 里兜底）。'''),

    (27, 'before', '''// 【callbackPath 可配置，默认 /callback】
//
//  默认值就是 buildAuthUrl 里拼的 `http://localhost:${port}/callback`。
//  可配置是为了遇到「端口被占 + 路径被改」的特殊部署时能绕。
//
//  注意构造函数只 createServer 不 listen —— 分离这两步是为了让 start()
//  能返回端口号（OS 分配完之后才知道）。'''),

    (32, 'before', '''// 【start() 的设计说明里有一句关键的话】
//
//  原文：This avoids race conditions by keeping the server open until it's used.
//
//  「保持服务器开着直到被使用，避免竞态」—— 说的是这么一种写法不要用：
//
//      开端口 → 拿端口号 → 关端口 → 拼 URL → 等用户点 → 再开端口
//
//  那种写法的窗口期里，端口可能被别的进程抢走，于是回调打到别人身上。
//  所以这里一旦 listen 就一直开着，直到流程结束才关。
//
//  用 `port ?? 0` 让 OS 分配，是避免「写死 3000 端口结果被占」的标准做法。
//  代价是每次端口都不同 —— 所以 redirect_uri 必须动态拼（client.ts 第 79 行
//  那个模板字符串就是为此）。'''),

    (58, 'before', '''// 【hasPendingResponse：一个被外部用来判断「走的哪条路」的探针】
//
//  这个方法是给 OAuthService 用的（见 index.ts 第 89 行）：
//
//      有 pendingResponse  →  code 是从浏览器回调来的（自动）
//      没有                →  code 是用户手动粘的
//
//  为什么「有没有待回应的响应」等价于「是不是自动路径」？
//  因为只有自动路径会产生一个 HTTP 请求，而那个请求的响应被扣下了。
//  手动路径里这个字段永远是 null。
//
//  这也说明：**一个看起来像「查询状态」的方法，实际承担了「区分来源」的职责。**
//  读代码时看到这种「状态即信息」的用法，值得停下来想一下它编码了什么。'''),

    (134, 'before', '''// 【handleRedirect：先看路径，再看参数】
//
//  第 140 行的路径检查很重要：**不是 /callback 的一律 404，不进业务逻辑。**
//
//  因为浏览器会顺手请求 /favicon.ico、/robots.txt 之类。如果不判路径，
//  那些请求会走到 validateAndRespond 里，然后因为「没有 code」而被
//  reject —— 整个登录流程被一个 favicon 请求打断。
//
//  这是一个很典型的「监听本地端口」陷阱：**你收到的不只是你等的那个请求。**
//
//  另外注意 URL 构造用了 `req.headers.host || 'localhost'` 作为 base ——
//  因为 req.url 只有路径部分，需要一个 base 才能解析成 URL 对象。'''),

    (152, 'before', '''// 【validateAndRespond：两个检查，顺序有讲究】
//
//      1. 没有 code        → 400 + reject
//      2. state 不匹配     → 400 + reject
//
//  为什么 state 检查必须在「拿到 code 之后」而不是之前？因为 state 和 code
//  是同一次请求的两个参数，先判哪个都一样。但**先判 code 更好**：
//  没有 code 说明这不是一次回调（可能是探测请求），根本不该提 state。
//
//  state 校验的意义（第 23 行注释写了 CSRF protection）：
//  攻击者可以诱导用户点击一个伪造的授权链接，让用户的浏览器带着
//  **攻击者的** code 回到我们的 localhost。state 是随机的，攻击者猜不到，
//  所以这个请求的 state 对不上 —— 被拒。
//
//  注意两个分支都先 writeHead(400) + end() 再 reject：**先给浏览器一个
//  明确的失败页，再让 Promise 失败。** 反过来的话浏览器会一直转圈。'''),

    (199, 'before', '''// 【close()：一份「怎么关才不出事」的清单】
//
//  三步，顺序不能换：
//
//      1. 如果有待回应的响应 → 先给它一个错误重定向
//         否则浏览器永远停在白屏（连接一直开着）
//      2. removeAllListeners()
//         防止 close 过程中又触发 request/error 回调
//      3. localServer.close()
//
//  第 2 步的注释写着 to prevent memory leaks。实际作用更具体：
//  Node 的 Server 在 close 之后仍可能派发已排队的请求，那时 handler 里
//  引用的 this.promiseResolver 已经是 null，容易写出难查的逻辑错误。
//  先把监听器清掉，等于「关门之前先把迎宾员撤了」。'''),
]
