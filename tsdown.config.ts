// tsdown 构建配置：把 src/main.ts（及其 import 的所有模块）打成自包含
// 单文件 IIFE——这就是上传给网关的「bundle」（沙箱只收单文件 JS）。
//
// verify 插件在每次构建后做三道本地预检（镜像 mmgateway 的部署检查，
// 省掉「上传才发现 lint error + 3s 冷却」的往返）：
//   1. 体积 ≤ 1MB（mmgateway BUNDLE_MAX_BYTES）；
//   2. globalThis.loop 挂载存在（沙箱探测的是全局 loop，见 src/main.ts）；
//   3. 禁用 API 子串扫描（镜像 crates/mmgateway/src/deploy.rs 的
//      「剥离字符串/注释后扫描」口径——以服务端为准，此处只是预检）。
import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

// 与下方 outDir/entryFileNames 联动：CLI 覆盖输出路径时需同步改这里
const BUNDLE_PATH = "dist/bot.js";
const BUNDLE_MAX_BYTES = 1 << 20;

/** 拒绝面：与 deploy.rs lint_bundle 的 reject 表一致（error）。 */
const REJECT_RULES: [needle: string, why: string][] = [
  ["eval(", "eval 被禁用（tech/01 禁用表）"],
  ["new Function", "new Function 被禁用（tech/01 禁用表）"],
  ["WebAssembly", "WebAssembly 被禁用（tech/01 禁用表）"],
  ["Atomics", "Atomics 被禁用（tech/01 禁用表）"],
  ["SharedArrayBuffer", "SharedArrayBuffer 被禁用（tech/01 禁用表）"],
  ["WeakRef", "WeakRef 被禁用（tech/01 禁用表）"],
  ["FinalizationRegistry", "FinalizationRegistry 被禁用（tech/01 禁用表）"],
  ["import(", "动态 import 被禁用（零依赖执行）"],
  ["require(", "require 被禁用（零依赖执行）"],
  ["fetch(", "网络能力不存在于沙箱（tech/01 禁用表）"],
  ["WebSocket", "网络能力不存在于沙箱（tech/01 禁用表）"],
  ["XMLHttpRequest", "网络能力不存在于沙箱（tech/01 禁用表）"],
  ["Deno", "__mm 桥接层与 Deno 命名空间是引擎私有（SDK 白名单之外）"],
  ["__mm", "__mm 桥接层是引擎私有（SDK 白名单之外）"],
  ["postMessage", "Worker/postMessage 被禁用（tech/01 禁用表）"],
  ["Worker(", "Worker 被禁用（tech/01 禁用表）"],
];

/** 警告面：与 deploy.rs 的 warn 表一致（沙箱没这些全局，运行时会抛错）。
 *  Math.random 不在列——2026-09-01 起沙箱将其收编为 Game.random 别名，合法。 */
const WARN_RULES: [needle: string, why: string][] = [
  ["Date.now", "用 Game.time 替代 Date.now（无时间源）"],
  ["performance", "无 performance——CPU 计量是引擎侧的"],
  ["setTimeout", "tick 模型不需要 setTimeout"],
  ["setInterval", "tick 模型不需要 setInterval"],
  ["Promise", "沙箱禁 Promise（无异步）"],
];

/** 把字符串字面量与注释整体替换为空格（保留换行）——与 deploy.rs
 * strip_literals 同款口径：字符串/注释里出现禁用词不算命中。 */
function stripLiterals(code: string): string {
  let out = "";
  let quote: string | null = null;
  let blockComment = false;
  let lineComment = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i] ?? "";
    const next = code[i + 1] ?? "";
    if (lineComment) {
      if (c === "\n") {
        lineComment = false;
        out += c;
      } else {
        out += " ";
      }
    } else if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        out += "  ";
        i++;
      } else if (c === "\n") {
        out += c;
      } else {
        out += " ";
      }
    } else if (quote !== null) {
      if (c === "\\" && next !== "") {
        out += "  ";
        i++;
      } else if (c === quote) {
        quote = null;
        out += " ";
      } else if (c === "\n") {
        out += c; // 未终结的字符串：保守保留换行
      } else {
        out += " ";
      }
    } else if (c === "/" && next === "/") {
      lineComment = true;
      out += "  ";
      i++;
    } else if (c === "/" && next === "*") {
      blockComment = true;
      out += "  ";
      i++;
    } else if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

function verifyBundle(): void {
  const code = readFileSync(BUNDLE_PATH, "utf8");
  const bytes = Buffer.byteLength(code, "utf8");

  const errors: string[] = [];
  if (bytes > BUNDLE_MAX_BYTES) {
    errors.push(`源码超限：${bytes}B > 1MB（tech/01 资源限制）`);
  }
  if (!/globalThis\.loop\s*=/.test(code)) {
    errors.push(
      "未找到 `globalThis.loop = loop` 挂载——沙箱探测的是全局函数 loop()，IIFE 产物缺它则部署后无效果",
    );
  }

  const scanned = stripLiterals(code);
  const warnings: string[] = [];
  for (const [needle, why] of REJECT_RULES) {
    if (scanned.includes(needle)) errors.push(why);
  }
  for (const [needle, why] of WARN_RULES) {
    if (scanned.includes(needle)) warnings.push(why);
  }

  if (errors.length > 0) {
    throw new Error(
      `[verify] ${BUNDLE_PATH} 预检失败：\n${errors.map((e) => `  ✗ ${e}`).join("\n")}`,
    );
  }
  for (const w of warnings) {
    console.warn(`[verify] ⚠ ${w}`);
  }
  console.log(
    `[verify] ${BUNDLE_PATH} ${(bytes / 1024).toFixed(1)}KB · 预检通过（体积 / loop 挂载 / 禁用 API）`,
  );
}

export default defineConfig({
  entry: { bot: "src/main.ts" },
  format: "iife",
  // iife 格式默认产物名是 bot.iife.js——经 rolldown 逃生口固定成 bot.js
  // （deploy 与 verify 都读 dist/bot.js 这个路径）
  outputOptions: {
    entryFileNames: "bot.js",
  },
  platform: "neutral",
  target: "esnext",
  outDir: "dist",
  dts: false,
  // 默认不压缩：1MB 上限对源码极宽裕，可读产物便于按行号对照影子运行的
  // 报错栈。开压缩：MM_MINIFY=1（rolldown 不 mangle 属性名，挂载赋值保留）。
  minify: process.env.MM_MINIFY === "1",
  plugins: [
    {
      name: "verify-bundle",
      closeBundle() {
        verifyBundle();
      },
    },
  ],
});
