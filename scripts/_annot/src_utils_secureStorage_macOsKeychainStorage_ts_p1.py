# source: src/utils/secureStorage/macOsKeychainStorage.ts
ANNOTATIONS = [
    (24, 'after', '''security 命令经标准输入读取时受 4096 字节 fgets 缓冲限制；命令超过此长度会被截断成两条，导致写入失败却留下旧值。这里留 64 字节余量防边界差异。'''),
    (50, 'after_block', '''读取失败但之前有缓存值时，继续返回旧值而非缓存 null：因为 macOS 路径每次 API 请求都会清上游 memoize，一次瞬时的 security 失败会把缓存毒化成「未登录」并波及所有子系统，直到下次交互。'''),
    (66, 'after', '''同步读取：先查带 TTL 的内存缓存；未命中则调 security 取密码并解 JSON 写回缓存。'''),
    (96, 'after', '''异步读取变体：用 readInFlight 做在途去重，并发调用只真正跑一次子进程；缓存失效或更新发生在读取期间时，不覆盖更新的条目。'''),
    (111, 'after_block', '''优先走标准输入让安全软件（如 CrowdStrike）只看到 security -i 而非明文载荷；当载荷超过 stdin 缓冲上限时退回 argv，hex 编码虽可被有心人从进程参数读到，但能骗过朴素的明文 grep 规则，远比静默损坏凭据好。'''),
    (158, 'after', '''更新：先清缓存，再把凭据 JSON 转成 hex（避免转义问题）写进去；按载荷长度在 stdin 与 argv 两种方式间选择。'''),
    (176, 'after', '''整个对象满足 SecureStorage 接口契约（读、异步读、更新、删除）。'''),
    (196, 'after', '''真正执行异步读取的子过程：调 security 取密码并解 JSON，失败回退空。'''),
    (231, 'after', '''判断是否 macOS keychain 已锁定：仅 macOS 上检查，退出码 36 表示锁定；结果按进程生命周期缓存，因为渲染层在虚拟滚动重挂载时会反复调用，每次都是约 27 毫秒的同步子进程。'''),
]
