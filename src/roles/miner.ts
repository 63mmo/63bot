// miner：采运一体——满载送回基地卸货，空载去矿床采集（tech/01「示例」同款逻辑）。
import { cheb } from "../lib/cheb";

/** miner 的单位记忆：spawn 时注入 role，src 由本文件维护。 */
interface MinerMem {
  role: "miner";
  /** 记住的矿床 id——下 tick 用 getObjectById O(1) 再水化，省一次 find 扫描。 */
  src?: string;
}

/** 本模版的 Memory 形状（Memory 本体是 Record<string, unknown>，这里收窄）。 */
interface BotMemory {
  u: Record<string, MinerMem>;
}

function botMemory(): BotMemory {
  if (typeof Memory.u !== "object" || Memory.u === null) Memory.u = {};
  return Memory as unknown as BotMemory;
}

/** 单台 miner 的一 tick 行为。 */
export function tickMiner(u: Unit, base: Base): void {
  const mem = botMemory();
  const m = mem.u[u.id] ?? (mem.u[u.id] = { role: "miner" });
  const carried = u.store.energy ?? 0;

  if (carried >= u.storeCapacity) {
    // 满载：贴基地则卸货，否则走回去（对象目标 → 引擎取 .pos）
    if (cheb(u.pos, base.pos) <= 1) u.transfer(base, RESOURCE_ENERGY, carried);
    else u.moveTo(base);
    return;
  }

  // 空载：优先记忆中的矿（O(1)），没记住才 find 扫视野取第一个
  const src = Game.getObjectById<MineralEntity>(m.src ?? "") ?? u.find(FIND_MINERALS)[0];
  if (!src) return; // 视野内无矿（出生点旁必有，防御式兜底）
  m.src = src.id;
  if (cheb(u.pos, src.pos) <= 1) u.harvest(src);
  else u.moveTo(src);
}
