// 三行代码，但它是「退出应用」的唯一公共入口。
//
// 返回的 exit 就是 App.handleExit（App.tsx:160 塞进 context 的），
// 它会先关 raw mode 再调 onExit。所以组件里主动退出应该用这个，
// 而不是 process.exit() —— 后者会跳过 raw mode 关闭和光标恢复，
// 退出后终端会停在「不回显、光标隐藏」的状态，得敲 reset 才能救回来。
//
// 默认值是空函数（AppContext.ts:14），意味着在 Ink 树外调用它
// 什么也不会发生 —— 又一个静默降级。
import { useContext } from 'react'
import AppContext from '../components/AppContext.js'

/**
 * `useApp` is a React hook, which exposes a method to manually exit the app (unmount).
 */
const useApp = () => useContext(AppContext)
export default useApp
