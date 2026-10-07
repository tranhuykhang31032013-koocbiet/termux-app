/* Mở rộng trình quản lý tệp: sửa văn bản · xem ảnh/video/âm thanh · tìm nhanh trong thư mục. FM.open gọi từ fm.js (openFile) */
window.FMX = (() => {
  const $ = id => document.getElementById(id);
  const ext = p => (p.split('.').pop() || '').toLowerCase();
  const IMG = 'png jpg jpeg gif webp bmp svg ico avif', VID = 'mp4 mkv webm mov 3gp', AUD = 'mp3 wav ogg m4a flac aac opus';
  const BIN = 'zip rar 7z gz tar apk pdf so dex jar class exe bin db sqlite ttf otf woff woff2 doc docx xls xlsx ppt pptx iso';
  const is = (list, p) => list.split(' ').includes(ext(p));
  const url = p => 'file://' + encodeURI(p).replace(/#/g, '%23');
  const dlg = html => { const d = Object.assign(document.createElement('dialog'), { innerHTML: html, className: 'fmx' }); d.onclose = () => d.remove(); document.body.append(d); d.showModal(); return d; };
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const media = (p, tag) => {
    const d = dlg(`<b style="word-break:break-all">${esc(p.split('/').pop())}</b>
      <${tag} src="${url(p)}" ${tag === 'img' ? '' : 'controls autoplay'} style="max-width:100%;max-height:68vh;margin:.6rem auto;display:block;border-radius:12px;object-fit:contain"></${tag}>
      <div class="row2"><button class="btn primary">Đóng</button></div>`);
    d.querySelector('button').onclick = () => d.close();
    d.querySelector(tag).onerror = () => { d.close(); };
  };

  const edit = async (p, fsx, toast) => {
    let t;
    try { t = String(await fsx.read(p, 1e6)); } catch (e) { return toast(e.message || 'Không đọc được tệp'); }
    if (t.includes('\0')) return toast('Tệp nhị phân — không sửa được');
    const d = dlg(`<b style="word-break:break-all">${esc(p)}</b><small class="inf" style="color:var(--mut)"></small>
      <textarea spellcheck="false" autocapitalize="off" wrap="off" style="width:100%;height:55vh;margin:.5rem 0;background:#0e1013;border:1px solid var(--bd);border-radius:12px;padding:.6rem;font:12px/1.5 var(--mono);color:var(--tx);resize:none"></textarea>
      <div class="row2"><button class="btn" data-w>Xuống dòng</button><button class="btn" data-c>Chép</button><button class="btn primary" data-s>Lưu</button><button class="btn ghost" data-x>Đóng</button></div>`);
    const ta = d.querySelector('textarea'), inf = d.querySelector('.inf'); ta.value = t;
    let saved = t;
    const upd = () => { inf.textContent = ` ${ta.value.split('\n').length} dòng · ${ta.value.length} ký tự${ta.value === saved ? '' : ' · chưa lưu ●'}`; };
    ta.oninput = upd; upd();
    const save = async () => { try { await fsx.write(p, ta.value); saved = ta.value; upd(); toast('Đã lưu'); } catch (e) { toast(e.message || 'Không lưu được'); } };
    d.querySelector('[data-s]').onclick = save;
    d.querySelector('[data-w]').onclick = () => { ta.wrap = ta.wrap === 'off' ? 'soft' : 'off'; };
    d.querySelector('[data-c]').onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast('Đã sao chép'); } catch { ta.select(); document.execCommand('copy'); } };
    d.querySelector('[data-x]').onclick = () => { if (ta.value === saved || confirm('Bỏ thay đổi chưa lưu?')) d.close(); };
    d.oncancel = e => { if (ta.value !== saved && !confirm('Bỏ thay đổi chưa lưu?')) e.preventDefault(); };
    d.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
  };

  // fm.js gọi trước khi mở tệp: trả true = đã xử lý
  const open = (p, fsx, native, toast) => {
    if (is(IMG, p) && native) return media(p, 'img'), true;
    if (is(VID, p) && native) return media(p, 'video'), true;
    if (is(AUD, p) && native) return media(p, 'audio'), true;
    if (is(BIN, p)) return false;
    edit(p, fsx, toast); return true;
  };

  // ── Tìm nhanh trong thư mục đang xem (lọc theo tên) ──
  const bar = document.createElement('div');
  bar.className = 'hide'; bar.style.cssText = 'padding:.35rem .6rem;background:var(--bar);border-bottom:1px solid var(--bd)';
  bar.innerHTML = '<input id="fq" type="search" placeholder="Tìm theo tên…" autocomplete="off" autocapitalize="off" style="width:100%;padding:.55rem .8rem;border-radius:12px;border:1px solid var(--bd);background:#0e1013">';
  $('top').after(bar);
  const q = bar.firstChild;
  const filter = () => {
    const v = q.value.trim().toLowerCase();
    document.querySelectorAll('.list .row').forEach(r => { if (r.dataset.i === '-1') return; r.style.display = !v || (r.querySelector('b')?.textContent || '').toLowerCase().includes(v) ? '' : 'none'; });
  };
  q.oninput = filter;
  document.querySelectorAll('.list').forEach(l => new MutationObserver(filter).observe(l, { childList: true }));
  const b = Object.assign(document.createElement('button'), { className: 'ib', textContent: '🔍', ariaLabel: 'Tìm' });
  b.onclick = () => { bar.classList.toggle('hide'); if (bar.classList.contains('hide')) { q.value = ''; filter(); } else q.focus(); };
  $('bMore').before(b);
  return { open };
})();
