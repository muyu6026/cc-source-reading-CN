ANNOTATIONS = [
    (24, 'after',
     "这个文件是「资格判定 + 本地镜像」的拆分产物：缓存状态本身在 syncCacheState.ts（叶子，不 import auth），\n"
     "这里只留 isRemoteManagedSettingsEligible——全子系统唯一需要碰 auth.ts 的函数。\n"
     "拆开的原因见 syncCacheState.ts 文件头：不断环的话 settings.ts 的依赖链会把几百个模块拖进启动期求值的 SCC。"),

    (30, 'after',
     "resetSyncCache 清两份：本文件的 cached 镜像 + 叶子的 sessionCache/eligible。\n"
     "两份不同步就会出现「判定结果还记得、缓存内容已丢」的撕裂状态，所以包一层统一下发。"),

    (49, 'before',
     "isRemoteManagedSettingsEligible 是全子系统的总闸——文件头的 docblock 列了资格规则，\n"
     "并留了一条硬约束：**不许调 getSettings() 或任何会调到它的函数**（设置加载链路里触发循环依赖）。\n"
     "判定结果写进模块级 cached，一次进程只算一遍。"),

    (55, 'after',
     "第一道早退：3p provider 用户（Bedrock/Vertex/自定义网关）不配 hit 这个端点——\n"
     "设置端点是一方服务，别的 provider 用户打过去只会 401。"),

    (60, 'after',
     "第二道：自定义 base URL 同样挡掉。理由同上——endpoint 拼在一方 BASE_API_URL 后面，\n"
     "用户换过 base URL 就说明人不在一方环境里。"),

    (68, 'after',
     "第三道：CLAUDE_CODE_ENTRYPOINT === 'local-agent'（Cowork，跑在有自己的权限模型的 VM 里）。\n"
     "服务端托管设置是为 CLI/CCD 设计的，在 Cowork 语义不匹配；且 per-surface 设置还不存在。\n"
     "注意注释特意说明：MDM/文件式托管设置**仍然生效**——那些走 settings.ts 的另一条路，\n"
     "需要物理部署，IT 意图不同。这道闸门只拦服务端下发这一路。"),

    (85, 'after',
     "外部注入的 token 放行：CLAUDE_CODE_OAUTH_TOKEN / _FILE_DESCRIPTOR（CCD）、Agent SDK、CI——\n"
     "这些 token 是调用方塞进来的，不带 subscriptionType metadata（构造时就是 null）。\n"
     "token 本身有效，所以让 API 裁决：fetchRemoteManagedSettings 对 204/404 返回 {}，\n"
     "settings.ts 在远程为空时落到 MDM/文件设置。假阳性的成本是一次往返，换来不漏配。"),

    (94, 'after',
     "标准 OAuth 路径：有 accessToken、带 inference scope、订阅是 enterprise 或 team 才 eligible。\n"
     "scope 检查是防「有 token 但这个 token 不是干这个的」——CLAUDE_AI_INFERENCE_SCOPE 是推理权限的标记。"),

    (109, 'after',
     "最后试 Console 用户路径：拿到真 API key 就 eligible。同样 skipApiKeyHelper（断环）+ try-catch（CI 抛错）。\n"
     "顺序上 OAuth 先查是性能考虑：多数 Claude.ai 用户 keychain 里没有 API key，\n"
     "而 getAnthropicApiKeyWithSource 会 spawn 一个 security find-generic-password 子进程（约 20-50ms）——\n"
     "先查 OAuth 能让这波人短路掉这个子进程。"),

    (112, 'after',
     "兜底 false，同时把结果写进 cached（和 setEligibility 的 leaf 镜像）。\n"
     "return (cached = setEligibility(x)) 这个惯用法全函数复用：一行同时完成「算一次、存两份」。"),
]
