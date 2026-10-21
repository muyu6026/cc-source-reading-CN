# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  errorUtils：把「网络错误」翻译成「用户能看懂的一句话」
// ═══════════════════════════════════════════════════════════════
//
//  这个文件解决三个具体问题：
//
//      1. SDK 的错误被包了好几层，真正的错误码在 cause 链深处
//      2. 企业代理/自签证书报的 SSL 错误码有一堆，用户看不懂
//      3. 服务端偶尔返回 HTML（CloudFlare 页面），整坨塞进终端会炸版式
//
//  260 行，全部是「取错误 → 认形状 → 换文案」，没有业务逻辑。'''),

    (5, 'before', '''// 【把 18 个 OpenSSL 错误码列成一个集合 —— 这是在给「一类错误」命名】
//
//  Node 和 Bun 都基于 OpenSSL，所以错误码是一样的，注释特意点明了这点。
//
//  为什么要穷举而不是用「包含 CERT 或 SSL 就行」这种模糊判断？
//  因为**这里判错的代价不对称**：
//
//      漏判一个 SSL 码   → 用户看到一句不知所云的英文，多花一次客服沟通
//      误判一个非 SSL 码 → 用户被引导去改 NODE_EXTRA_CA_CERTS，白折腾
//
//  穷举的写法让「哪些算 SSL」成为可审阅的清单，加新码时也有明确位置可加。
//
//  顺带看这份清单的分类方式：证书验证 / 自签 / 链 / 主机名 / 握手 ——
//  这是运维视角的分类，不是错误码字典的顺序。**分类方式暴露作者遇到过什么。**'''),

    (42, 'before', '''// 【沿 cause 链往下找，而不是只看最外层】
//
//  为什么需要这样？因为 Anthropic SDK 的调用链是：
//
//      axios（或 fetch）抛出 ECONNRESET
//        → SDK 包一层 APIConnectionError（message 变成 'Connection error.'）
//        → 我们拿到的 error.cause 才是原始的那个
//
//  所以最外层错误的名字永远是 'APIConnectionError' 之类，**真正的信息
//  在 cause 里**。不往下挖就只能显示一句「Connection error.」。
//
//  两个防御细节值得注意：
//
//      maxDepth = 5            防止循环引用或超长链导致的卡死
//      current.cause !== current  显式的自引用检查
//
//  后者不是多余 —— 有的库会把 cause 指回自己，那样 while 循环会一直转，
//  depth 上限虽然能兜住，但会白跑 5 圈。'''),

    (55, 'before', '''    // 【判断顺序：先确认是 Error，再确认有 code 字段，再确认是字符串】
    //
    //      current instanceof Error && 'code' in current && typeof current.code === 'string'
    //
    //  三步缺一不可：
    //    不判 instanceof → 拿到随便一个对象就 `current.code`，类型上不安全
    //    只判 in        → code 可能是 number 或 undefined（Node 的某些错误码是数字）
    //    不判 typeof    → Set.has(undefined) 不会报错但会静默返回 false
    //
    //  这是「对 unknown 做类型收窄」的标准姿势：**每一层假设都要单独验证，
    //  不要用一次类型断言跳过。** 注意这里面每一步之后 TypeScript 都知道
    //  更多信息，所以最后 `const code = current.code` 是 string 类型。'''),

    (94, 'before', '''// 【这个函数存在的理由写在注释里，而且值得读两遍】
//
//  原文：enterprise users behind TLS-intercepting proxies (Zscaler et al.)
//  see OAuth complete in-browser but the CLI's token exchange silently fails
//  with a raw SSL code. Surfacing the likely fix saves a support round-trip.
//
//  场景：企业网络里有个中间人代理（Zscaler 这类）替换了证书。
//  浏览器里 OAuth 一路绿灯（因为浏览器信任企业根证书），
//  到了 CLI 里换 token 就静默失败，只丢一个 UNABLE_TO_VERIFY_LEAF_SIGNATURE。
//
//  用户完全无法从这句话里推出「要找 IT 要根证书」。所以这个函数
//  直接给出了可执行的下一步：
//
//      设 NODE_EXTRA_CA_CERTS 指向 CA bundle
//      或者让 IT 把 *.anthropic.com 加白
//      跑 /doctor 看详情
//
//  判据：**错误提示的价值不在「描述发生了什么」，而在「告诉我下一步做什么」。**
//  一个能省一次客服往返的提示，值得为它写一个函数。'''),

    (107, 'before', '''// 【CloudFlare 的 HTML 错误页，单独处理】
//
//  当请求打到挂了或者被挡住的网关时，返回的 body 可能是一整页 HTML。
//  SDK 会把它塞进 error.message，于是终端里就会渲染出几 KB 的
//  `<!DOCTYPE html><html><head>...` —— 版式全毁，而且一个字的有用信息都没有。
//
//  处理方式是：**认出它是 HTML，然后只留 title**。
//
//      有 title → 用 title（通常是 "Attention Required! | Cloudflare"）
//      没 title → 返回空串（宁可什么都不显示）
//
//  注意它判断的是两个特征串（DOCTYPE 和 <html），不是「以 < 开头」——
//  因为正常的错误信息里也可能出现 <。**宽松的正则在这里会造成误伤。**'''),

    (132, 'before', '''// 【从会话 JSONL 反序列化回来的错误，形状不一样 —— 这是本文件最绕的一段】
//
//  问题：APIError 是 class 实例，带 message getter。
//  一旦写进 JSONL 再读回来，就变成普通对象，**message 属性没了**。
//
//  而不同 provider 的嵌套层次不同：
//
//      Bedrock / 代理      { error: { message: "..." } }
//      标准 Anthropic API  { error: { error: { message: "..." } } }
//
//  为什么标准 API 要套两层？因为外层 `.error` 是**响应体**，
//  内层 `.error` 才是 API 的错误对象。也就是：
//
//      { "type": "error", "error": { "type": "...", "message": "..." } }
//
//  读回来之后，外层 type 丢了，只剩两层 error。
//
//  注释里还留了一条交叉引用（See also: getErrorMessage in logging.ts which
//  handles the same shapes）—— 同一套形状在两个文件里各解析了一遍。
//  这是一个**已知的重复**，不是失误，但也是个可以合并的机会。'''),

    (169, 'before', '''// 【先试深的、再试浅的 —— 顺序有讲究】
//
//  第 180 行先取 error.error.error.message（标准 API 形状）
//  第 189 行再取 error.error.message（Bedrock 形状）
//
//  为什么深的优先？因为深的那条路径**更具体**：如果两层都有 message，
//  内层才是真正的错误信息，外层可能是一句泛泛的包装。
//
//  每一层都做了三件事：typeof 检查、长度检查、sanitize。
//  最后那个 `sanitized.length > 0` 很关键 —— 因为 sanitizeMessageHTML
//  对 HTML 没 title 的情况返回空串，那说明这一层**有值但没有可用信息**，
//  应该继续往下一层找，而不是返回空串。
//
//  **「找到了字段」和「找到了可用内容」是两件事**，这个函数把两者分开了。'''),

    (200, 'before', '''// 【总入口：先查连接错误，再查 message，最后兜底】
//
//  顺序是有道理的：
//
//      1. 连接层错误（ETIMEDOUT / SSL）→ 最具体，有专门的文案
//      2. message === 'Connection error.' → 连接失败但没细节，至少带上 code
//      3. 没有 message（JSONL 读回来的）→ 挖嵌套，再不行给状态码
//      4. 有 message → 清洗 HTML 后返回
//
//  第 237 行那个 `error.message === 'Connection error.'` 是**字符串比对**，
//  看起来脆弱，但它是 SDK 写死的常量文案（不是我们自己的），
//  所以实际上很稳定。读这类比对时的判据：**这个字符串是谁写的？**
//  别人写死的常量可以比，自己拼出来的文案不要比。'''),

    (248, 'before', '''  // 【兜底那句话里带上了 status，这不是随手写的】
  //
  //      `API error (status ${error.status ?? 'unknown'})`
  //
  //  当所有信息都没了（JSONL 读回来、没嵌套、没 message），
  //  至少还剩一个 HTTP 状态码 —— 而 401/403/429/500 各自指向完全不同的原因。
  //
  //  用 `?? 'unknown'` 而不是直接插值，是为了避免出现 "status undefined"
  //  这种既吓人又没信息的输出。
  //
  //  注释（第 245 行）还说明了为什么要兜底：Return a safe fallback instead of
  //  undefined, which would crash callers that access .length.
  //  也就是说**这个函数的返回类型是 string，而调用方会直接 .length**。
  //  返回 undefined 会在很远的地方炸掉，所以宁可在源头给一句话。'''),
]
