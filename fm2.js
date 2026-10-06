// Workspace X — phần thêm: 🔍 tìm kiếm (tuỳ chọn thư mục con) + "Chi tiết" (thuộc tính). Nạp SAU fm.js, không sửa fm.js.
(() => {
  const { S, fsx, refresh } = FM, $ = id => document.getElementById(id);
  const z = n => String(n).padStart(2, '0'), join = (a, b) => (a === '/' ? '' : a) + '/' + b;
  const esc = s => String(s).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
  const fsize = b => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
  const fdate = t => { const d = new Date(t || 0); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };
  const SKIP = /^(\.git|node_modules)$/, pane = () => +$('p1').classList.contains('on');
  const go = p => { // mở thư mục p ở ngăn đang chọn (có ghi lịch sử Lùi/Tiến + nút Back Android)
    const s = S[pane()];
    if (p !== s.path) { s.back.push(s.path); s.fwd = []; s.path = p; try { history.pushState(0, ''); } catch {} }
    refresh();
  };
  const dlg = html => { const d = document.createElement('dialog'); d.innerHTML = html; d.onclose = () => d.remove(); document.body.append(d); d.showModal(); return d; };

  // ── 🔍 Tìm trong thư mục hiện tại (* và ? dùng được; không phân biệt hoa/thường) ──
  const search = () => {
    const base = S[pane()].path, rel = p => p.slice(base === '/' ? 1 : base.length + 1);
    let rec = true, hits = [], gen = 0;
    const d = dlg(`<form id="fF"><b>Tìm trong ${esc(base)}</b><input id="fQ" placeholder="tên chứa… (* ? được)" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button type="button" class="btn" id="fR"></button><div class="list" id="fL" style="max-height:42vh"></div><div class="row2"><button type="button" class="btn ghost" id="fX">Đóng</button><button class="btn primary">Tìm</button></div></form>`);
    const q = x => d.querySelector(x), L = q('#fL'), R = q('#fR'), dc = d.onclose; d.onclose = () => { gen++; dc(); }; // đóng hộp = huỷ tìm
    const paint = () => { R.textContent = 'Cả thư mục con: ' + (rec ? 'bật' : 'tắt'); };
    paint(); R.onclick = () => { rec = !rec; paint(); };
    q('#fX').onclick = () => d.close();
    q('#fF').onsubmit = async e => {
      e.preventDefault();
      const t = q('#fQ').value.trim(); if (!t) return;
      const re = new RegExp(t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'i'), out = [], run = ++gen; let t0 = Date.now(), seen = 0;
      L.innerHTML = '<div class="empty">Đang tìm…</div>';
      const walk = async (dir, lv = 0) => {
        let l; try { l = await fsx.ls(dir); } catch { return; }
        for (const it of l) {
          if (out.length >= 300 || run !== gen) return;
          const p = join(dir, it.n); seen++;
          if (re.test(it.n)) out.push({ ...it, p });
          if (it.d && !it.l && rec && lv < 30 && !SKIP.test(it.n)) {
            if (Date.now() - t0 > 40) { L.firstChild.textContent = `Đang tìm… ${seen} mục`; await new Promise(r => setTimeout(r)); t0 = Date.now(); }
            await walk(p, lv + 1);
          }
        }
      };
      await walk(base); if (run !== gen) return; hits = out;
      L.innerHTML = out.length
        ? out.map((it, k) => `<div class="row" data-k="${k}"><span class="ic${it.d ? ' d' : ''}">${it.d ? '📁' : '📄'}</span><div class="nm"><b>${esc(it.n)}</b><small>${esc(rel(it.p))}${it.d ? '' : ' · ' + fsize(it.s)}</small></div></div>`).join('') + (out.length >= 300 ? '<div class="empty">Chỉ hiện 300 kết quả đầu</div>' : '')
        : '<div class="empty">Không thấy.</div>';
    };
    L.onclick = e => { // chạm kết quả: mở thư mục đó (tệp → thư mục chứa nó)
      const r = e.target.closest('.row'); if (!r) return;
      const it = hits[+r.dataset.k]; d.close();
      go(it.d ? it.p : it.p.slice(0, it.p.lastIndexOf('/')) || '/');
    };
  };

  // ── Chi tiết: đường dẫn đầy đủ, dung lượng tổng (đệ quy), ngày, quyền (cần WXFS.stat) ──
  const info = async () => {
    const s = S[pane()], l = s.items.filter(x => s.sel.has(x.n)).map(x => ({ ...x, p: join(s.path, x.n) }));
    if (!l.length) return;
    const d = dlg(`<form method="dialog"><b>${l.length > 1 ? l.length + ' mục đã chọn' : esc(l[0].n)}</b><pre id="iB" style="white-space:pre-wrap;word-break:break-all;font:12px/1.5 var(--mono)">Đang tính…</pre><div class="row2"><button class="btn primary">Đóng</button></div></form>`);
    let sz = 0, nf = 0, nd = 0;
    let t0 = Date.now();
    const walk = async (it, lv = 0) => {
      if (!it.d) { nf++; sz += it.s; return; }
      nd++;
      if (it.l || lv > 30) return;
      if (Date.now() - t0 > 40) { await new Promise(r => setTimeout(r)); t0 = Date.now(); }
      let c = []; try { c = await fsx.ls(it.p); } catch {}
      for (const k of c) await walk({ ...k, p: join(it.p, k.n) }, lv + 1);
    };
    for (const it of l) await walk(it);
    const dirs = l.filter(x => x.d).length, one = l.length === 1 ? l[0] : null;
    let perm = '—';
    if (one && window.WXFS?.stat) try { const j = JSON.parse(WXFS.stat(one.p)); perm = (j.r ? 'r' : '-') + (j.w ? 'w' : '-') + (j.x ? 'x' : '-'); } catch {}
    d.querySelector('#iB').textContent = [
      one ? `Đường dẫn : ${one.p}` : `Thư mục   : ${s.path}`,
      `Loại      : ${one ? (one.d ? 'Thư mục' : 'Tệp') : 'Nhiều mục'}`,
      `Dung lượng: ${fsize(sz)} (${sz} byte)`,
      ...(dirs ? [`Chứa      : ${nf} tệp · ${nd - dirs} thư mục`] : []),
      ...(one ? [`Sửa đổi   : ${fdate(one.m)}`, `Quyền     : ${perm}`] : []),
    ].join('\n');
  };

  // ── gắn nút: 🔍 vào thanh dưới, "Chi tiết" vào thanh thao tác (hiện khi có mục được chọn) ──
  const sb = Object.assign(document.createElement('button'), { textContent: '🔍', title: 'Tìm kiếm', onclick: search });
  $('nav').insertBefore(sb, $('bUp'));
  const ib = Object.assign(document.createElement('button'), { innerHTML: '<i>ℹ️</i>Chi tiết', onclick: info });
  $('acts').insertBefore(ib, $('acts').querySelector('[data-a="x"]'));
})();
