# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  oauth/client：OAuth 协议的客户端实现（566 行）
// ═══════════════════════════════════════════════════════════════
//
//  五个入口，对应 OAuth 授权码流程的五个动作：
//
//      buildAuthUrl          拼授权页 URL（带 PKCE challenge）
//      exchangeCodeForTokens 用 code + verifier 换 token
//      refreshOAuthToken     用 refresh token 续期
//      isOAuthTokenExpired   本地判过期
//      fetchProfileInfo      查套餐 / 计费类型
//
//  最值得读的一段不是协议本身，而是第 187 行那段注释 —— 它记录了
//  「一次为了省 700 万次请求的优化，差点造成订阅类型永久丢失」。
//  这种注释在别处看不到。'''),

    (34, 'before', '''// 【shouldUseClaudeAIAuth：一个函数名+注释里写了两次「别乱用」】
//
//  JSDoc 写着：@private Only call this if you're OAuth / auth related code!
//
//  也就是说这是一个**公开导出的私有函数**：技术上谁都能调，语义上只有
//  认证相关代码该调。这类「约定俗成的可见性」在 TS 里没有强制手段
//  （除非拆包），只能靠命名 + 注释。
//
//  函数本身极简单：scopes 里有没有 inference 那个 scope。
//  但它的判断结果决定了一件大事 —— 登录成功后把浏览器送到
//  Claude.ai 的成功页还是 Console 的成功页（见 auth-code-listener.ts:95）。
//
//  **一个 scope 决定了两套完全不同的产品路径**，这就是为什么它值得一个
//  专门的函数和一整行警告。'''),

    (42, 'before', '''// 【parseScopes：按空格切，滤掉空串】
//
//      scopeString?.split(' ').filter(Boolean) ?? []
//
//  三处防御都必要：
//
//      ?.            参数可能不传（scope 是可选字段）
//      filter(Boolean) 连续空格会切出空串，或者末尾有空格
//      ?? []         没传时返回空数组而不是 undefined，让调用方不用判空
//
//  注意 filter(Boolean) 在这里不会误伤 —— 它只丢空串，而 scope 名不可能
//  是 "0" 或空（那种情况本来也该丢）。这是 filter(Boolean) 少数安全的用法：
//  **当元素类型是「非空字符串」时，它等价于 filter(s => s !== '')。**
//
//  OAuth 的 scope 用空格分隔（不是逗号），这是 RFC 6749 的规定。'''),

    (72, 'before', '''// 【`code=true` 这个参数注释写得很直接】
//
//      authUrl.searchParams.append('code', 'true')
//      // this tells the login page to show Claude Max upsell
//
//  一个布尔参数控制登录页要不要展示「升级到 Max」的推广。
//  这种「URL 参数控制界面」的做法在自家登录页里很常见 ——
//  客户端不需要知道文案，只需要说「这次给我看推广版」。
//
//  注意它是**无条件 append 的**，没有 if 包着。也就是所有登录都会带这个参数。
//  `code` 这个名字本身有点歧义（容易和 authorize code 混），但它和
//  `response_type=code` 是两个不同的参数。'''),

    (81, 'before', '''// 【inferenceOnly 决定要哪些 scope —— 这是一个安全边界】
//
//      正常登录     ALL_OAUTH_SCOPES（全套：推理 + 账号信息 + 组织信息）
//      仅推理模式   [CLAUDE_AI_INFERENCE_SCOPE]（只要推理能力）
//
//  注释：Long-lived inference-only tokens
//
//  「长期有效的仅推理 token」—— 意思是这种 token 可以用来跑模型，
//  但读不到账号信息、改不了设置。**这是最小权限原则的具体落地。**
//
//  为什么要单独支持这个模式？因为 SDK / CI 场景里，token 会被存在
//  各种地方（环境变量、密钥管理），权限越小泄露后损失越小。
//
//  顺带看它是怎么实现的：不是传一个布尔给服务端，而是**请求时就只要那一个
//  scope**。OAuth 的 scope 是在授权请求里确定的，服务端按请求授予，
//  客户端拿到的 token 就只带这些权限。'''),

    (107, 'before', '''// 【exchangeCodeForTokens：注意 redirect_uri 必须和授权时**完全一致**】
//
//  这是 OAuth 里最容易被忽略的一条：换 token 时传的 redirect_uri
//  必须和授权请求里的逐字符相同，否则服务端拒绝。
//
//  所以这里的判断逻辑（useManualRedirect ? MANUAL_REDIRECT_URL :
//  localhost:port/callback）必须和 buildAuthUrl 里第 75 行那段**一模一样**。
//  两处逻辑重复了，但**不能抽成一个函数** —— 因为一旦抽出去，改一处
//  就会同时改两处，而 OAuth 的调试难度在于「两处不一致时错误信息是
//  invalid_grant，完全不提示是 redirect_uri 的问题」。
//
//  这是一类很特殊的重复：**它故意保留是为了让不一致变得显眼。**'''),

    (154, 'before', '''// 【这段注释解释了一个反直觉的事实：refresh 可以「扩权」】
//
//  原文：The backend's refresh-token grant allows scope expansion beyond what
//  the initial authorize granted (see ALLOWED_SCOPE_EXPANSIONS), so this is
//  safe even for tokens issued before scopes were added to the app's
//  registered oauth_scope.
//
//  按 RFC 6749，refresh 请求的 scope **不能超过**原始授权范围（只能缩）。
//  但这里说后端支持「在允许列表内扩权」。
//
//  为什么要这么做？因为老版本客户端当初只申请了部分 scope，
//  后来产品需要更多权限。如果严格按 RFC，这些老用户必须重新登录。
//  服务端开了个口子：refresh 时可以申请 ALLOWED_SCOPE_EXPANSIONS 里的 scope。
//
//  所以这里的默认值是**全量 scope**（CLAUDE_AI_OAUTH_SCOPES），而不是
//  「沿用旧的」。这依赖服务端那个口子，注释里明确写了 see ALLOWED_SCOPE_EXPANSIONS
//  —— **依赖了非标准行为，就必须在代码里写清楚依赖的是哪一条。**'''),

    (187, 'before', '''// 【本文件最有价值的一段注释：一次优化如何差点造成永久性数据丢失】
//
//  优化本身：refresh 之后原本每次都要多打一次 /api/oauth/profile，
//  fleet 规模下是 ~7M 请求/天。所以加了「已经有完整资料就跳过」的判断。
//
//  而那段注释（第 191-199 行）详细描述了差点踩的坑，值得逐句拆：
//
//      场景：CLAUDE_CODE_OAUTH_REFRESH_TOKEN 重新登录路径
//      问题：installOAuthTokens 会在我们返回**之后**执行 performLogout()，
//            把 secure storage 清空
//      后果：如果这里返回 subscriptionType = null，
//            后续 saveOAuthTokensIfNeeded 存下 null ?? (已清空) ?? null = null
//            → 之后每次 refresh 都看到「配置里的守卫字段已满足」→ 继续跳过
//            → **付费用户的订阅类型永久丢失**
//
//  修法：把**已有的值原样传出去**（cached ?? wiped ?? null = cached），
//  这样即使 secure storage 已经被清，写回去的仍是缓存里的值。
//
//  这段注释的教学价值在于它展示了三件事：
//
//  1. 优化必须在「状态之间有时序依赖」的地方格外小心
//  2. 一个「跳过请求」的判断，可能把「读数据」变成「永久丢数据」
//  3. 好的注释会写出**失败的完整因果链**，而不只是「这里有个坑」
//
//  注意 haveProfileAlready 的五个条件（第 202 行）全部是 `!== undefined`
//  而不是真值判断 —— 因为 '' 和 0 都是合法值。'''),

    (344, 'before', '''// 【isOAuthTokenExpired：5 分钟缓冲，和 null 的特殊含义】
//
//      if (expiresAt === null) return false
//      const bufferTime = 5 * 60 * 1000
//      return now + bufferTime >= expiresAt
//
//  两个设计点：
//
//  1. **null 表示「永不过期」**，返回 false。
//     这是给「不带过期时间的 token」留的口子（比如手工配置的长期 token）。
//     注意这里容易写错的方向：如果 null 返回 true，那些 token 会
//     永远被判过期，然后无限刷新。
//
//  2. **提前 5 分钟算过期**，而不是到点才算。
//     因为判过期之后要发起刷新请求，那个请求本身要几百毫秒到几秒。
//     如果卡在最后一秒才判过期，token 可能在刷新请求的路上就失效了 ——
//     结果是「刚刷新完，拿到的还是过期 token」。
//
//  **缓冲时间要覆盖「刷新所需的时间」，这是所有 token 续期逻辑的通用要求。**'''),

    (355, 'before', '''// 【fetchProfileInfo：把组织类型映射成订阅类型】
//
//  一个 switch，四加一个 default：
//
//      claude_max         →  'max'
//      claude_pro         →  'pro'
//      claude_enterprise  →  'enterprise'
//      claude_team        →  'team'
//      default            →  null
//
//  default 返回 null 而不是抛错或返回 'free'：
//  **「不认识的组织类型」和「免费用户」是两件事。** 前者可能是服务端
//  新加了一种套餐而客户端还没更新，返回 null 让上层可以选择「不显示套餐信息」，
//  而返回 'free' 会显示错误的信息。
//
//  注意返回对象的构造分成了两段（第 389 行的必需字段 + 后面几个 if 添加
//  可选字段），而不是一个大字面量。这是为了满足 exactOptionalPropertyTypes
//  之类的严格配置：**可选字段要么不出现，要么有值，不能显式写 undefined。**'''),

    (517, 'before', '''// 【storeOAuthAccountInfo：逐字段比较，全等就不写盘】
//
//  第 549 行的注释：For oauthAccount we need to compare content since it's an object.
//
//  这一句点出了关键：配置系统的「没变化就不写」判断，对原始类型可以直接比，
//  对对象必须逐字段比（或者深比较）。这里选了逐字段 —— 八个条件串联。
//
//  为什么值得这么麻烦？因为 saveGlobalConfig 是**加锁写盘**。
//  oauthAccount 在每次登录/续期时都可能被写一次，而它的内容绝大多数时候
//  是一样的。**用八次 === 换一次加锁写盘，稳赚。**
//
//  注意它 return current（原对象）而不是 return { ...current }。这是
//  「不变」的约定：返回同一个引用，配置系统据此判断「不需要写」。
//  如果返回一个结构相同的**新对象**，就会触发一次无意义的写盘。'''),
]
