# 63bot —— 63mmo 玩家 bot 工程

本地用 TypeScript 写 bot：类型全量补全（`@63mmo/sdk`）、随便分文件分模块，
`tsdown` 打包成沙箱契约要求的**自包含单文件 IIFE**（`dist/bot.js`），
一条 `pnpm push` 完成 上传 → 影子运行报告 → 激活。
本工程基于官方 `bot-template` 搭建，依赖已发布到 npm，独立于 63mmo 仓库使用——
改 `src/` 就是你的 bot。

前置：Node ≥ 24、pnpm ≥ 10.22；网关在跑（本地开发在 63mmo 仓库 `pnpm dev:gateway`，
正式服见下文 url 配置）；已用网页客户端注册账号并出生选点。

## 快速上手

```bash
# 1. 装依赖——install 会自动生成 .secret.json（已存在则不动）
pnpm install

# 2. 首次引导：网页客户端注册账号并出生后，把账号密码填进 .secret.json 的 user/pass，
#    建一个永久令牌（自动回填 token 字段），然后就可以把 user/pass 两行删掉
pnpm push token my-laptop

# 3. 构建 + 上传 + 激活（下一 tick 生效，客户端观战你的单位开始采集）
pnpm push --activate
```

日常循环：改 `src/` → `pnpm push --activate`（构建含类型检查与本地预检，秒级）。
只想看产物不上传：`pnpm build`；改完自动重打包：`pnpm dev`（watch）。

## 命令表

| 命令 | 作用 |
|---|---|
| `pnpm build` | `tsc --noEmit` 类型检查 + tsdown 打包 + verify 预检（产出 `dist/bot.js`） |
| `pnpm push` | build + 上传，打印影子报告（**不激活**——确认报告后再激活，防手滑） |
| `pnpm push --activate` | build + 上传 + 直接激活 |
| `pnpm upload …` | 跳过 build 直接调 CLI（build 产物没变时省几秒） |
| `pnpm upload activate <id>` | 激活指定版本（**回滚**）；版本列表 `pnpm upload versions` |
| `pnpm upload token [label]` | 建永久命名令牌并回填 `.secret.json` |
| `pnpm dev` | tsdown watch，改代码即重打包 + 预检 |
| `MM_MINIFY=1 pnpm build` | 压缩产物（默认不压缩，便于按行号对照报错栈） |

## `.secret.json` —— 服务器地址与凭据

`pnpm install` 自动生成（`scripts/init-config.mjs`），已 gitignore：

| 字段 | 含义 |
|---|---|
| `url` | 网关基址。默认 `http://127.0.0.1:9165`（本地网关）；打正式服改成官网域名 |
| `token` | 永久命名令牌（`push token` 自动回填）。日常上传全靠它 |
| `user` / `pass` | 账号名/密码，仅首次引导建令牌用，建完可删 |

- 「←」开头的是含义占位，等同未设置；
- 优先级：CLI flag（`--url/--token/--user/--pass`）> 环境变量（`MM_URL/MM_TOKEN/MM_USER/MM_PASS`，CI 用）> `.secret.json` > 内置默认；
- **安全**：`.secret.json` 不入库、别 `git add -f`；令牌泄露到网页客户端（或 `DELETE /api/tokens/{token}`）吊销再建一个；公开分享 bot 代码时确认令牌不在项目目录或 git 历史里；`--pass` 这类 flag 会进 shell 历史与 `ps` 输出——日常优先写 `.secret.json` 或环境变量，flag 只用于一次性场景。

## 为什么 `main.ts` 末尾要 `globalThis.loop = loop`

沙箱的契约是：每 tick 执行你的 bundle 源码，然后探测**全局函数** `loop()` 并调用。
tsdown 的产物是 IIFE——顶层声明的 `loop` 被包在闭包里，`typeof loop` 探测不到；
所以入口必须显式挂到 `globalThis`。删掉这一行，部署会成功、影子报告也正常，
但世界里**没有任何效果**——而且只要闭包里还留着 `function loop` 字样，网关
lint 连警告都不会给（入口检查是对原始源码的 `contains("loop")`）。
`tsdown.config.ts` 的 verify 插件会在本地构建时检查这行赋值存在，防止误删/压缩丢失。

## 本地预检（verify 插件）

每次构建后对 `dist/bot.js` 跑三道检查，把「上传才失败 + 3s 部署冷却」消灭在本地：

1. 体积 ≤ 1MB（服务端硬上限）；
2. `globalThis.loop` 挂载存在（见上节）；
3. 禁用 API 子串扫描——剥离字符串/注释后查禁用词表（镜像网关 `deploy.rs` 口径，
   error 中断构建 / warning 打印提醒）。**以服务端为准**，本地过检 ≠ 服务端必过。

## 禁用 API 速查（沙箱没有这些东西，详见 63mmo 仓库 docs/tech/01）

| 想要 | 替代 |
|---|---|
| `Math.random()` | 直接可用——沙箱里它是 `Game.random()` 的种子随机别名（非真随机，可复现） |
| `Date.now()` / `performance` | `Game.time` |
| `setTimeout` / `setInterval` / `Promise` / `async-await` | 无——tick 模型是纯同步的，`loop()` 返回即本 tick 结束 |
| `eval` / `new Function` / 动态 `import` / `require` | 无（保证静态分析有效） |
| `fetch` / `WebSocket` / 任何网络 | 无——沙箱内无网络能力 |
| 跨 tick 状态 | 写 `Memory`（≤256KB，`loop()` 返回后快照） |
| npm 运行时依赖 | 无——tsdown 只打包你 `src/` 里的代码 |

## CI 集成

```yaml
# 例：GitHub Actions，secrets 配 MM_TOKEN（push token 建的永久令牌）与 MM_URL
- run: pnpm install --frozen-lockfile
- run: pnpm run push --activate
  env:
    MM_TOKEN: ${{ secrets.MM_TOKEN }}
    MM_URL: ${{ secrets.MM_URL }}
```

## 常见错误

| 现象 | 原因与处理 |
|---|---|
| `429 部署冷却中` | 同一玩家两次部署至少间隔 3s，稍等重试 |
| `401 鉴权失败` | 令牌无效/已吊销——重跑 `push token` 换新 |
| 影子报告 `runtimeError` | 报错文本可直接对照**不压缩**的 `dist/bot.js` 定位（沙箱不采集文件名/行号栈） |
| 影子报告 `cpuTimeout` | 超 CPU 预算（8ms + 0.05ms/存活单位，3 倍看门狗硬终止）——减少每 tick 扫描 |
| 部署成功但单位不动 | `globalThis.loop` 挂载被删了（见上节；本地预检应已拦截） |
| lint error：xx 被禁用 | 见禁用表；本地 `pnpm build` 的 verify 预检会先报出来 |

## 目录结构

```
63bot/
├── src/
│   ├── main.ts         # 入口：loop() + globalThis 挂载 + spawn 编排（从这里读起）
│   ├── env.d.ts        # globalThis.loop 的类型声明
│   ├── lib/cheb.ts     # 切比雪夫距离
│   └── roles/miner.ts  # miner 行为 + 类型化 Memory 示例
├── scripts/
│   ├── deploy.ts       # 上传 CLI（本 README 的全部命令）
│   ├── init-config.mjs # install 时生成 .secret.json
│   └── default-secret.json # .secret.json 的默认形状
├── tsdown.config.ts    # 打包配置 + verify 预检插件
└── .secret.json        # 你的配置（gitignored）
```

示例策略与 63mmo 仓库 `docs/tech/01`「示例」一节同款（6 台采运 miner 的最小经济），
进阶（扩张/战术/塔防）看 63mmo 主仓库 `bots/` 目录的官方 bot。

## 依赖说明

`@63mmo/sdk`（纯类型声明，`tsconfig.json` 的 `types` 引入，无运行时代码）与
`@63mmo/api`（仅 `scripts/deploy.ts` 上传用）均来自 npm，都是 devDependencies——
游戏代码零运行时依赖，产物自包含。升级：`pnpm update @63mmo/sdk @63mmo/api`
（API 变更见 63mmo 仓库的 docs/tech/01 与发布说明）。
