ANNOTATIONS = [
    (1, 'after', r'''DESCRIPTION 与 getPrompt 同文件导出。'''),
    (3, 'after', r'''agentSwarmsEnabled 是队友模式的开关：开启后提示词多出两段「交给队友做」的引导。'''),
    (8, 'after', r'''teammateContext 只改一句话——插在「复杂任务」那条后面，把任务列表的存在理由从「自我管理」扩展到「跨智能体派单」。'''),
    (14, 'after', r'''teammateTips 两条：description 要写到「另一个智能体不看上下文也能懂」；新任务默认无主，用 TaskUpdate 的 owner 参数认领。'''),
    (55, 'after', r'''整段手册的结构：什么时候用 / 什么时候别用 / 字段说明 / Tips。最后一节「先 TaskList 再建」防重复——模型并行派活时最容易重复建同一个任务。'''),
]
