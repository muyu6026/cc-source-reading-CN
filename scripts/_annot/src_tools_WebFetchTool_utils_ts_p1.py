# -*- coding: utf-8 -*-
"""WebFetchTool/utils.ts 第 1 部分"""

ANNOTATIONS = [
    (20, 'after', '''三个领域级错误类：DomainBlockedError（域在服务端黑名单）、
DomainCheckFailedError（预检本身失败——网络限制或企业策略挡了 claude.ai）、
EgressBlockedError（出网代理 403 拦截）。第三个的 message 是 JSON 字符串，
供上层按结构化错误解析。'''),
    (59, 'after', '''缓存条目：原始字节、HTTP 状态、markdown 正文、contentType，
外加二进制内容落盘后的路径与大小（PDF 等场景）。'''),
    (64, 'after', '''15 分钟 TTL + 50MB 容量上限；LRUCache 自动过期与逐出，
按 contentBytes 计 size（空响应钳到 1，lru-cache 要求正整数）。'''),
    (69, 'after', '''DOMAIN_CHECK_CACHE 与 URL_CACHE 分开的原因：URL 缓存按完整 URL 键控，
同域两个路径会触发两次一模一样的预检 HTTP 往返；这里按主机名缓存。
只缓存 allowed——blocked/failed 下次重查（黑名单可能随时变化）。'''),
    (83, 'after', '''清缓存入口（/clear 等场景调用）。'''),
    (89, 'after', '''turndown 惰性单例：把 turndown + domino 约 1.4MB 的常驻堆推迟到第一次
抓 HTML 才加载；实例跨调用复用（构造要建 15 条规则，.turndown() 本身无状态）。
@types/turndown 只有 export = 声明，Bun 又把 CJS 包进 default——所以有那个 cast。'''),
    (106, 'after', '''URL 长度上限 2000：PSR 最初要求 250 字符防数据外带，但对 JWT 签名的
云服务预签名 URL 太紧；鉴于每个域都要用户批准（主安全边界），放宽到 2000。
注释里保留了这段决策过程（署名 -ab）。'''),
    (112, 'after', '''单次请求 10MB 内容上限（PSR 资源消耗控制要求）——防单个请求压垮系统。'''),
    (116, 'after', '''主抓取 60 秒超时：慢服务器不能把工具挂死。'''),
    (119, 'after', '''域预检 10 秒超时，比主抓取短。'''),
    (125, 'after', '''同域重定向跳数上限 10：没有这条，恶意服务器可以返回重定向环
（/a → /b → /a …），每跳都重置 FETCH_TIMEOUT_MS，工具会一直挂到用户手动中断。
10 与常见客户端默认值对齐（axios=5、follow-redirects=21、Chrome=20）。'''),
    (128, 'after', '''markdown 10 万字符截断：控制喂给次要模型的 token 量。'''),
    (137, 'after', '''预批准 URL 判定：解析后按 host+path 查 preapproved 清单；解析失败按不批准。'''),
    (168, 'after', '''validateURL 三道关：长度 ≤2000、可被 URL 解析、不含 user:password
（防 cookie/内网域之外还有这条口子）、主机名至少两段（挡内网机器名单段名）。
协议不查——http 会在抓取时升级成 https。'''),
    (174, 'after', '''域检查三态：allowed / blocked / check_failed。
check_failed 不等于 blocked——网络不通时不能装作「域被禁」，要如实区分。'''),
    (203, 'after', '''预检实现：打 api.anthropic.com 的 domain_info 接口，can_fetch === true
才放行并缓存；非 200 或异常都归 check_failed（记日志但不吞掉）。'''),
    (211, 'before', '''isPermittedRedirect：允许的重定向只有三类——加/去 www.、
同源改路径或查询串、或两者组合。协议、端口、凭据任何一项变了都不放行。'''),
    (239, 'after', '''stripWww 后比主机名：example.com ↔ www.example.com 互通，其余跨域一律拒绝。'''),
    (243, 'before', '''getWithPermittedRedirects：手动重定向处理——PSR 明确禁止自动跟随重定向
（开放重定向漏洞会让受信域名把用户带去恶意域）。maxRedirects: 0 + 递归跟进。'''),
    (269, 'after', '''depth 超过 MAX_REDIRECTS 直接抛错——重定向环的最终兜底。'''),
    (282, 'after', '''请求参数：arraybuffer 响应、10MB 内容上限、自定义 UA、
Accept 偏好 markdown/html。'''),
    (288, 'after', '''axios 配 maxRedirects:0 时 3xx 会进 catch：解析 Location（相对地址按原 URL
补全），检查器放行则递归跟进，不放行则把 RedirectInfo 返回给调用方
——让模型自己决定要不要重新请求新地址。'''),
    (325, 'after', '''出网代理识别：403 + X-Proxy-Error: blocked-by-allowlist 头
→ 抛 EgressBlockedError（企业环境专有信号）。'''),
    (335, 'after', '''类型守卫：RedirectInfo 与 AxiosResponse 靠 type 字段区分。'''),
    (345, 'after', '''FetchedContent：抓取成功后的统一形状（含可选的二进制落盘信息）。'''),
    (367, 'after', '''缓存命中直接展开返回——注意键是原始 URL（升级/重定向前的）。'''),
    (379, 'after', '''http → https 静默升级。'''),
    (398, 'after', '''域预检：除非设置 skipWebFetchPreflight（企业安全策略连不上 claude.ai 的
客户可跳过），否则先查黑名单——blocked 抛 DomainBlockedError，
check_failed 抛 DomainCheckFailedError。'''),
    (405, 'after', '''仅内部员工（USER_TYPE=ant）上报抓取主机名遥测；
类型断言长名是审计标记：声明该字段不是代码/文件路径。'''),
    (415, 'after', '''DomainBlocked/CheckFailed 是面向用户的预期失败，原样上抛不记内部错误；
其他异常记日志后继续（预检失败不中断主流程，靠后面 getWithPermittedRedirects 抛）。'''),
    (421, 'after', '''正式抓取：升级后的 URL + isPermittedRedirect 检查器。'''),
    (426, 'after', '''拿到的是跨域重定向信息就原样返回——由 WebFetchTool.call 转述给模型。'''),
    (432, 'after', '''主动释放 axios 持有的 ArrayBuffer 引用：rawBuffer 已接管字节，
让 GC 在 Turndown 构建 DOM 树（可达 HTML 的 3-5 倍内存）之前回收最多 10MB。'''),
    (449, 'after', '''二进制内容（PDF 等）落盘存原始字节、按 mime 给扩展名，Claude 之后可直接查文件。
但仍继续走 utf-8 解码 + Haiku 路径——PDF 解码字符串里通常有足够 ASCII 结构
（/Title、文本流）可供摘要；落盘文件是补充而非替代。'''),
    (466, 'after', '''HTML 才走 Turndown 转 markdown；非 HTML 原样用，
解码串的 UTF-8 字节长 ≈ rawBuffer.length（无效字节换 U+FFFD 可忽略），
省掉一次 O(n) 的 Buffer.byteLength 扫描。'''),
    (471, 'after', '''入缓存：注意键是原始 URL 而非升级后或重定向后的——
同一 URL 的重复请求才命中。'''),
    (481, 'after', '''缓存写入（size 按内容字节数，空响应钳 1）。'''),
    (496, 'after', '''超 10 万字符截断并附标记——防次要模型「Prompt is too long」。'''),
    (514, 'after', '''queryHaiku：抓取内容由小快模型按用户 prompt 提炼，
querySource 固定 web_fetch_apply（遥测与重试策略按此分流）。'''),
    (520, 'after', '''模型调用返回后检查 signal.aborted：中断要主动抛 AbortError，
才能让工具调用变成 is_error 块 + UI 红点——否则中断被静默吞掉。'''),
    (529, 'after', '''模型回了但首块不是文本块时给兜底文案「No response from model」。'''),
]
