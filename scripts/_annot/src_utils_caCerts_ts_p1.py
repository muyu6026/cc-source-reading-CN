ANNOTATIONS = [
    (6, 'after', '''文件级说明：为 TLS 连接加载 CA 证书，只认 NODE_EXTRA_CA_CERTS，保持配置无关以便 proxy 与 mtls 不污染命令注册表。'''),
    (50, 'after', '''延迟加载 tls：Bun 会在导入时 eager 物化约 150 个 Mozilla 根证书，故仅在确需自定义 CA 时才 require。'''),
    (84, 'after', '''否则分支：必须附带打包的 Mozilla 根证书作底，因为设置 ca 会替换默认证书库。'''),
    (105, 'after', '''getCACertificates 收尾：按系统 CA 与额外证书文件组合返回，两者皆无则返回 undefined 交给运行时默认。'''),
    (115, 'after', '''clearCACertsCache 收尾：环境变量变更（如信任弹窗套用设置）后清缓存。'''),
]
