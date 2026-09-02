// 切比雪夫距离：八方向移动（moveTo）下的等效格距。
// 实现与官方 bots 共享的 cheb 工具逐字同款（bots/ 里以复制粘贴方式共用）。
export function cheb(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
