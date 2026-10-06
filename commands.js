// Mỗi lệnh: (ctx, args) → mã thoát. ctx = { sh, vfs, env, stdin, tty, signal, out(s), err(s) }
const P = (c, p) => c.vfs.abs(p, c.sh.cwd);
const rd = (c, p) => (p ? c.vfs.read(P(c, p)) : Promise.resolve(c.stdin));
const ln = s => (s ? s.replace(/\n$/, '').split('\n') : []);
const ol = (c, a) => c.out(a.length ? a.join('\n') + '\n' : '');
const z2 = n => String(n).padStart(2, '0');
const human = n => (n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M');
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const BIN_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|mp[34]|woff2?|ttf|exe|so|apk|jar)$/i;

function opts(args, val = '') { // -abc, -n5, -n 5, -5, -- ; val = các cờ nhận giá trị
  const f = {}, a = [];
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x === '--') { a.push(...args.slice(i + 1)); break; }
    if (/^-[A-Za-z]/.test(x)) {
      for (let j = 1; j < x.length; j++) {
        if (val.includes(x[j])) { f[x[j]] = x.slice(j + 1) || args[++i]; break; }
        f[x[j]] = true;
      }
    } else if (/^-\d+$/.test(x)) f.n = x.slice(1);
    else a.push(x);
  }
  f.r ||= f.R;
  return { f, a };
}

function xfer(c, a, rec, move) {
  const dst = P(c, a.at(-1)), srcs = a.slice(0, -1);
  if (!srcs.length) throw new Error('thiếu đích');
  for (const s of srcs) {
    const k = P(c, s);
    if (c.vfs.need(k).t === 'd' && !rec) throw new Error(`${s}: là thư mục (dùng -r)`);
    const to = c.vfs.isDir(dst) ? c.vfs.abs(k.split('/').pop(), dst) : dst;
    move ? c.vfs.mv(k, to) : c.vfs.cp(k, to);
  }
}

function test(c, a) {
  if (a.at(-1) === ']') a = a.slice(0, -1);
  const neg = a[0] === '!';
  if (neg) a = a.slice(1);
  const g = p => c.vfs.get(P(c, p)), [x, o, y] = a;
  const r = a.length < 2 ? !!x
    : a.length === 2 ? { '-e': () => !!g(o), '-f': () => g(o)?.t === 'f', '-d': () => g(o)?.t === 'd', '-z': () => !o, '-n': () => !!o }[x]?.()
    : { '=': x === y, '==': x === y, '!=': x !== y, '-eq': +x === +y, '-ne': +x !== +y, '-lt': +x < +y, '-gt': +x > +y, '-le': +x <= +y, '-ge': +x >= +y }[o];
  return !!r !== neg ? 0 : 1;
}

const commands = {
  // ── điều hướng & tệp ──
  pwd: c => c.out(c.sh.cwd + '\n'),
  cd(c, [p = '~']) {
    if (p === '-') p = c.env.OLDPWD || c.sh.cwd;
    const d = P(c, p);
    if (!c.vfs.isDir(d)) throw new Error(`${p}: ${c.vfs.get(d) ? 'Not a directory' : 'No such file or directory'}`);
    c.env.OLDPWD = c.sh.cwd; c.sh.cwd = d;
  },
  async ls(c, args) {
    const { f, a } = opts(args);
    for (const p of a.length ? a : ['.']) {
      const d = P(c, p), n = c.vfs.need(d);
      const names = n.t === 'd' ? c.vfs.readdir(d).filter(x => f.a || x[0] !== '.') : [p];
      if (a.length > 1) c.out(`${p}:\n`);
      const rows = names.map(x => {
        const q = n.t === 'd' ? c.vfs.abs(x, d) : d, e = c.vfs.get(q), dir = e.t === 'd', nm = x + (dir && f.F ? '/' : '');
        return f.l ? `${dir ? 'd' : '-'}rw-r--r-- ${String(dir ? 4096 : c.vfs.size(q)).padStart(8)} ${new Date(e.m || 0).toISOString().slice(0, 16).replace('T', ' ')} ${nm}` : nm;
      });
      c.out(rows.join(f.l || f.n === '1' || !c.tty ? '\n' : '  ') + (rows.length ? '\n' : ''));
    }
  },
  async cat(c, args) {
    const { f, a } = opts(args);
    let s = '';
    for (const p of a.length ? a : ['-']) s += p === '-' ? c.stdin : await c.vfs.read(P(c, p));
    c.out(f.n ? ln(s).map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join('\n') + '\n' : s);
  },
  less: (c, a) => commands.cat(c, a),
  more: (c, a) => commands.cat(c, a),
  async head(c, args) { const { f, a } = opts(args, 'n'); ol(c, ln(await rd(c, a[0])).slice(0, +(f.n ?? 10))); },
  async tail(c, args) { const { f, a } = opts(args, 'n'); ol(c, ln(await rd(c, a[0])).slice(-(+(f.n ?? 10)))); },
  async wc(c, args) {
    const { f, a } = opts(args);
    for (const p of a.length ? a : ['']) {
      const s = await rd(c, p), r = [s.split('\n').length - 1, s.split(/\s+/).filter(Boolean).length, s.length];
      c.out((f.l ? r[0] : f.w ? r[1] : f.c ? r[2] : r.join(' ')) + (p ? ' ' + p : '') + '\n');
    }
  },
  mkdir(c, args) { const { f, a } = opts(args); a.forEach(p => c.vfs.mkdir(P(c, p), !!f.p)); },
  rmdir(c, a) { a.forEach(p => { const k = P(c, p); if (c.vfs.readdir(k).length) throw new Error(`${p}: Directory not empty`); c.vfs.rm(k, true); }); },
  async touch(c, a) { for (const p of a) { const k = P(c, p), n = c.vfs.get(k); n ? (n.m = Date.now()) : await c.vfs.write(k, ''); } },
  rm(c, args) { const { f, a } = opts(args); for (const p of a) try { c.vfs.rm(P(c, p), !!f.r); } catch (e) { if (!f.f) throw e; } },
  cp(c, args) { const { f, a } = opts(args); xfer(c, a, f.r, false); },
  mv(c, args) { xfer(c, opts(args).a, true, true); },
  chmod: () => 0,
  chown: () => 0,
  stat(c, a) {
    for (const p of a) {
      const k = P(c, p), n = c.vfs.need(k), dir = n.t === 'd';
      c.out(`  File: ${p}\n  Size: ${dir ? 4096 : c.vfs.size(k)}\n  Type: ${dir ? 'directory' : 'regular file'}\nModify: ${new Date(n.m || 0).toISOString()}\n`);
    }
  },
  du(c, args) {
    const { f, a } = opts(args);
    for (const p of a.length ? a : ['.']) {
      const k = P(c, p); let t = 0;
      for (const [q, n] of c.vfs.n) if (n.t === 'f' && (q === k || q.startsWith(k + '/'))) t += c.vfs.size(q);
      c.out(`${f.h ? human(t) : Math.ceil(t / 1024)}\t${p}\n`);
    }
  },
  async df(c) {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    c.out(`Filesystem  Size  Used  Avail\n/data       ${human(quota)}  ${human(usage)}  ${human(quota - usage)}\n`);
  },
  find(c, args) {
    const a = [...args], root = a[0] && !a[0].startsWith('-') ? a.shift() : '.';
    const g = k => { const i = a.indexOf(k); return i < 0 ? null : a[i + 1]; };
    const nm = g('-name'), re = nm && rx(nm), ty = g('-type'), r = P(c, root), out = [];
    c.vfs.need(r);
    for (const [k, n] of [...c.vfs.n].sort(([x], [y]) => (x < y ? -1 : 1)))
      if ((k === r || k.startsWith(r === '/' ? '/' : r + '/')) && (!ty || n.t === ty) && (!re || re.test(k.split('/').pop())))
        out.push((root === '.' ? '.' : root.replace(/\/$/, '')) + k.slice(r === '/' ? 0 : r.length));
    ol(c, out);
  },
  tree(c, [p = '.']) {
    const k = P(c, p); let dn = 0, fn = 0;
    c.vfs.need(k);
    const w = (d, pre) => {
      const ns = c.vfs.readdir(d).filter(x => x[0] !== '.');
      ns.forEach((n, i) => {
        const q = c.vfs.abs(n, d), last = i === ns.length - 1;
        c.out(`${pre}${last ? '└── ' : '├── '}${n}\n`);
        if (c.vfs.isDir(q)) { dn++; w(q, pre + (last ? '    ' : '│   ')); } else fn++;
      });
    };
    c.out(p + '\n'); w(k, '');
    c.out(`\n${dn} directories, ${fn} files\n`);
  },
  basename(c, [p, sfx]) { let b = p.replace(/\/+$/, '').split('/').pop(); if (sfx && b.endsWith(sfx)) b = b.slice(0, -sfx.length); c.out(b + '\n'); },
  dirname: (c, [p]) => c.out((p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || (p.startsWith('/') ? '/' : '.')) + '\n'),
  realpath: (c, [p = '.']) => c.out(P(c, p) + '\n'),

  // ── văn bản ──
  echo(c, a) {
    let nl = true, esc = false;
    while (/^-[neE]+$/.test(a[0] ?? '')) { const f = a.shift(); if (f.includes('n')) nl = false; if (f.includes('e')) esc = true; }
    const s = a.join(' ');
    c.out((esc ? s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\e/g, '\x1b') : s) + (nl ? '\n' : ''));
  },
  printf(c, [fmt = '', ...a]) {
    let i = 0;
    c.out(fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%[sd%]/g, m => (m === '%%' ? '%' : m === '%d' ? parseInt(a[i++]) || 0 : a[i++] ?? '')));
  },
  async grep(c, args) {
    const { f, a } = opts(args, 'e'), pat = f.e ?? a.shift();
    if (pat == null) throw new Error('thiếu mẫu tìm');
    const re = new RegExp(pat, f.i ? 'i' : ''), cwd = c.sh.cwd, rel = k => (k.startsWith(cwd + '/') ? k.slice(cwd.length + 1) : k);
    const tg = a.length ? a : f.r ? ['.'] : ['-'], multi = a.length > 1 || f.r;
    let hit = 0;
    for (const p of tg) {
      const b = p === '-' ? null : P(c, p);
      const ks = !b ? [null] : f.r ? [...c.vfs.n].filter(([k, n]) => n.t === 'f' && !BIN_EXT.test(k) && (k === b || k.startsWith(b + '/'))).map(([k]) => k).sort() : [b];
      for (const k of ks) {
        let m = 0;
        const nm = multi && k ? rel(k) + ':' : '';
        ln(k ? await c.vfs.read(k) : c.stdin).forEach((l, i) => { if (re.test(l) !== !!f.v) { m++; if (!f.c && !f.l) c.out(`${nm}${f.n ? i + 1 + ':' : ''}${l}\n`); } });
        if (f.c) c.out(`${nm}${m}\n`);
        if (f.l && m) c.out(rel(k) + '\n');
        hit += m;
      }
    }
    return hit ? 0 : 1;
  },
  async sed(c, args) { // s/a/b/[gi] · Nd · /re/d · -i · -e
    const { f, a } = opts(args, 'e'), sc = f.e ?? a.shift(), file = a[0];
    let L = ln(await rd(c, file));
    for (const cmd of sc.split(/;|\n/).map(x => x.trim()).filter(Boolean)) {
      let m;
      if ((m = /^s(.)(.*?)(?<!\\)\1(.*?)(?<!\\)\1([gi]*)$/.exec(cmd))) {
        const re = new RegExp(m[2], m[4]), rp = m[3].replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&');
        L = L.map(l => l.replace(re, rp));
      } else if ((m = /^(?:(\d+)|\/(.*)\/)d$/.exec(cmd))) L = L.filter((l, i) => (m[1] ? i + 1 !== +m[1] : !new RegExp(m[2]).test(l)));
      else throw new Error(`chưa hỗ trợ: ${cmd}`);
    }
    if (f.i && file) await c.vfs.write(P(c, file), L.join('\n') + '\n'); else ol(c, L);
  },
  async awk(c, args) { // chỉ { print $1, $NF } và -F
    const { f, a } = opts(args, 'F'), m = /\{\s*print\s*(.*?)\s*\}/.exec(a[0] ?? '');
    if (!m) throw new Error('chỉ hỗ trợ {print $N,...}');
    const sep = f.F ? new RegExp(f.F) : /\s+/;
    ol(c, ln(await rd(c, a[1])).map(l => {
      const F = [l, ...l.trim().split(sep)];
      return (m[1] || '$0').split(/\s*,\s*/).map(t => t.replace(/\$(NF|\d+)/g, (_, k) => F[k === 'NF' ? F.length - 1 : +k] ?? '')).join(' ');
    }));
  },
  async sort(c, args) {
    const { f, a } = opts(args);
    let l = ln(await rd(c, a[0])).sort(f.n ? (x, y) => parseFloat(x) - parseFloat(y) : undefined);
    if (f.u) l = [...new Set(l)];
    ol(c, f.r ? l.reverse() : l);
  },
  async uniq(c, args) {
    const { f, a } = opts(args), r = [];
    for (const l of ln(await rd(c, a[0]))) r.at(-1)?.[0] === l ? r.at(-1)[1]++ : r.push([l, 1]);
    ol(c, r.map(([l, n]) => (f.c ? `${String(n).padStart(7)} ${l}` : l)));
  },
  async cut(c, args) {
    const { f, a } = opts(args, 'dfc'), d = f.d ?? '\t', idx = String(f.f ?? f.c).split(',').map(x => +x - 1);
    ol(c, ln(await rd(c, a[0])).map(l => (f.c ? idx.map(i => l[i] ?? '').join('') : idx.map(i => l.split(d)[i] ?? '').join(d))));
  },
  tr(c, args) {
    const { f, a } = opts(args);
    const ex = s => s.replace(/\\n/g, '\n').replace(/(.)-(.)/g, (_, x, y) => { let r = ''; for (let i = x.charCodeAt(0); i <= y.charCodeAt(0); i++) r += String.fromCharCode(i); return r; });
    const A = ex(a[0] ?? ''), B = ex(a[1] ?? '');
    c.out([...c.stdin].map(ch => { const i = A.indexOf(ch); return i < 0 ? ch : f.d ? '' : B[Math.min(i, B.length - 1)] ?? ch; }).join(''));
  },
  seq(c, a) {
    const n = a.map(Number), [s, st, e] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n, r = [];
    if (!st) throw new Error('bước = 0');
    for (let i = s; st > 0 ? i <= e : i >= e; i += st) r.push(i);
    ol(c, r);
  },
  async tee(c, args) { const { f, a } = opts(args); for (const p of a) await c.vfs.write(P(c, p), c.stdin, !!f.a); c.out(c.stdin); },
  xargs: (c, a) => c.sh.exec([...(a.length ? a : ['echo']), ...c.stdin.split(/\s+/).filter(Boolean)], c),
  async diff(c, [x, y]) {
    const A = ln(await c.vfs.read(P(c, x))), B = ln(await c.vfs.read(P(c, y))), m = A.length, n = B.length;
    const T = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) T[i][j] = A[i] === B[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
    let i = 0, j = 0, d = 0;
    while (i < m || j < n) {
      if (i < m && j < n && A[i] === B[j]) { i++; j++; }
      else if (j < n && (i === m || T[i][j + 1] >= T[i + 1][j])) { c.out(`+ ${B[j++]}\n`); d = 1; }
      else { c.out(`- ${A[i++]}\n`); d = 1; }
    }
    return d;
  },
  async base64(c, args) {
    const { f, a } = opts(args), s = await rd(c, a[0]);
    c.out(f.d ? new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), ch => ch.charCodeAt(0))) : btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '\n');
  },
  ...Object.fromEntries(['1', '256', '512'].map(b => [`sha${b}sum`, async (c, a) => {
    for (const p of a.length ? a : ['']) c.out(hex(await crypto.subtle.digest(`SHA-${b}`, new TextEncoder().encode(await rd(c, p)))) + '  ' + (p || '-') + '\n');
  }])),
  uuidgen: c => c.out(crypto.randomUUID() + '\n'),

  // ── shell ──
  env: c => c.out(Object.entries(c.env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'),
  export(c, a) { for (const x of a) { const i = x.indexOf('='); if (i > 0) c.env[x.slice(0, i)] = x.slice(i + 1); } },
  unset: (c, a) => a.forEach(k => delete c.env[k]),
  alias(c, a) {
    if (!a.length) return ol(c, Object.entries(c.sh.alias).map(([k, v]) => `alias ${k}='${v}'`));
    for (const x of a) { const i = x.indexOf('='); if (i > 0) c.sh.alias[x.slice(0, i)] = x.slice(i + 1); }
  },
  unalias: (c, a) => a.forEach(k => delete c.sh.alias[k]),
  history: c => ol(c, c.sh.hist.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)),
  type(c, a) {
    let r = 0;
    for (const x of a) {
      const al = c.sh.alias[x];
      if (al) c.out(`${x} is aliased to '${al}'\n`);
      else if (Object.hasOwn(c.sh.cmds, x)) c.out(`${x} is ${c.env.PREFIX}/bin/${x}\n`);
      else { c.err(`bash: type: ${x}: not found\n`); r = 1; }
    }
    return r;
  },
  which: (c, a) => commands.type(c, a),
  command: (c, a) => commands.type(c, a.filter(x => x !== '-v')),
  help: c => c.out(Object.keys(c.sh.cmds).sort().join('  ') + '\n'),
  clear: c => c.out('\x1b[2J\x1b[3J\x1b[H'),
  exit: c => { c.sh.exited = true; },
  shift: (c, [n = 1]) => { c.sh.pos.splice(0, +n); },
  eval: (c, a) => c.sh.run(a.join(' '), c.out),
  break: () => { throw new Jump('break'); },
  continue: () => { throw new Jump('continue'); },
  return: (c, [n]) => { throw new Jump('return', n == null ? c.sh.status : +n | 0); },
  local: (c, a) => commands.export(c, a),
  '[[': (c, a) => test(c, a.at(-1) === ']]' ? [...a.slice(0, -1), ']'] : a),
  true: () => 0,
  false: () => 1,
  ':': () => 0,
  test: (c, a) => test(c, a),
  '[': (c, a) => test(c, a),
  sleep: (c, [s = 1]) => new Promise(ok => { const t = setTimeout(ok, s * 1000); c.signal.addEventListener('abort', () => { clearTimeout(t); ok(130); }); }),
  async source(c, [f, ...a]) { return c.sh.runWith(await c.vfs.read(P(c, f)), a, f, c.out); },
  async sh(c, [a, b, ...r]) { return a === '-c' ? c.sh.runWith(b, r.slice(1), r[0] ?? 'bash', c.out) : c.sh.runWith(await c.vfs.read(P(c, a)), [b, ...r].filter(x => x != null), a, c.out); },
  bash: (c, a) => commands.sh(c, a),
  '.': (c, a) => commands.source(c, a),

  // ── hệ thống ──
  date(c, [fmt]) {
    const d = new Date();
    const m = { Y: d.getFullYear(), m: z2(d.getMonth() + 1), d: z2(d.getDate()), H: z2(d.getHours()), M: z2(d.getMinutes()), S: z2(d.getSeconds()), s: Math.floor(d / 1000) };
    c.out((fmt?.startsWith('+') ? fmt.slice(1).replace(/%([YmdHMSs])/g, (_, k) => m[k]) : d.toString()) + '\n');
  },
  uname: (c, a) => c.out(a.includes('-a') ? 'Linux localhost 5.15.0-termux #1 SMP PREEMPT aarch64 Android\n' : 'Linux\n'),
  whoami: c => c.out(c.env.USER + '\n'),
  id: c => c.out(`uid=10123(${c.env.USER}) gid=10123(${c.env.USER})\n`),
  hostname: c => c.out('localhost\n'),
  uptime: c => c.out(` up ${Math.round(performance.now() / 60000)} min\n`),
  neofetch(c) {
    const nf = [...c.vfs.n.values()].filter(n => n.t === 'f').length;
    c.out(`\x1b[32m${c.env.USER}\x1b[0m@localhost\nOS: Android (Termux-core ảo)\nShell: bash (Workspace X)\nCPU: ${navigator.hardwareConcurrency ?? '?'} lõi\nTệp ảo: ${nf}\nUA: ${navigator.userAgent}\n`);
  },

  // ── mạng & JS ──
  async curl(c, args) { // bị giới hạn CORS của trình duyệt
    const { f, a } = opts(args, 'oXdH');
    const r = await fetch(a[0], { method: f.X || (f.d ? 'POST' : 'GET'), body: f.d, headers: f.H ? Object.fromEntries([f.H.split(/:\s*/)]) : undefined, signal: c.signal });
    if (f.o) await c.vfs.write(P(c, f.o), /text|json|xml|javascript/.test(r.headers.get('content-type') || '') ? await r.text() : await r.blob());
    else { const t = await r.text(); c.out(t + (t.endsWith('\n') ? '' : '\n')); }
    return r.ok ? 0 : 22;
  },
  async wget(c, args) {
    const { f, a } = opts(args, 'O'), r = await fetch(a[0], { signal: c.signal });
    await c.vfs.write(P(c, f.O || a[0].split('?')[0].split('/').pop() || 'index.html'), await r.blob());
    c.err(`'${a[0]}' → ${r.status}\n`);
    return r.ok ? 0 : 8;
  },
  async node(c, args) { // chạy JS ngay trong trang (KHÔNG sandbox): node -e "..." | node file.js
    const { f, a } = opts(args, 'e'), code = f.e ?? (await c.vfs.read(P(c, a[0])));
    const fmt = x => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x));
    const con = { log: (...x) => c.out(x.map(fmt).join(' ') + '\n'), error: (...x) => c.err(x.map(fmt).join(' ') + '\n') };
    const fs = { read: p => c.vfs.read(P(c, p)), write: (p, d) => c.vfs.write(P(c, p), d), ls: p => c.vfs.readdir(P(c, p || '.')) };
    const AF = (async () => {}).constructor;
    await new AF('console', 'fs', 'process', code)(con, fs, { argv: ['node', ...a], env: c.env });
  },
  js: (c, a) => commands.node(c, a),
};
