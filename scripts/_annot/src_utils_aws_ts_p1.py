# -*- coding: utf-8 -*-
"""src/utils/aws.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''AWS 短期凭证相关的小型工具集：定义凭证与 STS 输出的形状、校验 STS 输出、确认调用者身份，以及清掉凭证提供方缓存。'''),
    (4, 'before', '''`AwsCredentials` 与 `AwsStsOutput` 两个类型描述 STS 返回的短期凭证结构；字段名沿用 AWS 的帕斯卡命名。'''),
    (20, 'before', '''`isAwsCredentialsProviderError` 是类型守卫，判断错误是否来自凭证提供方链路的失败。'''),
    (25, 'before', '''`isValidAwsStsOutput` 校验 `aws sts` 的输出形状：必须是对象且 `Credentials` 内三个字段均为非空字符串。'''),
    (50, 'before', '''`checkStsCallerIdentity` 惰性加载 STS 客户端并发送 `GetCallerIdentity`，取不到调用者身份则抛错。'''),
    (61, 'before', '''`clearAwsIniCache` 通过以忽略缓存方式触发一次 ini 提供方来刷新全局文件缓存，确保 `~/.aws/credentials` 的改动被立即读到；失败仅记调试日志。'''),
]
