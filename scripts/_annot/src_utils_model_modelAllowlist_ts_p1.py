# 数据文件：src/utils/model/modelAllowlist.ts
# 一个源文件 = 一个数据文件；slug = 相对路径把 / . - 换成 _
SOURCE_PATH = 'src/utils/model/modelAllowlist.ts'
ANNOTATIONS = [
    (4, 'after', """文件入口：模型白名单校验，基于 settings 的 availableModels 判定某个模型是否被允许使用。"""),
    (20, 'after', """modelBelongsToFamily：通过名称（含别名解析）判断是否归属于某家族，例如 opus 家族。"""),
    (32, 'after', """prefixMatchesModel：段边界前缀匹配，避免「opusplan」误命中「opus」。"""),
    (57, 'after', """modelMatchesVersionPrefix：支持简写（opus-4-5）与 claude- 前缀两种写法匹配版本。"""),
    (87, 'after', """familyHasSpecificEntries：检测是否有更具体的版本条目收窄家族通配符。"""),
    (108, 'after', """空 allowlist 会阻断所有用户指定的模型。"""),
    (125, 'after', """直接精确匹配分支：若家族别名已被具体条目收窄，则不在此命中。"""),
    (138, 'after', """家族别名通配分支，仅当该家族无更具体条目时生效。"""),
    (147, 'after', """非家族别名做双向解析：先模型到列表，再列表到模型。"""),
    (167, 'after', """版本前缀匹配分支，要求段边界对齐。"""),
    (170, 'after', """isModelAllowed 收尾：三层匹配（精确 / 家族 / 前缀）全失败则返回 false。"""),
]
