/* Dùng (chưa nối UI):
   const sh = new Shell({ write: s => term.write(s.replace(/\n/g, '\r\n')), hooks: { toast, exit } });
   sh.vfs.mount(files);            // nạp tệp đã thả vào /sdcard/workspace
   await sh.submit('ls -l | grep js > out.txt');
   sh.prompt() · sh.complete(line) · sh.nav(±1) · sh.ctrlC() · sh.save()/load()
   Hỗ trợ: ' " \ $VAR ${VAR} $? $(cmd) glob | > >> < 2> 2>&1 ; && || alias VAR=x source ./script.sh. if/elif/else · while/until · for..in · hàm · break/continue/return · $((..)) ${V:-d} ${#V} $1 $@ $# · shift · eval · ! · [[ ]] · ~. Chưa có: job nền, case, redirect cho khối. */
const OPS = ['&&', '||', ';', '\n'];
const dict = o => Object.assign(Object.create(null), o);
class Jump { constructor(k, n = 0) { this.k = k; this.n = n; } } // break · continue · return

class Shell {
  vfs = new VFS();
  cmds = { ...commands, ...api };
  alias = dict({ ll: 'ls -l', la: 'ls -a' });
  env = dict({ HOME, PREFIX, PWD: HOME, USER: 'u0_a123', SHELL: PREFIX + '/bin/bash', PATH: PREFIX + '/bin', TERM: 'xterm-256color', LANG: 'vi_VN.UTF-8', TMPDIR: PREFIX + '/tmp' });
  hist = []; hi = 0; status = 0; exited = false; bridge = null; ac = new AbortController(); fns = dict(); pos = []; arg0 = 'bash';

  constructor({ write = () => {}, hooks = {} } = {}) { this.write = write; this.hooks = hooks; }
  get cwd() { return this.env.PWD; }
  set cwd(p) { this.env.PWD = p; }

  prompt() { return (this.bridge?.on ? `[termux] ${this.bridge.cwd.replace(HOME, '~')}` : this.cwd.replace(HOME, '~')) + ' $ '; }
  nav(d) { this.hi = Math.max(0, Math.min(this.hist.length, this.hi + d)); return this.hist[this.hi] || ''; }
  ctrlC() { this.ac.abort(); this.ac = new AbortController(); this.bridge?.kill(); }
  save(k = 'wx-vfs') { try { localStorage.setItem(k, JSON.stringify(this.vfs.toJSON())); localStorage.setItem(k + '-hist', JSON.stringify(this.hist.slice(-200))); } catch {} }
  load(k = 'wx-vfs') { try { const j = JSON.parse(localStorage.getItem(k) || 'null'); if (Array.isArray(j) && j.some(([p]) => p === '/')) this.vfs.load(j); const h = JSON.parse(localStorage.getItem(k + '-hist') || '[]'); if (Array.isArray(h)) { this.hist = h.filter(x => typeof x === 'string'); this.hi = this.hist.length; } } catch {} }

  complete(line) { // gợi ý Tab: lệnh (từ đầu) hoặc đường dẫn
    const w = /(\S*)$/.exec(line)[1];
    if (!/\s/.test(line.trim()) && !line.endsWith(' ')) return [...Object.keys(this.cmds), ...Object.keys(this.alias), ...Object.keys(this.fns)].filter(c => c.startsWith(w)).sort();
    const i = w.lastIndexOf('/'), dir = w.slice(0, i + 1), d = this.vfs.abs(dir || '.', this.cwd);
    return this.vfs.isDir(d) ? this.vfs.readdir(d).filter(n => n.startsWith(w.slice(i + 1))).map(n => dir + n + (this.vfs.isDir(this.vfs.abs(n, d)) ? '/' : '')) : [];
  }

  async submit(line) { // điểm vào cho UI: ghi lịch sử + chạy
    if (this.bridge?.on && this.bridge.busy && !/^\s*bridge\b/.test(line)) { this.bridge.input(line + '\n'); return 0; } // đang có lệnh chạy: dòng gõ = stdin của lệnh
    if (!line.trim()) return 0;
    this.hist.push(line); this.hi = this.hist.length;
    const code = await this.run(line);
    if (this.exited) this.hooks.exit?.();
    return code;
  }

  async run(line, sink = this.write) {
    if (this.bridge?.on && !/^\s*(bridge|clear|exit)\b/.test(line)) return (this.status = await this.bridge.exec(line, { out: sink, err: sink }));
    const sig = this.ac.signal;
    try { await this.exe(this.block(this.split(line)), sink, sig); }
    catch (x) { if (x instanceof Jump) this.status = x.n; else { sink(`bash: ${x.message || x}\n`); this.status = 2; } }
    if (sig.aborted) this.status = 130;
    return this.status;
  }
  async runWith(code, args, a0, out) { // chạy mã với $0 $1…
    const p = this.pos, z = this.arg0; this.pos = args; this.arg0 = a0;
    try { return await this.run(code, out); } finally { this.pos = p; this.arg0 = z; }
  }
  async call(body, args, ctx) { // gọi hàm; return thoát hàm
    const p = this.pos; this.pos = args;
    try { await this.exe(body, ctx.out, this.ac.signal); }
    catch (x) { if (!(x instanceof Jump) || x.k !== 'return') throw x; this.status = x.n; }
    finally { this.pos = p; }
    return this.status;
  }

  block(segs) { // gom các đoạn đã tách thành khối: if · while/until · for · hàm · { }
    let i = 0;
    const kw = s => /^\s*(if|then|elif|else|fi|while|until|do|done|\{|\})(?=\s|$)/.exec(s)?.[1];
    const bad = k => new Error(`lỗi cú pháp gần '${k}'`);
    const eat = k => { // bỏ từ khoá ở đầu đoạn hiện tại → [op, phần còn lại]
      const [s, op] = segs[i], rest = s.replace(new RegExp('^\\s*' + k.replace(/[{}]/g, '\\$&')), '');
      if (rest.trim()) segs[i][0] = rest; else i++;
      return [op, rest];
    };
    const close = k => { const [op, rest] = eat(k); if (rest.trim()) throw bad(rest.trim().split(/\s/)[0]); return op; };
    const list = stop => {
      const out = [];
      for (;;) {
        while (i < segs.length && !segs[i][0].trim()) i++;
        if (i >= segs.length) { if (stop) throw new Error(`lỗi cú pháp: thiếu '${stop.at(-1)}'`); return out; }
        const k = kw(segs[i][0]);
        if (k && stop?.includes(k)) return out;
        out.push(one());
      }
    };
    const one = () => {
      const s = segs[i][0], t = s.trim(); let m;
      if (/^if(\s|$)/.test(t)) {
        const br = []; let els = null; eat('if');
        for (;;) {
          const cond = list(['then']); eat('then');
          br.push([cond, list(['elif', 'else', 'fi'])]);
          const k = kw(segs[i][0]);
          if (k === 'elif') { eat('elif'); continue; }
          if (k === 'else') { eat('else'); els = list(['fi']); }
          break;
        }
        return { if: br, else: els, op: close('fi') };
      }
      if ((m = /^(while|until)(\s|$)/.exec(t))) { eat(m[1]); const cond = list(['do']); eat('do'); const body = list(['done']); return { loop: m[1], cond, body, op: close('done') }; }
      if ((m = /^for\s+([A-Za-z_]\w*)(?:\s+in\b([^]*))?$/.exec(t))) { i++; eat('do'); const body = list(['done']); return { for: m[1], words: m[2] ?? '$@', body, op: close('done') }; }
      if ((m = /^(?:function\s+([\w.-]+)(?:\s*\(\s*\))?|([\w.-]+)\s*\(\s*\))\s*\{(?=\s|$)/.exec(t))) {
        const rest = t.slice(m[0].length); if (rest.trim()) segs[i][0] = rest; else i++;
        const body = list(['}']); return { fn: m[1] || m[2], body, op: close('}') };
      }
      if (/^\{(\s|$)/.test(t)) { eat('{'); const body = list(['}']); return { grp: body, op: close('}') }; }
      const k = kw(s); if (k) throw bad(k);
      return { c: s, op: segs[i++][1] };
    };
    return list(null);
  }

  async exe(list, sink, sig) { // chạy dãy nút với && || ; theo trạng thái $?
    let prev = ';';
    for (const n of list) {
      if (this.exited || sig.aborted) break; // Ctrl+C dừng cả dòng lệnh
      if (prev === ';' || prev === '\n' || (prev === '&&') === !this.status) this.status = await this.node(n, sink, sig);
      prev = n.op;
    }
  }
  async node(n, sink, sig) {
    if (n.c != null) return this.pipeline(n.c, sink);
    if (n.fn) { this.fns[n.fn] = n.body; return 0; }
    if (n.grp) { await this.exe(n.grp, sink, sig); return this.status; }
    if (n.if) {
      for (const [cond, body] of n.if) { await this.exe(cond, sink, sig); if (!this.status) { await this.exe(body, sink, sig); return this.status; } }
      if (n.else) await this.exe(n.else, sink, sig); else this.status = 0;
      return this.status;
    }
    this.status = 0; let rc = 0;
    const items = n.for ? (await this.parse(n.words))[0].argv.flatMap(a => (a.g ? this.vfs.glob(a.s, this.cwd) : [a.s])) : null;
    for (let g = 0; !this.exited && !sig.aborted; g++) {
      if (g % 64 === 63) await new Promise(r => setTimeout(r)); // nhường luồng để bấm ^C được
      if (items) { if (g >= items.length) break; this.env[n.for] = items[g]; }
      else { await this.exe(n.cond, sink, sig); if ((this.status === 0) === (n.loop === 'until')) break; }
      try { await this.exe(n.body, sink, sig); rc = this.status; }
      catch (x) { if (!(x instanceof Jump) || x.k === 'return') throw x; if (x.k === 'break') break; }
    }
    return (this.status = rc);
  }

  split(line) { // tách theo ; && || xuống dòng, bỏ qua trong nháy và $( )
    const out = []; let cur = '', q = '', d = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\' && q !== "'") { cur += c + (line[++i] ?? ''); continue; }
      if (q) { if (c === q) q = ''; cur += c; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' && line[i - 1] === '$') d++;
      else if (c === ')' && d) d--;
      else if (!d) {
        const op = OPS.find(o => line.startsWith(o, i));
        if (op) { out.push([cur, op]); cur = ''; i += op.length - 1; continue; }
        if (c === '#' && (!cur || /\s/.test(cur.at(-1)))) { while (line[i + 1] && line[i + 1] !== '\n') i++; continue; }
      }
      cur += c;
    }
    return [...out, [cur, ';']];
  }

  async pipeline(seg, sink) {
    let stages;
    try { stages = await this.parse(seg); } catch (e) { sink(`bash: ${e.message}\n`); return 2; }
    let input = '', code = 0;
    for (const [i, { argv: raw, r }] of stages.entries()) {
      const argv = raw.flatMap(a => (a.g ? this.vfs.glob(a.s, this.cwd) : [a.s]));
      const toTerm = i === stages.length - 1 && !r['>'] && !r['>>'], o = [], e = [];
      const ctx = {
        sh: this, vfs: this.vfs, env: this.env, stdin: input, tty: toTerm, signal: this.ac.signal,
        out: s => (toTerm ? sink(s) : o.push(s)),
        err: s => (r['2>'] === '&1' ? ctx.out(s) : r['2>'] || r['2>>'] ? e.push(s) : sink(s)),
      };
      try {
        if (r['<']) ctx.stdin = await this.vfs.read(this.vfs.abs(r['<'], this.cwd));
        code = await this.exec(argv, ctx);
        for (const [k, buf] of [['>', o], ['>>', o], ['2>', e], ['2>>', e]]) if (r[k] && r[k] !== '&1') await this.vfs.write(this.vfs.abs(r[k], this.cwd), buf.join(''), k.endsWith('>>'));
      } catch (x) { if (x instanceof Jump) throw x; sink(`${argv[0] ?? 'bash'}: ${x.message || x}\n`); code = 1; }
      input = o.join('');
    }
    return code;
  }

  async exec(argv, ctx) {
    if (this.alias[argv[0]]) argv = [...this.alias[argv[0]].split(/\s+/), ...argv.slice(1)];
    const [name, ...args] = argv;
    if (!name) return 0;
    if (name === '!') return (await this.exec(args, ctx)) ? 0 : 1;
    const as = /^(\w+)=([^]*)$/.exec(name);
    if (as && !args.length) { this.env[as[1]] = as[2]; return 0; }
    if (this.fns[name]) return this.call(this.fns[name], args, ctx);
    if (Object.hasOwn(this.cmds, name)) return (await this.cmds[name](ctx, args)) | 0;
    const p = name.includes('/') && this.vfs.abs(name, this.cwd);
    if (p && this.vfs.get(p)?.t === 'f') return this.runWith(await this.vfs.read(p), args, name, ctx.out);
    ctx.err(`bash: ${name}: command not found\n`);
    return 127;
  }

  async parse(s) { // tách từ + mở rộng biến/$( ) → các tầng pipeline { argv:[{s,g}], r:{redirect} }
    const stages = [{ argv: [], r: {} }], cur = () => stages.at(-1);
    let w = '', has = false, glob = false, pend = null;
    const flush = () => {
      if (!has) return;
      if (pend) { cur().r[pend] = w; pend = null; } else cur().argv.push({ s: w, g: glob });
      w = ''; has = glob = false;
    };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { w += s[++i] ?? ''; has = true; }
      else if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Error('thiếu dấu nháy đóng'); w += s.slice(i + 1, j); i = j; has = true; }
      else if (c === '"') {
        has = true;
        for (i++; i < s.length && s[i] !== '"'; i++) {
          if (s[i] === '\\' && '"$\\`'.includes(s[i + 1] ?? ' ')) w += s[++i];
          else if (s[i] === '$') { const [v, n] = await this.expand(s, i); w += v; i = n; }
          else w += s[i];
        }
      }
      else if (c === '$') {
        const [v, n] = await this.expand(s, i), ps = v.split(/\s+/);
        i = n; w += ps[0]; has ||= ps[0] !== '';
        for (const p of ps.slice(1)) { flush(); w = p; has = p !== ''; }
      }
      else if (/\s/.test(c)) flush();
      else if (c === '|') { flush(); stages.push({ argv: [], r: {} }); }
      else if (c === '>' || c === '<') {
        const fd = has && w === '2';
        if (fd) { w = ''; has = false; } else flush();
        let op = c;
        if (c === '>' && s[i + 1] === '>') { op = '>>'; i++; }
        if (fd && s[i + 1] === '&' && s[i + 2] === '1') { cur().r['2>'] = '&1'; i += 2; continue; }
        pend = (fd ? '2' : '') + op;
      }
      else if (c === '~' && !has && (!s[i + 1] || s[i + 1] === '/' || /\s/.test(s[i + 1]))) { w += this.env.HOME; has = true; }
      else { w += c; has = true; if (c === '*' || c === '?' || (c === '[' && /^\[[^\]\s]+\]/.test(s.slice(i)))) glob = true; }
    }
    flush();
    return stages;
  }

  getv(k) { return k === '?' ? String(this.status) : k === '#' ? String(this.pos.length) : k === '@' || k === '*' ? this.pos.join(' ') : k === '0' ? this.arg0 : /^\d+$/.test(k) ? this.pos[k - 1] ?? '' : this.env[k] ?? ''; }
  calc(e) { // $((…)): số nguyên · + - * / % ** so sánh && || ! ?: ; biến thiếu = 0
    e = e.replace(/\$\{?(\w+)\}?|\b([A-Za-z_]\w*)\b/g, (_, a, b) => String(parseInt(this.getv(a ?? b)) || 0));
    if (!/^[\d\s+\-*/%()<>=!&|^~?:]*$/.test(e)) throw new Error('biểu thức không hợp lệ');
    const v = e.trim() ? Math.trunc(Function(`"use strict";return (${e})`)()) : 0;
    if (!Number.isFinite(v)) throw new Error('chia cho 0');
    return v;
  }
  async expand(s, i) { // $(cmd) · $((expr)) · ${V} ${V:-d} ${#V} · $V $1 $@ $# $? → [giá trị, chỉ số ký tự cuối]
    if (s[i + 1] === '(') {
      let d = 1, j = i + 2;
      for (; j < s.length && d; j++) d += s[j] === '(' ? 1 : s[j] === ')' ? -1 : 0;
      if (s[i + 2] === '(') return [String(this.calc(s.slice(i + 3, j - 2))), j - 1];
      return [await this.capture(s.slice(i + 2, j - 1)), j - 1];
    }
    const m = /^(?:\{([^}]*)\}|(\d|[?#@*]|\w+))/.exec(s.slice(i + 1));
    if (!m) return ['$', i];
    const end = i + m[0].length, g = m[1] ?? m[2];
    const q = /^#(\w+)$/.exec(g), a = /^(\w+):?([-+])([^]*)$/.exec(g);
    if (q) return [String(this.getv(q[1]).length), end];
    if (a) { const v = this.getv(a[1]); return [a[2] === '-' ? v || a[3] : v ? a[3] : '', end]; }
    return [this.getv(g), end];
  }
  async capture(cmd) { const o = []; await this.run(cmd, s => o.push(s)); return o.join('').replace(/\n+$/, ''); }
}
