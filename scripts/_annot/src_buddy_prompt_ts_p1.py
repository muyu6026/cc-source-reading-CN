# 数据文件：source/src/buddy/prompt.ts
ANNOTATIONS = [
    (1, 'after', """伙伴（Companion）开场文案与附件构造：提供一段角色说明，并生成一个只在首次为该伙伴出现时插入的 companion_intro 附件。"""),
    (7, 'after', """构造给模型的系统级文案：说明有个小生物坐在输入框旁，用户直呼其名时由它应答，模型要让位。"""),
    (15, 'after', """附件构造入口：未启用 BUDDY 或伙伴被静音则直接返回空。"""),
    (18, 'after', """构建期未启用 BUDDY 直接返回空数组。"""),
    (22, 'after', """遍历已有消息，若该伙伴已介绍过则不再重复插入。"""),
    (29, 'after', """返回包含 name/species 的 companion_intro 附件。"""),
]
