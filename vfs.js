// Hệ tệp ảo trong bộ nhớ, bố cục như Termux. Nút: { t: 'f' | 'd', d: string | Blob, m: mtime }
const MSG = { ENOENT: 'No such file or directory', EEXIST: 'File exists', EISDIR: 'Is a directory', ENOTDIR: 'Not a directory' };
const E = (code, p) => Object.assign(new Error(`${p}: ${MSG[code]}`), { code });
const dirOf = p => p.slice(0, p.lastIndexOf('/')) || '/';
const HOME = '/data/data/com.termux/files/home', PREFIX = '/data/data/com.termux/files/usr';
const hasGlob = s => /[*?[]/.test(s);
const rx = s => new RegExp('^' + s.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

class VFS {
  n = new Map([['/', { t: 'd' }]]);
  constructor() { [HOME, PREFIX + '/bin', PREFIX + '/tmp', '/sdcard', '/tmp'].forEach(p => this.mkdir(p, true)); }

  abs(p, cwd = '/') {
    if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
    const out = [];
    for (const s of (p.startsWith('/') ? p : cwd + '/' + p).split('/')) s === '..' ? out.pop() : s && s !== '.' && out.push(s);
    return '/' + out.join('/');
  }
  get(p) { return this.n.get(p); }
  isDir(p) { return this.n.get(p)?.t === 'd'; }
  need(p) { const n = this.n.get(p); if (!n) throw E('ENOENT', p); return n; }
  size(p) { const d = this.need(p).d; return d == null ? 0 : d.size ?? new TextEncoder().encode(d).length; }

  readdir(p) {
    if (this.need(p).t !== 'd') throw E('ENOTDIR', p);
    const pre = p === '/' ? '/' : p + '/';
    return [...this.n.keys()].filter(k => k !== p && k.startsWith(pre) && !k.includes('/', pre.length)).map(k => k.slice(pre.length)).sort();
  }
  async read(p) { const n = this.need(p); if (n.t === 'd') throw E('EISDIR', p); return typeof n.d === 'string' ? n.d : n.d.text(); }
  async write(p, data, append = false) {
    const old = this.n.get(p);
    if (!this.isDir(dirOf(p))) throw E('ENOENT', p);
    if (old?.t === 'd') throw E('EISDIR', p);
    this.n.set(p, { t: 'f', m: Date.now(), d: typeof data === 'string' && append && old ? (await this.read(p)) + data : data });
  }
  mkdir(p, rec = false) {
    if (this.n.has(p)) { if (rec && this.isDir(p)) return; throw E('EEXIST', p); }
    if (!this.n.has(dirOf(p))) { if (!rec) throw E('ENOENT', p); this.mkdir(dirOf(p), true); }
    this.n.set(p, { t: 'd', m: Date.now() });
  }
  rm(p, rec = false) {
    if (p === '/') throw new Error('refusing to remove /');
    if (this.need(p).t === 'd' && !rec) throw E('EISDIR', p);
    for (const k of [...this.n.keys()]) if (k === p || k.startsWith(p + '/')) this.n.delete(k);
  }
  cp(a, b) {
    this.need(a);
    if (b === a || b.startsWith(a + '/')) throw new Error('cannot copy/move into itself');
    if (!this.isDir(dirOf(b))) throw E('ENOENT', b);
    for (const [k, v] of [...this.n]) if (k === a || k.startsWith(a + '/')) this.n.set(b + k.slice(a.length), { ...v, m: Date.now() });
  }
  mv(a, b) { this.cp(a, b); this.rm(a, true); }

  // Mở rộng * ? [..] theo từng đoạn đường dẫn; không khớp → trả nguyên mẫu (như bash)
  glob(pat, cwd) {
    if (!hasGlob(pat)) return [pat];
    const abs = pat.startsWith('/');
    let cur = [abs ? '/' : cwd];
    for (const s of pat.split('/').filter(Boolean)) {
      const next = [];
      for (const b of cur) {
        if (!hasGlob(s)) { const p = this.abs(s, b); if (this.n.has(p)) next.push(p); continue; }
        if (!this.isDir(b)) continue;
        const re = rx(s);
        for (const n of this.readdir(b)) if ((n[0] !== '.' || s[0] === '.') && re.test(n)) next.push(this.abs(n, b));
      }
      cur = next;
    }
    const cut = cwd === '/' ? 1 : cwd.length + 1;
    return cur.length ? cur.sort().map(p => (abs ? p : p.slice(cut))) : [pat];
  }

  // Nạp Map<đường dẫn, File> (vd. files của fileSystem.js) vào hệ tệp ảo
  mount(files, base = '/sdcard/workspace') {
    this.mkdir(base, true);
    for (const [p, f] of files) {
      const k = this.abs(p, base);
      this.mkdir(dirOf(k), true);
      this.n.set(k, { t: 'f', d: f, m: f.lastModified });
    }
  }
  toJSON() { return [...this.n].filter(([, v]) => v.t === 'd' || typeof v.d === 'string'); } // chỉ thư mục + tệp văn bản
  load(j) { this.n = new Map(j); }
}
