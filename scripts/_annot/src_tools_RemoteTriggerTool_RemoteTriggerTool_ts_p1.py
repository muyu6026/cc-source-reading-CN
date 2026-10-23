ANNOTATIONS = [
    (18, 'after', r'''lazySchema 延后构造；trigger_id 用正则锁死 ^[\w-]+$——路径段字符集，防注入进 URL。'''),
    (44, 'after', r'''TRIGGERS_BETA 是 anthropic-beta 版本戳（ccr-triggers-2026-01-30）——CCR（远程控制）API 走 beta 头协商，不是公开稳定接口。'''),
    (57, 'after', r'''isEnabled 双闸门：GrowthBook 特性 tengu_surreal_dali 且策略允许 allow_remote_sessions——任一门关，工具整个不注册。'''),
    (66, 'after', r'''isReadOnly 二分：list/get 是读，create/update/run 是写——run 会真触发远程 agent，算写。'''),
    (78, 'after', r'''call() 先过鉴权三连：刷新 OAuth token → 取 accessToken（没有就抛 /login）→ 解析组织 UUID。token 全程在进程内，不进 shell、不进 prompt。'''),
    (91, 'after', r'''base URL 拼在 OAuth 配置上（BASE_API_URL/v1/code/triggers），请求头五件套：Bearer token / JSON / anthropic-version / anthropic-beta（版本戳）/ x-organization-uuid。'''),
    (104, 'after', r'''五动作到 REST 的映射表：list=GET 列表、get=GET 单项、create=POST、update=POST（幂等更新语义，不用 PUT）、run=POST /run（空 body）。'''),
    (135, 'after', r'''validateStatus: () => true 是关键——axios 默认 4xx/5xx 抛异常，这里改成一律放行：HTTP 状态本身就是工具的输出（连同响应体原样交给模型解读）。'''),
    (140, 'after', r'''20 秒超时 + abort signal 透传——远程 API 慢或用户打断都能干净退出。'''),
    (145, 'after', r'''输出就是 {status, json} 二元组：状态码 + 序列化响应体，不做任何解释——解释权留给模型。'''),
    (152, 'after', r'''tool_result 格式：HTTP 状态码一行 + JSON 体，与 WebFetch 的结果行风格一致。'''),
]
