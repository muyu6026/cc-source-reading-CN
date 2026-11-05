ANNOTATIONS = [
    (1, 'before', '''文件级批注：`loremIpsum.ts` 提供一个仅供内部（USER_TYPE 为 ant）使用的填充文本技能，用经 API token 计数验证的「单 token 英文词」随机拼装出近似指定 token 数的占位文本，用于长上下文测试。'''),
    (200, 'after', '''`ONE_TOKEN_WORDS`：经过 API token 计数验证的「单 token」英文词表，覆盖代词、动词、名词形容词、介词连词与副词，作为随机拼装的素材池。'''),
    (232, 'after', '''`generateLoremIpsum`：按目标 token 数随机拼装句子（每句 10 到 20 词）与段落（约 20% 概率换行），返回裁剪后的填充文本。'''),
    (257, 'after', '''参数与上限：非法参数提示正整数；超过 50 万 token 则封顶并说明，避免生成过大文本拖垮会话。'''),
    (280, 'after', '''回显：直接把生成的填充文本作为文本消息吐回会话。'''),
    (282, 'after', '''`registerLoremIpsumSkill`：仅在内部环境注册 lorem-ipsum 技能，解析 token 数参数、上限 50 万 token 并生成填充文本回显。'''),
]
