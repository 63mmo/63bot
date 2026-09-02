// 上传 CLI：把 tsdown 产物 dist/bot.js 上传网关（POST /api/deploy），打印
// 影子运行报告；--activate 连带激活，activate <id> 可回滚历史版本。
//
// 用法（pnpm push = build + 本脚本；pnpm upload 跳过 build——"deploy" 这名字
// 被 pnpm 内置命令占用，故脚本名叫 push）：
//   tsx scripts/deploy.ts                 # 上传 + 影子报告（不激活）
//   tsx scripts/deploy.ts --activate      # 上传并激活，下一 tick 生效
//   tsx scripts/deploy.ts activate <id>   # 激活指定版本（回滚）
//   tsx scripts/deploy.ts versions        # 版本列表
//   tsx scripts/deploy.ts token [label]   # 建永久令牌并回填 .secret.json
//   临时覆盖：--url/--token/--user/--pass（--key 值 或 --key=值）；CI 用 MM_URL/MM_TOKEN/…
//
// 配置优先级：CLI flag > 环境变量（MM_*）> .secret.json > 内置默认。
// .secret.json 由 pnpm install 自动生成（scripts/init-config.mjs），默认
// 形状在 scripts/default-secret.json（两脚本共享）；「←」开头的值是含义
// 占位，视为未设置。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiStatusError, GatewayApi } from "@63mmo/api";
import type { DeployOut } from "@63mmo/api";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(PKG_ROOT, ".secret.json");
const BUNDLE_PATH = join(PKG_ROOT, "dist", "bot.js");
/** 本地开发默认网关（pnpm dev:gateway）；正式服改 .secret.json 的 url。 */
const DEFAULT_URL = "http://127.0.0.1:9165";
const PLACEHOLDER_PREFIX = "←";
/** .secret.json 写入权限：含令牌，不给同机其他用户读。 */
const SECRET_MODE = 0o600;

interface SecretConfig {
  url?: string;
  token?: string;
  user?: string;
  pass?: string;
}

/** 「←」开头的占位值 / 空串视为未设置。 */
function usable(v: string | undefined): v is string {
  return typeof v === "string" && v.length > 0 && !v.startsWith(PLACEHOLDER_PREFIX);
}

/** 默认配置形状（与 init-config.mjs 共享同一份 JSON，防两处漂移）。 */
function defaultSecret(): SecretConfig {
  return JSON.parse(readFileSync(join(PKG_ROOT, "scripts", "default-secret.json"), "utf8"));
}

// —— 参数解析：--key 值 / --key=值 式 flag + 位置子命令（--activate 是纯开关）——
const VALUE_FLAGS = new Set(["url", "token", "user", "pass"]);
const flags: Record<string, string> = {};
const positional: string[] = [];
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--activate") {
      flags.activate = "1";
      continue;
    }
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = a.slice(2, eq >= 0 ? eq : undefined);
    let value = eq >= 0 ? a.slice(eq + 1) : args[++i];
    if (!VALUE_FLAGS.has(key)) {
      console.error(
        `未知 flag「--${key}」——可用：--activate（开关）、${[...VALUE_FLAGS].map((f) => `--${f} <值>`).join("、")}`,
      );
      process.exit(1);
    }
    if (value === undefined || value === "" || value.startsWith("--")) {
      console.error(`--${key} 需要一个值（--${key} <值> 或 --${key}=值）`);
      process.exit(1);
    }
    flags[key] = value;
  }
}
const [command = "", commandArg] = positional;

function readSecret(): SecretConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as SecretConfig;
  } catch {
    console.error(
      `${CONFIG_PATH} 不是合法 JSON——手改坏了吧，修好再试（或删掉让 install 重新生成）`,
    );
    process.exit(1);
  }
}
const secret = readSecret();

function resolveUrl(): string {
  return flags.url || process.env.MM_URL || (usable(secret.url) ? secret.url : DEFAULT_URL);
}
function resolveCred(): { token?: string; user?: string; pass?: string } {
  const token =
    flags.token || process.env.MM_TOKEN || (usable(secret.token) ? secret.token : undefined);
  const user = flags.user || process.env.MM_USER || (usable(secret.user) ? secret.user : undefined);
  const pass = flags.pass || process.env.MM_PASS || (usable(secret.pass) ? secret.pass : undefined);
  return { token, user, pass };
}

/** 建客户端：有永久令牌直接用；否则用账号密码登录换会话令牌。 */
async function connect(url: string): Promise<GatewayApi> {
  const { token, user, pass } = resolveCred();
  const api = new GatewayApi({ baseUrl: url, token });
  if (token) return api;
  if (!user || !pass) {
    console.error(
      [
        "缺少凭据。两种配法（推荐第一种，CI 同款）：",
        "  1. .secret.json 填 user/pass → 跑 `pnpm push token my-laptop` 建永久令牌（自动回填 token 字段），然后删掉 user/pass；",
        `  2. 环境变量 MM_TOKEN（或 MM_USER/MM_PASS）。当前配置文件：${CONFIG_PATH}`,
      ].join("\n"),
    );
    process.exit(1);
  }
  const auth = await api.login(user, pass);
  api.setToken(auth.token);
  return api;
}

function printReport(out: DeployOut): void {
  const r = out.report;
  console.log(
    `影子运行 status=${r.status}  cpu=${(r.cpuUs / 1000).toFixed(2)}ms  l2调用=${r.l2Calls}  memory=${(r.memoryBytes / 1024).toFixed(1)}KB`,
  );
  if (r.errorMessage) console.error(`  错误：${r.errorMessage}`);
  for (const w of r.lint.warnings) console.warn(`  ⚠ lint：${w}`);
  for (const line of r.console) console.log(`  console｜${line}`);
  if (r.callsPreview.length > 0) {
    console.log(`  调用预览（${r.callsPreview.length} 条）：${r.callsPreview.join("，")}`);
  }
}

async function main(): Promise<void> {
  const url = resolveUrl();
  const api = await connect(url);
  // 顺手取 me：打出玩家名防传错号，activeVersion 供 versions 标「生效中」
  const me = await api.me();
  console.log(`网关 ${url}，玩家账号 ${me.name}（${me.status}）`);

  if (command === "token") {
    const label = commandArg ?? "cli";
    const out = await api.createToken(label);
    // 文件不存在时以默认形状为底合并，避免写出只剩 token 的残缺配置
    const base = existsSync(CONFIG_PATH) ? secret : defaultSecret();
    writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...base, token: out.token }, null, 2)}\n`, {
      mode: SECRET_MODE,
    });
    console.log(`永久令牌「${label}」已创建并回填 .secret.json（${out.token.slice(0, 8)}…）`);
    console.log("· .secret.json 里的 user/pass 现在可以删了；");
    console.log("· CI：把整串令牌配成 MM_TOKEN secret，MM_URL 指向正式服；");
    console.log("· 泄露就吊销：网页客户端令牌管理，或 DELETE /api/tokens/{token}。");
    return;
  }

  if (command === "versions") {
    const vs = await api.versions();
    if (vs.length === 0) {
      console.log("还没有任何版本——先跑一次 pnpm push");
      return;
    }
    for (const v of vs) {
      // 「生效中」只认 players.active_version——deployedAt 是粘性的激活时间
      // 戳（切版本不清），回滚场景会多行带值，不能当生效标记
      const active = v.id === me.activeVersion ? "  ← 生效中" : "";
      console.log(
        `  id=${String(v.id).padEnd(4)} ver=${String(v.ver).padEnd(4)} ${(v.bundleBytes / 1024).toFixed(1).padStart(7)}KB  ${v.createdAt}${v.deployedAt ? "（上次激活 " + v.deployedAt + "）" : ""}${active}`,
      );
    }
    console.log("切换/回滚：pnpm upload activate <id>");
    return;
  }

  if (command === "activate") {
    const id = Number(commandArg);
    if (!Number.isInteger(id) || id <= 0) {
      console.error("用法：tsx scripts/deploy.ts activate <版本id>（版本列表看 versions）");
      process.exit(1);
    }
    await api.activate(id);
    console.log(`已激活版本 id=${id}——下一 tick 生效`);
    return;
  }

  if (command !== "") {
    console.error(
      `未知子命令「${command}」——可用：versions / activate <id> / token [label]（或不带子命令直接上传）`,
    );
    process.exit(1);
  }

  if (!existsSync(BUNDLE_PATH)) {
    console.error(`找不到 ${BUNDLE_PATH}——先构建：pnpm build（或直接 pnpm push）`);
    process.exit(1);
  }
  const code = readFileSync(BUNDLE_PATH, "utf8");
  const out = await api.deploy(code);
  console.log(`已上传：版本 id=${out.versionId}（第 ${out.ver} 次部署）`);
  printReport(out);
  if (flags.activate) {
    await api.activate(out.versionId);
    console.log(`已激活版本 ${out.versionId}——下一 tick 生效。回滚：pnpm upload activate <历史id>`);
  } else {
    console.log(
      `影子报告确认无误后激活：pnpm upload activate ${out.versionId}（或下次直接 pnpm push --activate）`,
    );
  }
}

try {
  await main();
} catch (e) {
  if (e instanceof ApiStatusError) {
    if (e.status === 429)
      console.error(`部署冷却中（同一玩家两次部署至少间隔 3s），稍等重试：${e.message}`);
    else if (e.status === 401) console.error(`鉴权失败（令牌无效/已吊销）：${e.message}`);
    else console.error(`网关返回 ${e.status}：${e.message}`);
  } else {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  }
  process.exit(1);
}
