ANNOTATIONS = [
    (19, 'after', r'''文件级：方向键上下翻历史。HISTORY_CHUNK_SIZE=10 分块读盘——快速连按时不每次都全量读。模块级 pendingLoad 三件套（promise/target/modeFilter）把并发加载请求合并成一次磁盘读。'''),
    (62, 'after', r'''loadHistoryEntries 的合并逻辑：已有一个待中加载且 filter 相同、数量够 → 直接搭车；filter 不同或不够 → 等当前完成再开新的（读历史文件不能中断）。target 向上取整到 chunk 边界避免反复小读。finally 清 pendings——注意 pendingLoad 置 null 在 await 之后，所以并发第二个调用如果在 finally 前到达还能搭上车。'''),
    (103, 'after', r'''三个 current*Ref 每次渲染同步更新——草稿保全必须用最新值，闭包里的 props 是按下那一刻的陈货。'''),
    (113, 'after', r'''updateInput：bash 模式历史条目前面带 !，回显时要剥掉（slice(1)）——prompt 模式原样。pastedContents 跟着条目走（占位符 pill 的状态一起恢复）。'''),
    (182, 'after', r'''onHistoryUp：索引用 historyIndexRef 同步自增（React state 异步，连按读 state 会丢键）。targetIndex===0（第一次上按）时锁定 modeFilter——只有 bash 模式才过滤（prompt 与 bash 历史混在一起翻是特性不是 bug），同时把当前草稿存进 lastShownHistoryEntry（含 mode，供下行时精确还原）。异步段：filter 变了废缓存重来、缓存不够就 loadHistoryEntries 合并加载、越界回滚 ref 保持草稿不动、命中则 updateInput(cursorToStart=true——历史条目光标回行首)。翻过 2 条后弹一次 Ctrl-R 提示。'''),
    (207, 'after', r'''onHistoryDown：>1 继续往前翻；===1 回到草稿——有存过草稿就按存的 mode 还原（filter 状态下清空也要留在那个 mode），没存过（空输入起的步）就清空。返回 currentIndex<=0 告诉调用方「历史翻到头了」——useTextInput 据此把方向键交还给光标移动。'''),
]
