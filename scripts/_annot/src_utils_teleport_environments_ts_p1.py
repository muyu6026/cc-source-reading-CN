# 批注数据：src/utils/teleport/environments.ts
# slug: src_utils_teleport_environments_ts
ANNOTATIONS = [
    (7, 'after', '''云环境获取与创建：通过 Environment API 拉取可用环境列表，并为没有环境的用户创建默认的 anthropic_cloud 环境。'''),
    (10, 'after', '''EnvironmentKind 与 EnvironmentState：环境种类（云/byoc/桥接）与状态（目前仅 active）。'''),
    (25, 'after', '''EnvironmentListResponse：环境列表响应结构，含环境数组、是否还有更多与分页游标。'''),
    (32, 'after', '''fetchEnvironments 签名：拉取可用环境列表，需 Claude.ai 账号鉴权，否则抛错。'''),
    (70, 'after', '''fetchEnvironments 收尾：带上组织 UUID 与 OAuth 头发起请求，成功返回环境数组，失败记录并抛错。'''),
    (78, 'after', '''createDefaultCloudEnvironment 签名：为当前用户创建一个默认云环境。'''),
    (118, 'after', '''发起创建请求，写入默认语言（python 3.11 / node 20）与网络配置，超时 15 秒。'''),
    (120, 'after', '''createDefaultCloudEnvironment 收尾：返回服务端创建的环境资源。'''),
]
