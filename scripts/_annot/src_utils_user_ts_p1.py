# -*- coding: utf-8 -*-
slug = 'src_utils_user_ts'
ANNOTATIONS = [
    (1, 'before', '''文件总述：用户核心数据聚合层。同步获取设备、会话、平台等基础信息，异步预取邮箱；为不同分析 provider 与 GrowthBook 提供统一的数据基底。'''),
    (17, 'after', '''两个邮箱缓存变量：cachedEmail（null 表示尚未获取）与 emailFetchPromise（防止并发重复获取）。'''),
    (28, 'after', '''GitHubActionsMetadata 类型：CI 环境下透传的 GitHub Actions 元数据。'''),
    (47, 'after', '''CoreUserData 类型：所有分析 provider 共用的核心用户数据结构，也是 GrowthBook 的格式。'''),
    (61, 'after', '''initUser：启动早期异步预取邮箱，取完清 memoize 缓存以便下次拿到邮箱。'''),
    (72, 'after', '''resetUserCache：登录、登出、切换账号时清掉全部用户缓存。'''),
    (100, 'after', '''只在主动使用 OAuth 鉴权时才带上 OAuth 账户信息（组织与账户 uuid）。'''),
    (128, 'after', '''getCoreUserData：用 memoize 包裹的核心数据构造，可选附带订阅类型、速率档位、首 token 时间以及 CI 元数据。'''),
    (135, 'after', '''getUserForGrowthBook：等价于带分析元数据的核心数据。'''),
    (160, 'after', '''getEmail：同步取邮箱——缓存优先，其次 OAuth 邮箱，ant 用户有 COO_CREATOR 兜底，否则返回 undefined。'''),
    (179, 'after', '''getEmailAsync：异步取邮箱，CI 环境下回退到 git config user.email。'''),
    (194, 'after', '''getGitEmail：用 memoize 封装的 git user.email 子进程调用，整个进程只启动一次。'''),
]
