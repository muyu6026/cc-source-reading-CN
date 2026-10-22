# -*- coding: utf-8 -*-
# PowerShellTool/modeValidation.ts 批注数据
ANNOTATIONS = [
    (7, 'after', '''acceptEdits 模式的 PowerShell 版：文件系统写 cmdlet 自动放行。判定形态跟随 BashTool 的 modeValidation——两个 shell 工具在权限层刻意保持同构。'''),
    (32, 'after', '''白名单只收四个「简单写」cmdlet（set/add/clear-content、remove-item）；复杂参数绑定的 Tier 3 cmdlet（new-item、copy-item、move-item 等）故意留白落回 ask——它们能过路径校验但参数组合太复杂，宁可多问一次。'''),
    (47, 'after', '''别名经 resolveToCanonical 解析后对等放行：rm 解析成 remove-item 自动允许；mkdir 解析成 new-item 不在集合、落回 ask——别名体系免费继承白名单语义。'''),
    (56, 'after', '''三种链接类型都是重解析点或硬链接——创建之后，后续相对路径写入会解析到链接目标、落在校验器视野之外。'''),
    (69, 'after', '''PowerShell 参数可缩写：-it 是 -ItemType 的最短无歧义前缀（再短会与其他参数撞车），-ty 是 -Type 的（避开 -Target）。'''),
    (117, 'after', '''这个检测要啃掉 PS 的全部语法糖：unicode 横杠前缀（en-dash/em-dash/横线与正斜杠都是参数标记，bug #26）、冒号绑定值、反引号转义（bug #22）、引号包裹（bug #6）——finding #18（符号链接逃逸）的完整修复。'''),
    (146, 'after', '''bypassPermissions 与 dontAsk 在主权限流里处理，这里直接 passthrough 不重复判定。'''),
    (180, 'after', '''七个安全标志任一命中即拒绝自动放行：子表达式、脚本块、成员调用、splatting、赋值、停止解析符、可扩展字符串——acceptEdits 只该放行「纯写文件」这一种形状。'''),
    (190, 'after', '''解析成功但零命令=没东西可查——不自动放行，fail safe。'''),
    (242, 'after', '''两个复合命令守卫：含 cd 类命令加写命令则拒（路径校验用的是过期 cwd，写入落点与校验点不同——TOCTOU；例子：Set-Location ./.claude 后写 ./settings.json 实际落在子目录里）；复合中刚创建符号链接则拒且不要求有写命令（读穿链接外传同样危险，如 Get-Content ./link/etc/shadow）。'''),
    (268, 'after', '''这道守卫承重三个用例：① 管道源头是表达式（字符串字面量管道给 -Path，静态无法知道路径）；② 控制流语句产生的合成元素（foreach 里 Remove-Item $x 的 $x 是循环变量）；③ 非管道语句的重定向覆盖——isReadOnlyCommand 依赖同一个 accident 一起 fail safe，两边谁都不能单独收窄。'''),
    (278, 'after', '''nameType 从剥模块前缀之前的原始名计算——scripts 加反斜杠加 Remove-Item 剥完前缀后名字与 cmdlet 相同，但 PowerShell 实际执行的是那个脚本文件；path-like 名一律要求人工批准。'''),
    (319, 'after', '''逐参数类型白名单（只许 StringConstant 与 Parameter）加冒号绑定表达式元字符检查。典型绕过：Remove-Item $env:PATH 的字面文本在校验期被当相对路径「成功」解析进 cwd，运行时才展开变量——按类型拒才是唯一可靠判断。'''),
    (352, 'after', '''argLeaksValue 在 acceptEdits 关掉同一批缺口：Hashtable 等不可分类参数类型（可夹带重定向）、冒号绑定变量（-Flag:$env:SECRET）。与 readOnlyValidation 共用同一实现。'''),
    (404, 'after', '''全部通过才 allow——这是白名单模式的极端形态：任何看不懂的形状都落回 ask，宁多问不放行。'''),
]
