ANNOTATIONS = [
    (1, 'before', """本文件解析会话恢复标识符：可能是包含会话 ID 的 URL，也可能是裸 UUID，还可能是本地 JSONL 文件路径。"""),
    (4, 'before', """`ParsedSessionUrl` 描述解析结果：会话 ID、入口 URL、是否 URL、JSONL 文件路径、是否 JSONL 文件。"""),
    (20, 'before', """`parseSessionIdentifier` 主解析函数：依次尝试 JSONL 文件路径、裸 UUID、URL 三种形式，全都不匹配返回 `null`。"""),
    (25, 'after', """先判断是否为 JSONL 文件路径：Windows 绝对路径（如 `C:` 盘下的 jsonl 文件）会被 `URL` 解析成以 `C:` 为协议的有效地址，因此必须在 URL 解析之前先处理 JSONL。匹配时随机生成会话 ID 并标记为 JSONL 文件。"""),
    (36, 'after', """接着判断是否为裸 UUID：用 `validateUuid` 校验，匹配时把该 UUID 作为会话 ID，无入口 URL。"""),
    (48, 'after', """最后尝试按 URL 解析：成功时用整条 URL 作为入口地址，并随机生成会话 ID；解析失败则落入末尾返回 `null`。"""),
]
