// Workspace X — trình quản lí tệp 2 ngăn (kiểu MT/NP Manager). Nạp SAU shell.js.
// Nguồn dữ liệu: window.WXFS (cầu Java trong APK) nếu có, không thì bộ nhớ ảo (VFS).
// WXFS: ls(p)→JSON [{n,d,s,m}] hoặc {e:lỗi} · read(p,max)→text · disk()→JSON {free,total}
//       write(p,text) · create(p) · mkdir(p) → '' nếu OK, lỗi thì trả thông báo
//       Tác vụ nặng chạy nền: startCp(a,b) · startMv(a,b) · startRm(JSON[đường dẫn]) → jobId · poll(id)→JSON {state,done,total,cur,err} · cancel(id)
const FM = (() => {
  const $ = id => document.getElementById(id), J = s => { try { return JSON.parse(s); } catch { return null; } };
  const z = n => String(n).padStart(2, '0'), bad = r => { if (r) throw new Error(r); };
  const fdate = (t, full) => { const d = new Date(t || 0), y = d.getFullYear(); return `${full ? y : String(y).slice(2)}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}${full ? ':' + z(d.getSeconds()) : ''}`; };
  const fsize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
  const esc = s => s.replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
  const join = (a, b) => (a === '/' ? '' : a) + '/' + b;
  let sk = 'n', sd = 1; // sk: n tên · m ngày · s cỡ · t loại; sd: 1 tăng, -1 giảm
  const ext = n => (n.lastIndexOf('.') > 0 ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : '');
  const byName = (a, b) => a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' });
  const cmp = { n: byName, m: (a, b) => a.m - b.m, s: (a, b) => a.s - b.s, t: (a, b) => ext(a.n).localeCompare(ext(b.n)) };
  const sortf = (a, b) => b.d - a.d || sd * cmp[sk](a, b) || byName(a, b);
  let toastT;
  const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); };
  const copy = async t => { // clipboard API có thể thiếu trong WebView → dự phòng execCommand
    try { await navigator.clipboard.writeText(t); return true; } catch {}
    const a = Object.assign(document.createElement('textarea'), { value: t });
    a.style.cssText = 'position:fixed;opacity:0'; document.body.append(a); a.select();
    try { return document.execCommand('copy'); } finally { a.remove(); }
  };

  // ── nguồn dữ liệu ──
  const sh = new Shell({ write: s => renderAnsi($('term'), s), hooks: { toast, exit: () => $('termDlg').close() } });
  const vfs = sh.vfs, W = window.WXFS;
  sh.load(); // khôi phục shell ảo đã lưu
  // Tác vụ nền WXFS.start* → Promise. Hộp tiến độ (nút Huỷ) chỉ hiện nếu chạy quá 0,3 s; hỏi trạng thái thưa dần 4→250 ms
  const job = (id, label) => new Promise((ok, no) => {
    const d = Object.assign(document.createElement('dialog'), { innerHTML: `<form><b>${label}</b><div class="nm"><small></small></div><progress max="100" style="width:100%"></progress><div class="row2"><button type="button" class="btn ghost">Huỷ</button></div></form>` });
    const cur = d.querySelector('small'), bar = d.querySelector('progress');
    const show = setTimeout(() => { document.body.append(d); d.showModal(); }, 300);
    let wait = 2, tm;
    const stop = () => { W.cancel(id); clearTimeout(tm); wait = 2; tm = setTimeout(tick, 10); }; // Huỷ: hỏi lại ngay, không đợi nhịp 250 ms
    d.querySelector('button').onclick = stop; d.oncancel = e => { e.preventDefault(); stop(); };
    const tick = () => {
      const r = J(W.poll(id)) || { state: 'gone' };
      if (r.state === 'queue' || r.state === 'run') {
        cur.textContent = r.cur || ''; r.total ? (bar.value = 100 * r.done / r.total) : bar.removeAttribute('value');
        return void (tm = setTimeout(tick, wait = Math.min(wait * 2, 250)));
      }
      clearTimeout(show); d.remove();
      r.state === 'done' ? ok() : no(new Error(r.err || 'Tác vụ không còn tồn tại'));
    };
    tick();
  });
  const virt = {
    root: '/sdcard', places: [['Bộ nhớ ảo', '/sdcard'], ['Workspace', '/sdcard/workspace'], ['Termux home', HOME], ['/tmp', '/tmp']],
    ls: p => vfs.readdir(p).map(n => { const q = vfs.abs(n, p), e = vfs.get(q), d = e.t === 'd'; return { n, d, s: d ? 0 : vfs.size(q), m: e.m || 0 }; }),
    read: p => vfs.read(p), write: (p, t) => vfs.write(p, t), mkdir: p => vfs.mkdir(p), rm: p => [].concat(p).forEach(q => vfs.rm(q, true)),
    create: p => { if (vfs.get(p)) throw new Error('Đã tồn tại: ' + p.split('/').pop()); return vfs.write(p, ''); },
    cp: (a, b) => vfs.cp(a, b), mv: (a, b) => vfs.mv(a, b), disk: () => null,
  };
  const nat = W && {
    root: '/storage/emulated/0', places: [['Bộ nhớ trong', '/storage/emulated/0'], ['Download', '/storage/emulated/0/Download'], ['Documents', '/storage/emulated/0/Documents'], ['DCIM', '/storage/emulated/0/DCIM']],
    ls: p => { const r = J(W.ls(p)); if (Array.isArray(r)) return r; throw new Error(r?.e || 'Không đọc được thư mục'); }, read: (p, max = 5e6) => { const r = W.read(p, max); if (r.charCodeAt(0) === 1) throw new Error(r.slice(1)); return r; }, write: (p, t) => bad(W.write(p, t)), create: p => bad(W.create(p)), mkdir: p => bad(W.mkdir(p)),
    rm: p => job(W.startRm(JSON.stringify([].concat(p))), 'Đang xoá…'), cp: (a, b) => job(W.startCp(a, b), 'Đang sao chép…'), mv: (a, b) => job(W.startMv(a, b), 'Đang chuyển…'), disk: () => J(W.disk?.()),
  };
  const fsx = nat || virt;

  // ── trạng thái & vẽ ──
  const S = [0, 1].map(() => ({ path: fsx.root, items: [], err: '', sel: new Set(), back: [], fwd: [] }));
  let act = 0, hid = false, lp = 0, merged = { name: '', text: '' };
  const IC = { png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', mp3: '🎵', mp4: '🎞', mkv: '🎞', zip: '🗜', rar: '🗜', '7z': '🗜', gz: '🗜', apk: '🤖', pdf: '📕', js: '📜', html: '🌐', css: '🎨', json: '🧾', py: '🐍', sh: '⌨️', txt: '📝', md: '📝' };
  const icon = it => it.d ? '📁' : IC[it.n.split('.').pop().toLowerCase()] || '📄';

  const draw = i => {
    const s = S[i];
    $('l' + i).innerHTML = '<div class="row" data-i="-1"><span class="ic d">📁</span><div class="nm"><b>..</b></div></div>' + (s.items.length ? s.items.map((it, k) =>
      `<div class="row${s.sel.has(it.n) ? ' sel' : ''}" data-i="${k}"><span class="ic${it.d ? ' d' : ''}">${icon(it)}</span><div class="nm"><b>${esc(it.n)}</b><small>${fdate(it.m)}${it.d ? '' : ' · ' + fsize(it.s)}</small></div></div>`).join('') : `<div class="empty">${s.err ? '⚠ ' + esc(s.err) : 'Thư mục trống'}</div>`);
    $('p' + i).classList.toggle('on', i === act);
  };
  const head = async () => {
    const s = S[act], nd = s.items.filter(x => x.d).length, k = s.sel.size, dk = await fsx.disk();
    $('path').textContent = s.path;
    $('info').textContent = `Thư mục: ${nd} · Tệp: ${s.items.length - nd}` + (dk ? ` · ${fsize(dk.total - dk.free)}/${fsize(dk.total)}` : ' · bộ nhớ ảo') + (k ? ` · Chọn ${k}` : '');
    $('acts').classList.toggle('hide', !k);
    $('bBack').disabled = !s.back.length; $('bFwd').disabled = !s.fwd.length;
  };
  const load = async (i, path, push = true) => {
    const s = S[i];
    try { s.items = (await fsx.ls(path)).filter(x => hid || x.n[0] !== '.').sort(sortf); s.err = ''; }
    catch (e) { const m = e.message || 'Không mở được thư mục'; toast(m); if (push) return; s.items = []; s.err = m; } // mở thư mục lỗi: ở yên chỗ cũ · làm mới/lùi: hiện lỗi, không báo "trống"
    if (push && path !== s.path) { s.back.push(s.path); s.fwd = []; try { history.pushState(0, ''); } catch {} }
    s.path = path; s.sel.clear(); draw(i); if (i === act) head();
  };
  const refresh = async () => { await Promise.all([load(0, S[0].path, false), load(1, S[1].path, false)]); head(); };
  const up = i => { const p = S[i].path; load(i, p.slice(0, p.lastIndexOf('/')) || '/'); };
  const hop = (i, from, to) => { const s = S[i], p = s[from].pop(); if (p == null) return; s[to].push(s.path); load(i, p, false); };
  const tog = (i, k) => { const s = S[i], n = s.items[k]?.n; if (n == null) return; s.sel.has(n) ? s.sel.delete(n) : s.sel.add(n); draw(i); head(); };
  const focus = i => { if (act === i) return; act = i; $('p0').classList.toggle('on', !i); $('p1').classList.toggle('on', !!i); head(); };

  // ── hộp thoại ──
  const ask = (title, val) => new Promise(ok => { // val == null → hỏi xác nhận; ngược lại → ô nhập
    const d = $('dlg'), inp = $('dlgIn');
    $('dlgT').textContent = title; inp.hidden = val == null; inp.value = val ?? '';
    d.returnValue = ''; d.showModal(); if (val != null) inp.select();
    d.onclose = () => ok(d.returnValue === 'ok' ? (val == null ? true : inp.value.trim()) : null);
  });
  const sheet = (labels, title = '') => new Promise(ok => {
    const d = $('sheet');
    d.innerHTML = (title ? `<b>${esc(title)}</b>` : '') + labels.map((l, k) => `<button class="btn" data-k="${k}">${l}</button>`).join('');
    d.onclick = e => { const b = e.target.closest('button'); if (b) ok(+b.dataset.k); if (b || e.target === d) d.close(); };
    d.onclose = () => ok(-1);
    d.showModal();
  });
  const openFile = async p => {
    if (isBinary(p)) return toast('Tệp nhị phân — không xem được');
    try { const t = String(await fsx.read(p, 2e5)).slice(0, 2e5); if (t.includes('\0')) return toast('Tệp nhị phân — không xem được'); $('vT').textContent = p; $('vB').textContent = t; $('view').showModal(); } catch (e) { toast(e.message); }
  };

  // ── thao tác ──
  const sel = () => { const s = S[act]; return s.items.filter(x => s.sel.has(x.n)).map(x => ({ ...x, p: join(s.path, x.n) })); };
  const run = async (fn, ok) => { try { await fn(); toast(ok); } catch (e) { toast(e.message || String(e)); } if (fsx === virt) sh.save(); refresh(); };
  const key = n => (nat ? n.toLowerCase() : n); // bộ nhớ thật không phân biệt hoa/thường
  const uniq = (n, dst) => { // "a.txt" → "a (1).txt" (số đầu tiên chưa dùng)
    const i = n.lastIndexOf('.') > 0 ? n.lastIndexOf('.') : n.length;
    for (let k = 1; ; k++) { const c = `${n.slice(0, i)} (${k})${n.slice(i)}`; if (!dst.has(key(c))) return c; }
  };
  const xfer = mv => {
    const l = sel(), to = S[1 - act].path;
    if (to === S[act].path) return toast('Hai ngăn đang cùng thư mục — mở thư mục đích ở ngăn kia');
    if (l.some(f => f.d && (to === f.p || to.startsWith(f.p + '/')))) return toast('Không thể đưa thư mục vào chính nó');
    run(async () => {
      const dst = new Map((await fsx.ls(to)).map(x => [key(x.n), x])), op = mv ? fsx.mv : fsx.cp;
      let all = -1; // -1: hỏi từng mục · 0: ghi đè hết · 1: bỏ qua hết
      for (const f of l) {
        let name = f.n, mode = all, ex = dst.get(key(f.n));
        if (ex && mode < 0) {
          const k = await sheet(['Ghi đè', 'Bỏ qua', 'Đổi tên…', 'Ghi đè tất cả', 'Bỏ qua tất cả'], `"${f.n}" đã có ở thư mục đích`);
          if (k < 0) throw new Error('Đã huỷ');
          mode = k % 3; if (k > 2) all = mode;
        }
        if (ex && mode === 1) continue;
        if (ex && mode === 2) {
          name = uniq(f.n, dst);
          for (;;) {
            name = await ask('Tên mới', name);
            if (!name) throw new Error('Đã huỷ');
            if (!dst.has(key(name))) break;
            name = uniq(name, dst);
          }
          ex = null;
        }
        const p = join(to, name);
        if (ex) { // ghi đè
          if (mv && f.d && ex.d) { await fsx.cp(f.p, p); await fsx.rm(f.p); continue; } // thư mục vào thư mục: gộp
          if (mv || ex.d !== f.d) await fsx.rm(join(to, ex.n)); // chuyển, hoặc khác loại: xoá đích trước
        }
        await op(f.p, p);
        dst.set(key(name), { n: name, d: f.d });
      }
    }, mv ? 'Đã chuyển' : 'Đã sao chép'); };

  // Gộp .txt: mỗi tệp có khối thông tin đầy đủ (tên, đường dẫn đầy đủ/tương đối, kích thước, dòng, ngày sửa) + mục lục đầu tệp
  const merge = async () => {
    const s = S[act], base = s.path, cut = base === '/' ? 1 : base.length + 1;
    const skip = [], walk = async (l, out = [], lv = 0) => {
      for (const f of l) {
        if (!f.d) out.push(f);
        else if ((lv === 0 || !f.l) && lv < 30 && !/^(\.git|node_modules)$/.test(f.n)) try { await walk((await fsx.ls(f.p)).sort(sortf).map(k => ({ ...k, p: join(f.p, k.n) })), out, lv + 1); } catch { skip.push(f); } // không đọc được → bỏ qua
      }
      return out;
    };
    toast('Đang đọc tệp…');
    const all = await walk(sel()), ok = [];
    let total = 0, lines = 0;
    for (const f of all) {
      let t = null;
      if (!isBinary(f.n)) try { t = String(await fsx.read(f.p)); } catch {}
      if (t == null || t.includes('\0')) { skip.push(f); continue; }
      f.t = t; f.l = t.split('\n').length; total += f.s; lines += f.l; ok.push(f);
    }
    const bar = '='.repeat(60), hash = '#'.repeat(60);
    const intro = [hash, '# GỘP TỆP · Workspace X', `# Thời gian    : ${fdate(Date.now(), 1)}`, `# Thư mục gốc  : ${base}`,
      `# Số tệp gộp   : ${ok.length}` + (skip.length ? ` (bỏ qua ${skip.length} tệp nhị phân/không đọc được)` : ''),
      `# Tổng cộng    : ${fsize(total)} (${total} byte) · ${lines} dòng`, hash, '', 'MỤC LỤC:',
      ...ok.map((f, k) => `${String(k + 1).padStart(4)}. ${f.p}  (${fsize(f.s)})`),
      ...(skip.length ? ['', 'ĐÃ BỎ QUA:', ...skip.map(f => '  - ' + f.p)] : []), ''].join('\n');
    const body = ok.map((f, k) => ['', bar, `[${k + 1}/${ok.length}] TÊN: ${f.n}`, `Đường dẫn đầy đủ    : ${f.p}`, `Đường dẫn tương đối : ${f.p.slice(cut)}`,
      `Thư mục chứa        : ${f.p.slice(0, f.p.lastIndexOf('/')) || '/'}`, `Phần mở rộng        : ${f.n.includes('.') ? '.' + f.n.split('.').pop() : '(không có)'}`,
      `Kích thước          : ${fsize(f.s)} (${f.s} byte)`, `Số dòng · ký tự     : ${f.l} · ${f.t.length}`, `Sửa đổi lần cuối    : ${f.m ? fdate(f.m, 1) : 'không rõ'}`,
      bar, '', f.t, '', ''].join('\n')).join('\n');
    const names = s.items.filter(x => s.sel.has(x.n)).map(x => x.n.replace(/\.[^/.]+$/, ''));
    merged = { name: names.slice(0, 3).join('_') + (names.length > 3 ? '_merged_files' : '') + '.txt', text: intro + body };
    $('mInfo').textContent = `${merged.name} · ${ok.length} tệp · ${fsize(merged.text.length)}`;
    $('mBody').value = merged.text.slice(0, 1e5) + (merged.text.length > 1e5 ? '\n… (xem trước 100K ký tự đầu — lưu hoặc sao chép để lấy đủ)' : '');
    $('merge').showModal();
  };

  const acts = {
    all: () => { const s = S[act]; s.items.forEach(x => s.sel.add(x.n)); draw(act); head(); },
    x: () => { S[act].sel.clear(); draw(act); head(); },
    cp: () => xfer(0), mv: () => xfer(1), gp: merge,
    rn: async () => {
      const l = sel(); if (l.length !== 1) return toast('Chọn đúng 1 mục để đổi tên');
      const n = await ask('Đổi tên', l[0].n); if (n && n !== l[0].n) run(() => fsx.mv(l[0].p, join(S[act].path, n)), 'Đã đổi tên');
    },
    rm: async () => { const l = sel(); if (await ask(`Xoá ${l.length} mục đã chọn?`)) run(() => fsx.rm(l.map(f => f.p)), 'Đã xoá'); },
  };

  // ── sự kiện ──
  const put = (i, k, on) => { // đặt trạng thái chọn cho hàng k, không vẽ lại cả danh sách
    const s = S[i], n = s.items[k]?.n;
    if (n == null) return;
    s.sel[on ? 'add' : 'delete'](n); $('l' + i).children[k + 1]?.classList.toggle('sel', on);
  };
  [0, 1].forEach(i => {
    const box = $('l' + i); let t, g = null;
    const stop = () => clearTimeout(t);
    box.onpointerdown = e => {
      lp = 0; focus(i); const r = e.target.closest('.row'), k = r ? +r.dataset.i : -1; g = { x: e.clientX, y: e.clientY, k, on: 0, last: k };
      if (k >= 0) t = setTimeout(() => { lp = 1; navigator.vibrate?.(15); tog(i, k); if (g) Object.assign(g, { on: 1, mode: S[i].sel.has(S[i].items[k]?.n) }); }, 450); // nhấn giữ = chọn
    };
    box.onscroll = stop;
    box.onpointerup = box.onpointercancel = box.onpointerleave = () => { stop(); if (g?.on) head(); g = null; };
    box.onpointermove = e => { // vuốt ngang rồi kéo qua các hàng = chọn/bỏ chọn cả dải (nhấn giữ rồi kéo cũng được)
      if (!g) return;
      if (!g.on) {
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (Math.abs(dx) < 16 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
        stop(); lp = 1; g.on = 1; g.mode = g.k >= 0 ? !S[i].sel.has(S[i].items[g.k]?.n) : true;
      }
      const r = document.elementFromPoint(e.clientX, e.clientY)?.closest('.row'), k = r && box.contains(r) ? +r.dataset.i : -1;
      if (k < 0) return;
      if (g.last < 0) g.last = k;
      for (let j = Math.min(k, g.last); j <= Math.max(k, g.last); j++) put(i, j, g.mode);
      g.last = k;
    };
    box.oncontextmenu = e => e.preventDefault();
    box.onclick = e => {
      if (lp) return void (lp = 0);
      const r = e.target.closest('.row'); if (!r) return;
      const k = +r.dataset.i, s = S[i];
      if (k < 0) return up(i);
      if (s.sel.size) return tog(i, k);
      const p = join(s.path, s.items[k].n);
      s.items[k].d ? load(i, p) : openFile(p);
    };
  });
  $('acts').onclick = e => { const a = e.target.closest('button')?.dataset.a; if (a) acts[a](); };
  $('bBack').onclick = () => hop(act, 'back', 'fwd');
  $('bFwd').onclick = () => hop(act, 'fwd', 'back');
  $('bUp').onclick = () => up(act);
  $('bSwap').onclick = () => { [S[0], S[1]] = [S[1], S[0]]; draw(0); draw(1); head(); };
  $('bAdd').onclick = async () => {
    const k = await sheet(['📁 Thư mục mới', '📝 Tệp mới']); if (k < 0) return;
    const n = await ask(k ? 'Tên tệp' : 'Tên thư mục', ''); if (n) run(() => k ? fsx.create(join(S[act].path, n)) : fsx.mkdir(join(S[act].path, n)), 'Đã tạo');
  };
  $('bMenu').onclick = async () => { const k = await sheet(fsx.places.map(p => '📂 ' + p[0])); if (k >= 0) load(act, fsx.places[k][1]); };
  const sortMenu = async () => {
    const nm = { n: 'Tên', m: 'Ngày sửa', s: 'Kích thước', t: 'Loại' }, ks = Object.keys(nm);
    const k = await sheet(ks.map(x => (x === sk ? (sd > 0 ? '↑ ' : '↓ ') : '\u2003 ') + nm[x]), 'Sắp xếp (bấm lại để đảo chiều)');
    if (k < 0) return;
    if (ks[k] === sk) sd = -sd; else { sk = ks[k]; sd = 'ms'.includes(sk) ? -1 : 1; } // ngày/cỡ: mới/lớn trước
    refresh();
  };
  $('bMore').onclick = async () => {
    const k = await sheet(['⌨ Terminal', (hid ? '🙈 Ẩn' : '👁 Hiện') + ' tệp ẩn', '↕ Sắp xếp…', '🔄 Làm mới', ...(fsx === virt ? ['📥 Nhập tệp / .zip', '📂 Nhập thư mục'] : [])]);
    if (k === 0) openTerm(); else if (k === 1) { hid = !hid; refresh(); } else if (k === 2) sortMenu(); else if (k === 3) refresh(); else if (k === 4) $('fileIn').click(); else if (k === 5) $('dirIn').click();
  };
  window.onpopstate = () => S[act].back.length ? hop(act, 'back', 'fwd') : up(act); // nút Back của Android

  // Gộp: sao chép / lưu tại thư mục hiện tại / tải xuống
  $('mCopy').onclick = async () => toast((await copy(merged.text)) ? 'Đã sao chép toàn bộ' : 'Không thể sao chép');
  $('mHere').onclick = async () => { try { const have = new Set((await fsx.ls(S[act].path)).map(x => key(x.n))), nm = have.has(key(merged.name)) ? uniq(merged.name, have) : merged.name; await fsx.write(join(S[act].path, nm), merged.text); toast('Đã lưu ' + nm); refresh(); } catch (e) { toast(e.message); } };
  $('mDl').onclick = () => { // APK có thể gắn window.WX_SAVE = (name, text) => Android.save(name, text)
    if (window.WX_SAVE) return window.WX_SAVE(merged.name, merged.text);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([merged.text], { type: 'text/plain;charset=utf-8' })), download: merged.name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  };
  $('vCopy').onclick = async () => toast((await copy($('vB').textContent)) ? 'Đã sao chép' : 'Không thể sao chép');

  // Terminal (Shell trên cùng hệ tệp ảo) · Nhập tệp/zip/thư mục vào /sdcard/workspace
  const openTerm = () => {
    if (fsx === virt) sh.cwd = S[act].path;
    if (!$('term').childElementCount) sh.write('\x1b[32mTermux-core\x1b[0m · gõ \x1b[33mhelp\x1b[0m\n');
    $('termDlg').showModal(); $('cmd').focus();
  };
  $('termDlg').onclose = refresh;
  $('cmdForm').onsubmit = async e => { e.preventDefault(); const v = $('cmd').value; $('cmd').value = ''; sh.write(`\x1b[32m${sh.prompt()}\x1b[0m${v}\n`); try { await sh.submit(v); } catch (x) { sh.write(`\x1b[31m${x.message || x}\x1b[0m\n`); } sh.save(); };
  const tab = () => { // Tab: 1 gợi ý → điền · nhiều → tiền tố chung + liệt kê
    const i = $('cmd'), v = i.value; if (sh.bridge?.on) return;
    const c = sh.complete(v); if (!c.length) return;
    const w = /(\S*)$/.exec(v)[1], pre = c.reduce((a, b) => { let k = 0; while (a[k] && a[k] === b[k]) k++; return a.slice(0, k); });
    i.value = v.slice(0, v.length - w.length) + pre + (c.length === 1 && !pre.endsWith('/') ? ' ' : '');
    if (c.length > 1) sh.write(c.join('  ') + '\n');
  };
  const xk = { d: () => sh.bridge?.eof(), tab, c: () => { sh.ctrlC(); sh.write('^C\n'); }, up: () => { $('cmd').value = sh.nav(-1); }, dn: () => { $('cmd').value = sh.nav(1); } };
  $('cmd').onkeydown = e => {
    const k = e.key === 'Tab' ? 'tab' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'dn' : e.ctrlKey && e.key === 'c' && e.target.selectionStart === e.target.selectionEnd ? 'c' : '';
    if (k) { e.preventDefault(); xk[k](); }
  };
  $('xk').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { xk[k](); $('cmd').focus(); } };
  $('fileIn').onchange = $('dirIn').onchange = async e => {
    toast('Đang đọc…'); try { await addList(e.target.files); } catch { toast('Không đọc được một số mục'); }
    e.target.value = ''; vfs.mount(files); await load(act, '/sdcard/workspace'); toast(`Đã nhập: ${files.size} tệp trong /sdcard/workspace`);
  };

  load(0, fsx.root, false); load(1, fsx.root, false);
  if (!nat) toast('Chưa có WXFS — đang dùng bộ nhớ ảo');
  return { S, fsx, refresh };
})();
