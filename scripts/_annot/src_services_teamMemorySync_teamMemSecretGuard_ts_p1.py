ANNOTATIONS = [
    (1, 'before', '''【模块总览】`teamMemSecretGuard.ts` 是密钥防护的**第一道闸门**，被 `FileWriteTool` /
`FileEditTool` 的 `validateInput` 在写入**之前**调用：阻止模型把密钥写进团队记忆文件
（否则会被同步给仓库所有协作者）。
它和 `secretScanner.ts` 是同一套防护的两层——这里拦「写入」，那里拦「上传」。'''),

    (25, 'after', '''【第 19-25 行】一个巧妙的**惰性 require** 技巧：只有当 `feature('TEAMMEM')` 开启时，
才 `require` 进 `isTeamMemPath` 和 `scanForSecrets`。目的是不让密钥扫描逻辑在「TEAMMEM 关掉」时
无谓地进文件写入的代码路径（写入路径是高频热路径，能不引依赖就不引）。`require` 用 `as typeof import(...)`
做了类型断言，保证即使动态加载也有完整类型。'''),

    (44, 'after', '''【第 15-44 行】`checkTeamMemSecrets` 的逻辑很直白：开了 TEAMMEM 才生效；先 `isTeamMemPath`
判断「这是不是团队记忆目录下的文件」（不是就直接放行）；再 `scanForSecrets` 扫内容；命中就返回
一串**给用户看**的错误信息（列了命中标签、说明团队记忆会共享给所有协作者、要删掉敏感内容重试）。
注意：它只返回「有没有问题 + 哪些类型」，返回的字符串里**没有任何密钥值本身**——
防护的同时也不把密钥泄露到报错信息里。调用方（validateInput）拿到非 null 就拒绝写入。'''),
]
