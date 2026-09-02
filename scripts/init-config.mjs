// pnpm install 时自动生成 .secret.json（已存在则不动——绝不上碰用户凭据）。
// 零依赖：prepare 钩子不保证依赖已就位，只准用 node: 内置模块。
// 默认形状在 default-secret.json（scripts/deploy.ts 的 token 回填共享同一份）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configFile = join(pkgRoot, ".secret.json");

if (!existsSync(configFile)) {
  const defaults = JSON.parse(
    readFileSync(join(pkgRoot, "scripts", "default-secret.json"), "utf8"),
  );
  // 0600：文件会存永久令牌，不给同机其他用户读
  writeFileSync(configFile, `${JSON.stringify(defaults, null, 2)}\n`, { mode: 0o600 });
  console.log("[63bot] 已生成 .secret.json——编辑它配置网关地址与凭据（字段说明见 README）");
}
