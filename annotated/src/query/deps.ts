import { randomUUID } from 'crypto'
// query() 的 I/O 依赖注入类型：把 callModel/压缩/uuid 等抽出来，测试可直接塞假实现，省去逐模块 spyOn 的样板。
import { queryModelWithStreaming } from '../services/api/claude.js'
import { autoCompactIfNeeded } from '../services/compact/autoCompact.js'
import { microcompactMessages } from '../services/compact/microCompact.js'

// -- deps

// I/O dependencies for query(). Passing a `deps` override into QueryParams
// lets tests inject fakes directly instead of spyOn-per-module — the most
// common mocks (callModel, autocompact) are each spied in 6-8 test files
// today with module-import-and-spy boilerplate.
//
// Using `typeof fn` keeps signatures in sync with the real implementations
// automatically. This file imports the real functions for both typing and
// the production factory — tests that import this file for typing are
// already importing query.ts (which imports everything), so there's no
// new module-graph cost.
//
// Scope is intentionally narrow (4 deps) to prove the pattern. Followup
// PRs can add runTools, handleStopHooks, logEvent, queue ops, etc.
// 依赖范围刻意收窄到 4 个，用来验证这套注入模式；后续 PR 可再加 runTools/handleStopHooks 等。用 typeof fn 让签名与真实实现自动同步，且不引入新的模块图成本。
export type QueryDeps = {
// 依赖契约类型：用 typeof fn 让签名与真实实现自动同步。
  // -- model
// 模型调用依赖。
  callModel: typeof queryModelWithStreaming

  // -- compaction
  microcompact: typeof microcompactMessages
// 微压缩依赖。
  autocompact: typeof autoCompactIfNeeded

  // -- platform
  uuid: () => string
}

export function productionDeps(): QueryDeps {
// 生产工厂：把真实函数装进对象，作为默认依赖。
  return {
    callModel: queryModelWithStreaming,
    microcompact: microcompactMessages,
    autocompact: autoCompactIfNeeded,
    uuid: randomUUID,
  }
}
