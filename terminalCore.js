const C = { g: '\x1b[32m', c: '\x1b[36m', y: '\x1b[33m', r: '\x1b[31m', x: '\x1b[0m' };
const sortEnt = ([a, x], [b, y]) => y - x || a.localeCompare(b); // thư mục trước

// Lệnh kiểu Termux chạy trên hệ tệp ảo: (shell, args, flags) → chuỗi kết quả
const cmds = {
  help: () => 'ls [-l] [dir] · cd · pwd · cat f · head f [n] · tail f [n] · grep [-i] mẫu [dir|f] · find từ-khoá · tree · wc f · echo · clear · history',
  pwd: s => '/' + s.cwd,
  echo: (s, a) => a.join(' '),
  clear: s => void s.term?.clear(),
  history: s => s.hist.map((h, i) => `${i + 1}  ${h}`).join('\n'),
  cd(s, [p = '']) {
    const d = s.abs(p);
    if (!s.isDir(d)) throw `cd: ${p}: không có thư mục`;
    s.cwd = d;
  },
  ls(s, [p], f) {
    const d = s.abs(p), m = s.list(d), long = f.includes('-l'), pre = d ? d + '/' : '';
    if (!m.size) throw `ls: ${p || '.'}: trống hoặc không tồn tại`;
    return [...m].sort(sortEnt).map(([n, dir]) =>
      (long ? (dir ? 'd' : '-') + 'rw-r--  ' + String(dir ? '-' : files.get(pre + n).size).padStart(8) + '  ' : '') +
      (dir ? C.c + n + '/' + C.x : n)).join(long ? '\n' : '  ');
  },
  tree(s) {
    const out = [], walk = (d, ind) => {
      for (const [n, dir] of [...s.list(d)].sort(sortEnt)) {
        out.push(ind + (dir ? C.c + n + '/' + C.x : n));
        if (dir) walk((d ? d + '/' : '') + n, ind + '  ');
      }
    };
    walk(s.cwd, '');
    return out.join('\n') || '(trống)';
  },
  cat: async (s, [p]) => s.read(p),
  head: async (s, [p, n = 10]) => (await s.read(p)).split('\n').slice(0, +n).join('\n'),
  tail: async (s, [p, n = 10]) => (await s.read(p)).split('\n').slice(-n).join('\n'),
  async wc(s, [p]) {
    const t = await s.read(p);
    return `${t.split('\n').length} dòng · ${t.split(/\s+/).filter(Boolean).length} từ · ${t.length} ký tự`;
  },
  find: (s, [k = '']) => s.under().map(([p]) => p).filter(p => p.toLowerCase().includes(k.toLowerCase())).slice(0, 300).join('\n') || 'Không thấy.',
  async grep(s, [pat, where], f) {
    if (!pat) throw 'grep: thiếu mẫu tìm';
    const re = new RegExp(pat, f.includes('-i') ? 'i' : ''), out = [];
    for (const [k, file] of s.under(where)) {
      if (isBinary(k)) continue;
      (await file.text()).split('\n').forEach((l, i) => re.test(l) && out.push(`${C.g}${k}${C.x}:${i + 1}: ${l.trim().slice(0, 120)}`));
    }
    return out.slice(0, 200).join('\n') || 'Không thấy.';
  },
};

class EnvironmentCore {
  cwd = ''; hist = []; hi = 0; term = null;

  init(el) { this.el = el; }

  show() { // thay xterm.js bằng bộ vẽ ANSI tự viết (chạy offline trong APK)
    if (this.term) return;
    this.term = { writeln: s => renderAnsi(this.el, s + '\n'), clear: () => { this.el.textContent = ''; } };
    this.print(`${C.g}Termux-core${C.x} · shell ảo trên tệp đã nạp — gõ ${C.y}help${C.x}`);
  }

  print(s) { this.term?.writeln(String(s)); }

  abs(p = '') {
    const out = p.startsWith('/') ? [] : this.cwd.split('/').filter(Boolean);
    for (const s of p.split('/')) s === '..' ? out.pop() : s && s !== '.' && out.push(s);
    return out.join('/');
  }
  isDir(p) { return p === '' || [...files.keys()].some(k => k.startsWith(p + '/')); }
  list(d) { // phần tử con trực tiếp: tên → là thư mục?
    const m = new Map(), pre = d ? d + '/' : '';
    for (const k of files.keys()) if (k.startsWith(pre)) { const [n, ...rest] = k.slice(pre.length).split('/'); m.set(n, rest.length > 0); }
    return m;
  }
  under(p = '') { const d = this.abs(p), pre = d ? d + '/' : ''; return [...files].filter(([k]) => !d || k === d || k.startsWith(pre)); }
  async read(p) {
    if (!p) throw 'thiếu tên tệp';
    const k = this.abs(p), f = files.get(k);
    if (!f) throw `${p}: không có tệp`;
    if (isBinary(k)) throw `${p}: tệp nhị phân`;
    return f.text();
  }
  nav(d) { this.hi = Math.max(0, Math.min(this.hist.length, this.hi + d)); return this.hist[this.hi] || ''; }

  async exec(line) {
    line = line.trim();
    if (!line) return;
    this.hist.push(line); this.hi = this.hist.length;
    this.print(`${C.g}~/${this.cwd}${C.x} $ ${line}`);
    const [cmd, ...args] = (line.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^(["'])(.*)\1$/, '$2'));
    const flags = args.filter(a => /^-\w/.test(a)), rest = args.filter(a => !/^-\w/.test(a));
    try {
      if (!cmds[cmd]) throw `${cmd}: không tìm thấy lệnh`;
      const out = await cmds[cmd](this, rest, flags);
      if (out) this.print(out);
    } catch (e) { this.print(C.r + (e.message || e) + C.x); }
  }
}

const PAL = ['#484f58', '#f85149', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#56d4dd', '#c9d1d9'];
function renderAnsi(el, text) { // ANSI → <span>: màu 30–37/90–97, 0 = reset, ESC[2J = xoá màn hình
  for (const part of text.split(/(\x1b\[[0-9;]*[A-Za-z])/)) {
    const m = /^\x1b\[([0-9;]*)([A-Za-z])$/.exec(part);
    if (!m) { if (part) { const s = document.createElement('span'); s.textContent = part; if (el._c) s.style.color = el._c; el.append(s); } continue; }
    if (m[2] === 'J') el.textContent = '';
    else if (m[2] === 'm') for (const k of m[1].split(';')) { const n = +k || 0; el._c = n === 0 ? '' : n >= 30 && n <= 37 ? PAL[n - 30] : n >= 90 && n <= 97 ? PAL[n - 90] : el._c; }
  }
  while (el.childElementCount > 3000) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}
