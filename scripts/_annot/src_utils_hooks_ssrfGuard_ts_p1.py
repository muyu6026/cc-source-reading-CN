ANNOTATIONS = [
    (42, 'before', """isBlockedAddress：SSRF 防护的总入口，按 IP 版本分流到 V4/V6 判定，非合法 IP 字面量则交给真实 DNS 路径。"""),
    (55, 'before', """isBlockedV4：针对 IPv4 的阻断判定，覆盖 0.0.0.0/8、私有段、链路本地、CGNAT 等保留地址。"""),
    (68, 'after', """回环地址 127.0.0.0/8 明确放行，因为本地开发用的策略服务是 HTTP hook 的主要场景。"""),
    (71, 'after', """0.0.0.0/8（本网络）直接阻断，防止访问本机所有接口。"""),
    (88, 'before', """isBlockedV6：针对 IPv6 的阻断判定，并先把 IPv4 映射地址抽取出来复用 V4 规则。"""),
    (133, 'before', """expandIPv6Groups：把缩写或带点分十进制的 IPv6 展开为恰好 8 个十六进制组，便于后续判定。"""),
    (187, 'before', """extractMappedIPv4：从 IPv4 映射型 IPv6 地址中提取内嵌的 IPv4，提取不出则说明不是映射地址。"""),
    (216, 'before', """ssrfGuardedLookup：兼容 axios 的 lookup 配置，先解析再剔除阻断地址，杜绝验证与连接之间的重绑定窗口。"""),
    (245, 'after', """对解析出的每个地址逐一做阻断检查，命中阻断范围立即以错误回调终止。"""),
    (285, 'before', """ssrfError：构造阻断错误，携带 ERR_HTTP_HOOK_BLOCKED_ADDRESS 错误码及被阻断的主机与地址。"""),
]
