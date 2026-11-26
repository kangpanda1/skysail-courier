// Skysail Courier — entry point for best-flight-game-20261126-0057 (Node 22, standard library only).
//
// Three things happen here, in this order:
//
//   1. game/ and screenshots/ are handed to the scorer's output directory, unchanged.
//   2. The copy that was just handed over is checked against what this bounty demands, so the entry
//      refuses itself rather than shipping a game the judge cannot run: the module graph reachable
//      from index.html is walked and every file on it is scanned for remote references (a reachable
//      file that names a URL is a file the browser would fetch, and this game is meant to load from
//      a dead network), for Math.random (the world is a function of one seed, so the same scene must
//      render the same frame twice), and the screenshots are read back out of their JPEG markers to
//      prove they are 1280x720 renders of this game under the scorer's byte cap. Findings land in
//      out/integrity.json next to the dossier.
//   3. dossier.json is written through the kit's vendored library, which is the form the judge reads.
//
// Serve the game locally with `node serve.ts` and open http://localhost:8080. Outside the grader's
// container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INDEX_HTML,
  buildDossier,
  canonicalJson,
  htmlFacts,
  importMapOf,
  importOrder,
  readGameTree,
  resolveGamePath,
  sourceImports,
} from './vendor/makefun-game.ts';

/** The scorer's own caps (reference/gate.json), passed to both readGameTree and buildDossier. */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

/** What a screenshot of this game has to be: one chromium headless capture, at the bounty's size. */
const FRAME = { width: 1280, height: 720 };
const SHOT_COUNT_MIN = 3;
const SHOT_COUNT_MAX = 4;

/** A remote reference, in any of the forms a browser would actually go out for. */
// Non-global on purpose: a /g regex carries lastIndex between files, and this table is reused.
// A URL is fatal wherever it sits, comment or not: the bounty's own screen is a grep of game/, and a
// URL in a comment is a URL a reader can copy. An API call is fatal in this entry's source and only
// reported in a vendored library, whose unused loaders are the library's, not the game's.
const URL_PATTERNS = [
  { re: /\bhttps?:\/\//i, why: 'an http(s) URL' },
  { re: /\bwss?:\/\//i, why: 'a websocket URL' },
  { re: /\bftp:\/\//i, why: 'an ftp URL' },
];
const NETWORK_APIS = [
  { re: /\bfetch\s*\(/i, why: 'fetch()' },
  { re: /\bXMLHttpRequest\b/i, why: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/i, why: 'WebSocket' },
  { re: /\bEventSource\b/i, why: 'EventSource' },
  { re: /\bsendBeacon\b/i, why: 'navigator.sendBeacon()' },
  { re: /\bimportScripts\s*\(/i, why: 'importScripts()' },
];
const RANDOM_DRAW = /\bMath\s*\.\s*random\s*\(/;

/** The text with its comments lifted out, so a note about Math.random is not a draw from it. */
function withoutComments(text: string): string {
  let out = '';
  let quote = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === '\\') { out += c + (text[i + 1] ?? ''); i += 2; continue; }
      if (c === quote) quote = '';
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const utf8 = new TextDecoder('utf-8');
const fail: string[] = [];
const warn: string[] = [];

function note(list: string[], message: string): void {
  list.push(message);
}

// 1. Hand the entry over ------------------------------------------------------------------------------

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// 2. Check what was handed over -------------------------------------------------------------------
// Everything below reads out/game and out/screenshots, not the repository beside this file, so a
// stale copy in the output directory cannot pass a check the delivered files would fail.

const gameDir = join(out, 'game');
const tree = readGameTree(gameDir, CAPS);
const sourceFiles = tree.files
  .filter((f) => f.cls === 'source' || f.cls === 'vendored')
  .map((f) => ({ path: f.path, bytes: new Uint8Array(readFileSync(join(gameDir, f.path))) }));
const textOf = new Map(sourceFiles.map((f) => [f.path, utf8.decode(f.bytes)]));

// The graph the browser would load: index.html, the modules it reaches, and whatever those name in
// a relative specifier or an HTML attribute. importOrder walks module imports; the loop below adds
// the files a script pulls in by URL-less reference (an <img>, a Worker source, a fetch of a local
// file) until the set stops growing.
const htmlPath = INDEX_HTML;
if (!textOf.has(htmlPath) && !existsSync(join(gameDir, htmlPath))) {
  throw new Error(`out/game/${htmlPath}: the game has no index.html for the browser to open`);
}
const html = htmlFacts(utf8.decode(readFileSync(join(gameDir, htmlPath))));
const map = importMapOf(html).map;
const reachable = new Set<string>([htmlPath, ...importOrder(sourceFiles, html)]);

/** Every relative reference in one file's text: specifiers, then attributes and string literals. */
function referencesOf(path: string): string[] {
  const text = path === htmlPath ? htmlText : textOf.get(path) ?? '';
  const refs: string[] = [];
  if (path === htmlPath) {
    for (const s of html.scripts) if (s.src) refs.push(s.src);
    for (const l of html.links) if (l.href) refs.push(l.href);
    for (const r of html.resources) if (r.src) refs.push(r.src);
    for (const s of html.scripts) if (!s.src && s.text) refs.push(...sourceImports(s.text).map(String));
  } else {
    refs.push(...sourceImports(text).map(String));
  }
  // A texture or a worker named in a string: './tiles.png', "assets/helm.glsl".
  const stringy = /["'`]([./][A-Za-z0-9._\-/]*?)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = stringy.exec(text)) !== null) refs.push(m[1]!);
  return refs;
}
const htmlText = textOf.get(htmlPath) ?? utf8.decode(readFileSync(join(gameDir, htmlPath)));

for (let frontier = [...reachable]; frontier.length > 0; ) {
  const next: string[] = [];
  for (const path of frontier) {
    for (const ref of referencesOf(path)) {
      const target = resolveGamePath(String(ref), path);
      if (target === null) continue;
      const resolved = join(gameDir, target);
      if (!existsSync(resolved)) continue;
      if (!reachable.has(target)) {
        reachable.add(target);
        next.push(target);
      }
    }
  }
  frontier = next;
}

// Remote references, randomness and hashes, file by file.
const files: Array<Record<string, unknown>> = [];
let reachableBytes = 0;
for (const f of tree.files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
  const absolute = join(gameDir, f.path);
  const bytes = readFileSync(absolute);
  const isText = f.cls === 'source' || f.cls === 'vendored';
  const text = isText ? utf8.decode(bytes) : '';
  const onGraph = reachable.has(f.path);
  if (onGraph) reachableBytes += f.bytes;

  const urls: string[] = [];
  const apis: string[] = [];
  if (isText) {
    for (const { re, why } of URL_PATTERNS) if (re.test(text)) urls.push(why);
    const code = withoutComments(text);
    for (const { re, why } of NETWORK_APIS) if (re.test(code)) apis.push(why);
    if (RANDOM_DRAW.test(code)) apis.push('Math.random()');
  }
  const vendored = f.cls === 'vendored';
  if (urls.length > 0) {
    note(onGraph ? fail : warn, `game/${f.path} names the network (${urls.join(', ')})${onGraph ? '' : ' and is not on the load graph'}`);
  }
  if (apis.length > 0) {
    // A vendored library carries loaders nobody in this game calls; the entry's own source has no such excuse.
    note(vendored ? warn : fail, `game/${f.path} calls a network or randomness API (${apis.join(', ')})${vendored ? ' — vendored library, unused by this game\'s code' : ''}`);
  }
  files.push({
    path: f.path,
    class: f.cls,
    bytes: f.bytes,
    on_load_graph: onGraph,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

// Files in game/ that nothing on the load graph names: shipped but never read.
const orphans = tree.files.map((f) => f.path).filter((p) => !reachable.has(p));
for (const p of orphans) note(warn, `game/${p} is not reachable from index.html: it ships but never loads`);

// Screenshots: read the frame size back out of the JPEG, so the claim is the file's, not this script's.
const shotsDir = join(out, 'screenshots');
const shotNames = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((n: string) => /\.(jpe?g|png)$/i.test(n)).sort()
  : [];
const shots: Array<Record<string, unknown>> = [];
if (shotNames.length < SHOT_COUNT_MIN || shotNames.length > SHOT_COUNT_MAX) {
  note(fail, `screenshots/ holds ${shotNames.length} images: this bounty wants ${SHOT_COUNT_MIN} or ${SHOT_COUNT_MAX} renders, the first by name the cover`);
}
for (const name of shotNames) {
  const bytes = new Uint8Array(readFileSync(join(shotsDir, name)));
  const size = name.toLowerCase().endsWith('.png') ? pngSize(bytes) : jpegSize(bytes);
  if (size === null) {
    note(fail, `screenshots/${name}: no frame size readable, so it is not a render this entry can prove`);
    continue;
  }
  if (size.width !== FRAME.width || size.height !== FRAME.height) {
    note(fail, `screenshots/${name} is ${size.width}x${size.height}, not ${FRAME.width}x${FRAME.height}`);
  }
  if (bytes.length > CAPS.screenshots.max_bytes) {
    note(fail, `screenshots/${name} is ${bytes.length} bytes, over the ${CAPS.screenshots.max_bytes} the scorer allows`);
  }
  shots.push({ name, bytes: bytes.length, width: size.width, height: size.height, cover: name === shotNames[0] });
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const block = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    // Start-of-frame markers, less the table (0xc4), the DAC (0xcc) and the RST-free 0xc8.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + block;
  }
  return null;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== sig[i]) return null;
  const be = (o: number): number => ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  // The IHDR chunk sits right after the signature: length, 'IHDR', then width and height.
  if (be(4) !== 13 || String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) !== 'IHDR') return null;
  return { width: be(16), height: be(20) };
}

const integrity = {
  schema: 'skysail/integrity/v1',
  game: {
    files: tree.files.length,
    bytes: tree.totalBytes,
    reachable_files: reachable.size,
    reachable_bytes: reachableBytes,
    orphan_files: orphans,
    load_order: [htmlPath, ...importOrder(sourceFiles, html).filter((p) => p !== htmlPath)],
  },
  screenshots: shots,
  frame: FRAME,
  findings: { fatal: fail, warning: warn },
  files,
};
writeFileSync(join(out, 'integrity.json'), canonicalJson(integrity) + '\n');

if (fail.length > 0) {
  process.stderr.write(`Skysail Courier: the entry refuses itself (${fail.length} fatal finding)\n`);
  for (const line of fail) process.stderr.write(`  - ${line}\n`);
  process.exit(1);
}

// 3. The dossier the judge reads ------------------------------------------------------------------
writeFileSync(join(out, 'dossier.json'), buildDossier(out, CAPS));

process.stdout.write(
  `Skysail Courier: ${tree.files.length} files, ${tree.totalBytes} bytes; ` +
    `${reachable.size} reachable from ${htmlPath}; ${shots.length} screenshots at ${FRAME.width}x${FRAME.height}; ` +
    `${warn.length} warning(s); dossier ${readFileSync(join(out, 'dossier.json')).length} bytes\n`,
);
