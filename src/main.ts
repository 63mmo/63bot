// bot 入口：沙箱每 tick 调用一次全局函数 loop()——无参、无返回，函数返回
// 即本 tick 结束。Game/Memory/console 与全部 L0 常量（MOVE/OK/…）由引擎
// 每 tick 注入，@63mmo/sdk 的 ambient 声明给这里全量补全——源码零 import
// 依赖，tsdown 打包后产物是自包含单文件。
//
// 示例策略与 docs/tech/01「示例」一节同款（6 台采运 miner 的最小经济），
// 拆成多文件只为演示 TS 工程的组织方式；进阶玩法看 bots/ 目录的官方 bot。

import { tickMiner } from "./roles/miner";

/** 生产线：[MOVE, WORK, CARRY] = 200E 部件 + 10E 组装 = 210E/台。 */
const SPAWN_BODY = [MOVE, WORK, CARRY];
const SPAWN_COST = 210;
const TARGET_UNITS = 6;

function loop(): void {
  const base = Game.bases[0];
  if (!base) return; // 灭国间隙（重生选点中），无事可做

  // queue 只读可见：在途订单（部件数 × 2 tick）未完工时不再下单，防连续
  // 超编——sdk Base.queue 文档的惯用法
  if (
    Game.units.length < TARGET_UNITS &&
    base.queue.length === 0 &&
    (base.store.energy ?? 0) >= SPAWN_COST
  ) {
    base.spawn(SPAWN_BODY, { role: "miner" });
  }

  for (const u of Game.units) {
    if (u.memory.role !== "miner") continue;
    tickMiner(u, base);
  }
}

// 关键（模版存在的理由之一）：tsdown 产物是 IIFE，上面的 loop 会被包进
// 闭包；而沙箱在执行 bundle 后探测的是 globalThis.loop（typeof loop）——
// 必须显式挂到全局，否则部署成功但世界无任何效果。tsdown.config.ts 的
// verify 插件会在本地构建时检查这行赋值有没有被意外删掉/压缩掉。
globalThis.loop = loop;
