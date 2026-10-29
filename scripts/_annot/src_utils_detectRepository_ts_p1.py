# 批注数据：src/utils/detectRepository.ts

ANNOTATIONS = [
    (9, 'after', '''ParsedRepository 描述解析出的仓库三元组：主机、所有者、仓库名。'''),
    (15, 'after', '''clearRepositoryCaches 清空按 cwd 缓存的解析结果。'''),
    (25, 'after', '''detectCurrentRepository 收尾：只返回 github.com 的 owner/name，
其它主机交由带 host 的变体处理，避免下游误以为一定是 github。'''),
    (27, 'after', '''detectCurrentRepositoryWithHost 与上面同源但额外返回主机名，
需要针对特定 GitHub 主机拼 URL 的调用方应使用此变体。'''),
    (59, 'after', '''detectCurrentRepositoryWithHost 收尾：按 cwd 缓存解析结果，异常或解析失败都回退为空。'''),
    (61, 'after', '''getCachedRepository 同步返回已缓存的 github.com 仓库 owner/name，未解析或非 github 则返回空。'''),
    (72, 'after', '''getCachedRepository 收尾：从缓存取解析结果并按 host 过滤。'''),
    (74, 'after', '''parseGitRemote 把任意主机的 remote URL 解析为 host、owner、name，支持 SSH 与多种 URL 格式。'''),
    (124, 'after', '''parseGitRemote 收尾：用正则分别匹配 SSH 与 https/ssh/git 协议，过滤掉像 SSH 别名的伪主机。'''),
    (126, 'after', '''parseGitHubRepository 解析 URL 或 owner/repo 字符串，仅返回 github.com 结果，GHE 返回空。'''),
    (161, 'after', '''parseGitHubRepository 收尾：先当完整 URL 解析，失败再按 owner/repo 纯文本兜底。'''),
    (163, 'after', '''looksLikeRealHostname 判断是否像真实域名而非 SSH 别名：
要求含点且末段 TLD 纯字母，从而排除 github.com-work 这类带连字符的别名。'''),
    (178, 'after', '''looksLikeRealHostname 收尾：用末段是否为纯字母 TLD 区分真实域名与 SSH 配置别名。'''),
]
