import { createContext } from 'react'

export type Props = {
  /**
   * Exit (unmount) the whole Ink app.
   */
  readonly exit: (error?: Error) => void
}

/**
 * `AppContext` is a React context, which exposes a method to manually exit the app (unmount).
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const AppContext = createContext<Props>({
  exit() {},
})
// 默认值是空函数 —— 在 Ink 树外调 exit() 什么也不会发生，**不报错**。
//
// 这个取舍对库来说是对的（组件可以被单独测试），但它掩盖了一个常见
// 错误：在树外（比如模块顶层、或者一个没有被 Provider 包住的组件里）
// 调 useApp().exit，表现是「点了退出没反应」。
//
// 对照 StdinContext 的默认值更糟一点：它默认造了一个真的 EventEmitter，
// 于是 useInput 在树外会**正常注册**监听者，只是永远没人 emit。

// eslint-disable-next-line custom-rules/no-top-level-side-effects
AppContext.displayName = 'InternalAppContext'

export default AppContext
