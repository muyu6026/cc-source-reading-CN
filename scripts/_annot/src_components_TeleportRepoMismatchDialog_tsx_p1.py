# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'before', 'TeleportRepoMismatchDialog：teleport 目标仓库与当前 checkout 不匹配时，让用户从候选路径里挑正确的本地仓库。三态：候选路径、错误信息、验证中。'),
    (27, 'before', 'handleChange 记忆化依赖四值：cancel 直接退出；否则异步验证所选路径下的仓库是否真的是目标仓库。验证期间换 spinner，期间不可重复选。'),
    (36, 'before', '验证通过即 onSelectPath 交棒；失败则三连处置：从磁盘映射里持久移除该路径（removePathFromRepo）、从候选列表移除、显示错误提示——坏路径自动淘汰，下次不再出现。'),
    (56, 'before', '选项数组：候选路径逐个转成选项（label 用显示路径），末尾追加常量槽里的 Cancel——Cancel 恒在，候选列表为空时它是唯一出口。'),
    (76, 'before', '主体两态：有候选路径时显示错误信息（上一轮验证失败的残留提示）加选择器；没有候选时给出指路文案——让用户在目标仓库的 checkout 里重新运行 claude 加 teleport 参数。'),
    (98, 'before', '_temp 把路径转成选项：label 内嵌加粗的显示路径，value 保留原始路径——展示与语义分离。'),
]
