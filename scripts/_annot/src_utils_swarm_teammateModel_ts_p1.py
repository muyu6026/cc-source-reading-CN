# 批注数据：source/src/utils/swarm/teammateModel.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。决定新建队友默认用什么模型：当用户没在 `/config` 里设过 `teammateDefaultModel` 时，回退到硬编码的 Opus 4.6。'''),
    (4, 'after_block', '''这段注释是发布提示：每次上线新模型都要手动更新下面的回退值，且必须区分 provider（Bedrock/Vertex/Foundry 拿到的模型 ID 不同）。'''),
    (10, 'after', '''按当前 provider 取出对应的 Opus 4.6 模型 ID 作为回退值。'''),
]
