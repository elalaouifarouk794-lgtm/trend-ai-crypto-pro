// Installs the pinned DEX dependency graph from registry.npmjs.org, verifies
// every tarball against the registry's own sha512 integrity, then bundles ONE
// deduplicated ESM file with esbuild.
//
//   node tools/install-vendor.mjs
//
// Why this exists instead of `npm install`: the trading UI must not fetch swap
// code from a CDN at runtime, and the SDK type-checks `token instanceof Token`,
// so sdk-core has to be a single module instance shared by the app, v2-sdk and
// v3-sdk. One bundle from one install of the official packages guarantees that.
//
// Output: vendor/dex-sdk.mjs (committed) + vendor/manifest.json (versions,
// sha512 per package, sha256 of the bundle). node_modules stays gitignored.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REGISTRY = "https://registry.npmjs.org";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.VENDOR_ROOT || join(HERE, "..");
const MODULES = join(ROOT, "node_modules");
const OUT = join(ROOT, "vendor", "dex-sdk.mjs");
const ENTRY = join(ROOT, "tools", "dex-entry.mjs");

// Pinned directly. Everything else is resolved from these manifests.
const ROOT_PACKAGES = {
  ethers: "6.17.0",
  "@uniswap/sdk-core": "7.20.0",
  "@uniswap/v3-sdk": "3.31.8",
  "@uniswap/v2-sdk": "4.21.8",
};

// Node-only or replaced by a browser stub; esbuild must never see them.
const SKIP = new Set(["@types/node", "ws"]);
const ALIASES = { ws: join(ROOT, "tools", "ws-stub.mjs") };

// Packages whose npm payload is Solidity source or build tooling. Nothing in
// the SDK's JS imports them (@uniswap/v3-sdk reads ABI JSON out of the
// */artifacts trees of v3-periphery, swap-router-contracts and v3-staker, which
// ARE installed), so they only add download weight and unsatisfiable ranges.
const CONTRACTS_ONLY = new Set([
  "@openzeppelin/contracts",
  "@uniswap/lib",
  "@uniswap/v2-core",
  "@uniswap/v3-core",
  "base64-sol",
  "dotenv",
  "hardhat-watcher",
]);

/* ----------------------------- semver (minimal) ---------------------------- */
// Enough to pick a version for the ranges these packages actually use.
const parse = (v) => v.split("-")[0].split(".").map(Number);
const cmp = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return a.includes("-") ? -1 : b.includes("-") ? 1 : 0;
};

function satisfies(version, range) {
  const r = range.trim();
  if (r === "*" || r === "latest") return true;
  const exact = /^(\d+)\.(\d+)\.(\d+)(-\S+)?$/.exec(r);
  if (exact) return version === r;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)/.exec(r);
  if (caret) {
    const [M, m] = [Number(caret[1]), Number(caret[2])];
    if (M === 0 && m === 0) return cmp(version, r.slice(1)) >= 0 && parse(version)[0] === 0 && parse(version)[1] === 0;
    if (M === 0) return cmp(version, r.slice(1)) >= 0 && parse(version)[0] === 0 && parse(version)[1] === m;
    return cmp(version, r.slice(1)) >= 0 && parse(version)[0] === M;
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)/.exec(r);
  if (tilde) {
    const [M, m] = [Number(tilde[1]), Number(tilde[2])];
    return cmp(version, r.slice(1)) >= 0 && parse(version)[0] === M && parse(version)[1] === m;
  }
  const ge = /^>=(\d+\.\d+\.\d+)/.exec(r);
  if (ge) return cmp(version, ge[1]) >= 0;
  const rangePart = r.split(" ")[0];
  return satisfies(version, rangePart);
}

async function pickVersion(name, range, meta) {
  // Ranges that name a prerelease (ethers pins aes-js 4.0.0-beta.5) must be
  // allowed to select one, otherwise the graph is silently incomplete.
  const allowPrerelease = range.includes("-");
  const candidates = Object.keys(meta.versions)
    .filter((v) => allowPrerelease || !v.includes("-"))
    .filter((v) => satisfies(v, range))
    .sort(cmp);
  return candidates.at(-1) ?? null;
}

/* ------------------------------- tar reading ------------------------------- */
// npm tarballs are gzipped ustar with GNU long-name entries; that is all this
// needs to understand, because integrity is verified before anything is read.
function untar(buf) {
  const files = new Map();
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const readStr = (start, len) => {
      const s = header.subarray(start, start + len);
      const end = s.indexOf(0);
      return (end === -1 ? s : s.subarray(0, end)).toString("utf8");
    };
    let name = longName ?? readStr(0, 100);
    const prefix = readStr(345, 155);
    if (prefix && !longName) name = posix.join(prefix, name);
    const size = parseInt(readStr(124, 12), 8) || 0;
    const type = String.fromCharCode(header[156]);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    longName = null;
    if (type === "L") { longName = data.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "x" || type === "g") {
      const text = data.toString("utf8");
      const m = / \d*path=([^\n]+)\n/.exec(text);
      if (m) longName = m[1];
      continue;
    }
    if (type === "5") continue;
    if (name) files.set(name.replace(/^package\/?/, ""), data);
  }
  return files;
}

/* ----------------------------- integrity check ---------------------------- */
async function sha512(buf) {
  const digest = await crypto.subtle.digest("SHA-512", buf);
  return Buffer.from(digest).toString("base64");
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------------- install -------------------------------- */
// npm would nest a second copy of a package whenever two requirers ask for
// incompatible versions. Flattening instead (the cheap trick) silently hands
// e.g. elliptic a bn.js from the wrong major, so this installs nested copies
// exactly like npm does and keeps `problems` free of real version compromises.
const metaCache = new Map();
const manifestPkgs = {};
const installed = new Map(); // name -> versions, for reporting
const byNm = new Map(); // absolute node_modules dir -> Map(name -> { version, dir })
const inProgress = new Map(); // package dir -> promise, so a version is traversed once
const tarballs = new Map(); // "name@version" -> verified bytes

async function metadata(name) {
  if (!metaCache.has(name)) {
    const res = await fetch(`${REGISTRY}/${name}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) throw new Error(`metadata ${name}: HTTP ${res.status}`);
    metaCache.set(name, await res.json());
  }
  return metaCache.get(name);
}

function chainFor(requirerDir) {
  const chain = [];
  let dir = requirerDir;
  for (;;) {
    chain.push(join(dir, "node_modules"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

function find(name, range, requirerDir) {
  for (const nm of chainFor(requirerDir)) {
    const hit = byNm.get(nm)?.get(name);
    if (hit && satisfies(hit.version, range)) return hit;
  }
  return null;
}

async function fetchTarball(name, version, entry) {
  const key = `${name}@${version}`;
  if (tarballs.has(key)) return tarballs.get(key);
  const tarball = entry.dist?.tarball;
  const integrity = entry.dist?.integrity || "";
  if (!tarball) throw new Error(`${key}: registry sent no tarball url`);
  const declared = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!declared) throw new Error(`${key}: registry sent no sha512 integrity`);
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if ((await sha512(buf)) !== declared[1]) {
    throw new Error(`${key}: tarball sha512 MISMATCH - refusing to install`);
  }
  tarballs.set(key, { bytes: buf, sha512: declared[1] });
  return tarballs.get(key);
}

async function unpack(name, version, entry, nm) {
  const dir = join(nm, name);
  const { bytes, sha512: sum } = await fetchTarball(name, version, entry);
  for (const [rel, data] of untar(gunzipSync(bytes))) {
    const target = join(dir, rel);
    if (!target.startsWith(dir)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  if (!byNm.has(nm)) byNm.set(nm, new Map());
  byNm.get(nm).set(name, { version, dir });
  const key = `${name}@${version}`;
  (manifestPkgs[name] ||= []).push({ version, sha512: sum, path: dir.slice(ROOT.length + 1).replace(/\\/g, "/") });
  (installed.get(name) ?? installed.set(name, []).get(name)).push(version);
  return { version, dir, entry, key, sum };
}

async function visit(name, range, requirerDir, why, problems) {
  if (SKIP.has(name) || CONTRACTS_ONLY.has(name)) return;
  const existing = find(name, range, requirerDir);
  let pkg = existing && { dir: existing.dir, version: existing.version };
  if (!pkg) {
    const meta = await metadata(name);
    const version = await pickVersion(name, range, meta);
    if (!version) {
      problems.push(`no version of ${name} satisfies "${range}" (required by ${why})`);
      return;
    }
    pkg = { pending: { name, version, entry: meta.versions[version], why } };
  }
  await expand(pkg, name, requirerDir, problems);
}

// `pkg` is either an already-installed location or the {pending} install that
// satisfies this range. The dir decides nesting, so it has to be resolved here.
async function expand(pkg, name, requirerDir, problems) {
  let target = pkg.dir;
  if (!target) {
    const nm = byNm.get(MODULES)?.has(name) ? join(requirerDir, "node_modules") : MODULES;
    target = join(nm, name);
  }
  const running = inProgress.get(target);
  if (running) return running;
  const work = (async () => {
    let current = pkg;
    if (!current.dir) {
      const { version, entry } = current.pending;
      const nm = target.slice(0, target.length - name.length - 1);
      const unpacked = await unpack(name, version, entry, nm);
      current = { dir: unpacked.dir, version: unpacked.version };
    }
    const deps = (await metadata(name)).versions[current.version]?.dependencies || {};
    await Promise.all(Object.entries(deps).map(([dep, range]) => visit(dep, range, current.dir, `${name}@${current.version}`, problems)));
    return current;
  })().catch((err) => {
    problems.push(`${name}: ${String(err.message || err)}`);
    inProgress.delete(target);
  });
  inProgress.set(target, work);
  return work;
}

async function install() {
  await mkdir(MODULES, { recursive: true });
  const problems = [];
  const roots = Object.entries(ROOT_PACKAGES).map(([name, range]) => ({ name, range, why: "root" }));
  await Promise.all(roots.map((r) => visit(r.name, r.range, ROOT, r.why, problems)));
  return { problems };
}

const { problems } = await install();
console.log(`resolved ${installed.size} packages`);
if (problems.length) console.error(`PROBLEMS (${problems.length}):\n` + problems.join("\n"));

/* --------------------------------- bundle --------------------------------- */
const ESBUILD = process.env.ESBUILD_PATH || join(ROOT, "tools", "bin", "esbuild.exe");
if (!existsSync(ESBUILD)) {
  console.error(`esbuild binary not found at ${ESBUILD}\nSet ESBUILD_PATH or install @esbuild/win32-x64.`);
  process.exitCode = 1;
} else {
  const aliasArgs = Object.entries(ALIASES).flatMap(([k, v]) => [`--alias:${k}=${v}`]);
  const args = [
    ENTRY, "--bundle", "--format=esm", "--platform=browser", "--target=es2022",
    "--minify", "--legal-comments=none",
    "--define:process.env.NODE_ENV=\"production\"",
    ...aliasArgs,
    `--outfile=${OUT}`,
  ];
  const run = spawnSync(ESBUILD, args, { cwd: ROOT, encoding: "utf8" });
  const stderr = (run.stderr || "") + (run.stdout || "");
  if (run.status !== 0) {
    console.error("esbuild failed:\n" + stderr.slice(-4000));
    process.exitCode = 1;
  } else {
    const text = await readFile(OUT, "utf8");
    const bundle = {
      generatedBy: "tools/install-vendor.mjs",
      registry: REGISTRY,
      roots: ROOT_PACKAGES,
      packages: manifestPkgs,
      bundle: { file: "vendor/dex-sdk.mjs", bytes: text.length, sha256: await sha256Hex(text) },
      warnings: stderr.split("\n").filter((l) => l.includes("warning") || l.includes("ERROR")).slice(0, 20),
      problems,
    };
    await mkdir(join(ROOT, "vendor"), { recursive: true });
    await writeFile(join(ROOT, "vendor", "manifest.json"), JSON.stringify(bundle, null, 2) + "\n", "utf8");
    console.log(`bundled ${(text.length / 1024).toFixed(0)} KiB -> vendor/dex-sdk.mjs`);
    if (problems.length) console.error("PROBLEMS:\n" + problems.join("\n"));
  }
}

if (problems.length) process.exitCode = 1;
