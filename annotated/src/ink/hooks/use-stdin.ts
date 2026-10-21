// 这一行是两层封装的第一层：useContext(StdinContext)。
//
// 这一层给出六个字段（stdin / setRawMode / isRawModeSupported /
// internal_exitOnCtrlC / internal_eventEmitter / internal_querier）。
// 带 internal_ 前缀的三个是**内部约定**，公开文档里没有，但它们
// 恰恰是最常用的：useInput 靠 internal_eventEmitter 注册监听者，
// TerminalQuerier 靠 internal_querier 发查询。
//
// 也就是说：公开 API 的底层依赖了未公开字段。改这三个字段名
// 会连带改掉 useInput / useTabStatus / 所有 MCP 相关组件，
// 而 TypeScript 不会提醒「这是内部字段」。
import { useContext } from 'react'
import StdinContext from '../components/StdinContext.js'

/**
 * `useStdin` is a React hook, which exposes stdin stream.
 */
const useStdin = () => useContext(StdinContext)
export default useStdin
