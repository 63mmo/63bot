// 给 globalThis.loop 一个类型——沙箱探测的是全局函数 loop（见 main.ts 末尾
// 的挂载说明），这个声明让「挂载赋值」通过 strict 检查。
declare global {
  var loop: (() => void) | undefined;
}

export {};
