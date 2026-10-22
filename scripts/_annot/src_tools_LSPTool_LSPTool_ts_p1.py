# -*- coding: utf-8 -*-
# LSPTool/LSPTool.ts 批注数据
ANNOTATIONS = [
    (53, 'after', '''10MB 上限：LSP 服务器解析超大文件会拖垮内存，在打开文件之前就拒绝，错误信息里直接带上实际大小。'''),
    (58, 'after', '''双 schema 设计：这里的普通 strictObject 只是工具框架的兼容壳（框架不支持判别联合）；真正的校验在 validateInput 里用 schemas.ts 的判别联合重跑一遍，换取按 operation 分化的精确错误信息。'''),
    (136, 'after', '''shouldDefer 为真：LSP 服务器首次调用可能要等初始化，标记为可延迟让调度器把它排进非紧急批次，避免空转等待卡住主流程。'''),
    (139, 'after', '''isEnabled 跟着 LSP 连接状态走——没配置任何服务器时这个工具从工具列表里整个消失，而不是让模型调用后吃报错。'''),
    (173, 'after', '''与 FileEditTool 同款的安全短路：UNC 路径（双反斜杠或双正斜杠开头的网络共享）跳过一切 fs 操作，防止 stat 触发 SMB NTLM 凭据外泄；这里直接放行，留给 call 阶段处理。'''),
    (233, 'after', '''调用前先等初始化完成——否则 LSP 服务器还在启动时会得到「无可用服务器」的假阴性结果，模型可能据此错误地放弃代码智能查询。'''),
    (278, 'after', '''大多数 LSP 服务器要求先 didOpen 才能查询。文件未打开才读盘（避免无谓 I/O），读完立即 close 句柄；超过 10MB 的文件在这里被拦下。'''),
    (297, 'after', '''sendRequest 返回 undefined 说明该文件类型没有对应的 LSP 服务器——记 debug 日志后返回带扩展名的提示，让模型知道要配置服务器，而不是把空结果当成「没有定义」。'''),
    (334, 'after', '''incoming/outgoing 是两段式：先用 prepareCallHierarchy 拿 CallHierarchyItem，再拿第一个 item 请求真正的调用列表——LSP 协议把这两步拆成两个方法，工具在这里替模型串起来。第二步 undefined 时不报错，交给格式化层优雅处理空值。'''),
    (374, 'after', '''findReferences/goToDefinition/goToImplementation/workspaceSymbol 四种位置结果统一过一道 git check-ignore 过滤——node_modules 这类被忽略目录里的第三方定义与引用不该出现在结果里。'''),
    (601, 'after', '''git check-ignore 按 50 路径一批跑（防命令行超长），5 秒超时。退出码语义：0=至少一个被忽略，1=无忽略，128=不是 git 仓库——非仓库环境静默跳过过滤，不报错。'''),
    (631, 'after', '''LocationLink 与 Location 的判别只看有没有 targetUri 字段；转换时优先 targetSelectionRange（符号实际被选中处），退化到 targetRange。'''),
    (712, 'after', '''LSP 允许 documentSymbol 返回两种格式：层级 DocumentSymbol[]（带 range 和 children）或扁平 SymbolInformation[]（带 location）。用「第一个元素有没有 range 字段」探测——计数随之分叉：层级要递归数 children，扁平直接取 length。'''),
    (860, 'after', '''三个 countUniqueFiles 变体分别处理三种调用层级结构的 URI 位置差异（item.uri / from.uri / to.uri），都先过滤 undefined 再用 Set 去重——同一逻辑三种形状，没有强行抽象。'''),
]
