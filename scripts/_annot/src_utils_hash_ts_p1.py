ANNOTATIONS = [
    (1, 'after', '''文件级：三组哈希工具——djb2（确定性有符号 32 位）、hashContent（Bun 走 Bun.hash，否则 sha256）、hashPair（免拼接的双串哈希）。'''),
    (7, 'before', '''djb2Hash：经典 djb2 字符串哈希，跨运行时确定（不像 Bun.hash 用 wyhash），适合缓存目录名等需落盘稳定的场景。'''),
    (13, 'after', '''djb2Hash 收尾：循环累乘移位得到有符号 32 位整数。'''),
    (19, 'before', '''hashContent：变更检测用；Bun 下 Bun.hash 比 sha256 快约 100 倍且够用（非加密安全），Node 下回退 sha256。'''),
    (34, 'before', '''hashPair：不分配拼接临时串；Bun 端把 hash(a) 当 seed 喂给 hash(b)，Node 端用增量 sha256 并以空字节分隔，种子链式天然区分「ts,code」与「tsc,ode」，所以 Bun 下无需分隔符。'''),
    (46, 'after', '''hashPair 收尾：Bun 走 wyhash 种子链，Node 走增量 sha256，二者都避开拼接临时串。'''),
]
