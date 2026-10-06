const arg = (a, k) => { const i = a.indexOf(k); return i < 0 ? undefined : a[i + 1]; };
const need = (ok, what) => { if (!ok) throw new Error(`${what}: trình duyệt không hỗ trợ`); };

// Khách WebSocket tới termux-bridge.js (Termux thật). Giao thức: {id,cmd,stdin} → {id,t:'out'|'err'|'exit',d,code,cwd}
class Bridge {
  on = false; off = false; tries = 0; id = 0; jobs = new Map(); cwd = ''; cred = null; onState = () => {};
  get busy() { return this.jobs.size > 0; }
  connect(url, token) {
    this.close(); this.off = false; this.cred = { url, token };
    return new Promise((ok, no) => {
      const ws = (this.ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`)), t = setTimeout(() => { ws.close(); no(new Error('quá 8 giây không phản hồi')); }, 8000);
      ws.onopen = () => { clearTimeout(t); this.on = true; this.tries = 0; try { localStorage.setItem('wx-bridge', JSON.stringify(this.cred)); } catch {} ok(); };
      ws.onerror = () => { clearTimeout(t); no(new Error('không nối được (sai token/URL hoặc server chưa chạy?)')); };
      ws.onclose = () => { if (this.ws !== ws) return; const was = this.on; this.on = false; this.jobs.forEach(j => j.done(255)); this.jobs.clear(); if (was && !this.off) this.retry(); };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'hello') return void (this.cwd = m.cwd);
        const j = this.jobs.get(m.id);
        if (!j) return;
        if (m.t === 'exit') { this.cwd = m.cwd; this.jobs.delete(m.id); j.done(m.code ?? 1); } else j[m.t](m.d);
      };
    });
  }
  exec(cmd, o, stdin = '') { return new Promise(done => { if (!this.on) { o.err('bridge: chưa nối hoặc đã mất kết nối\n'); return done(255); } const id = ++this.id; this.jobs.set(id, { ...o, done }); this.ws.send(JSON.stringify({ id, cmd, stdin, open: 1 })); }); }
  kill() { this.ws?.send(JSON.stringify({ kill: 1 })); }
  last() { return [...this.jobs.keys()].at(-1); }
  input(t) { const id = this.last(); if (id) this.ws.send(JSON.stringify({ id, in: t })); } // dòng gõ khi lệnh đang chạy → stdin của lệnh
  eof() { const id = this.last(); if (id) this.ws.send(JSON.stringify({ id, eof: 1 })); }
  retry() { // mất kết nối bất ngờ (vd. ứng dụng bị treo nền) → nối lại sau 1s, 2s, 4s… tối đa 5 lần
    if (this.tries >= 5) return this.onState('Termux: mất kết nối — gõ "bridge connect" để nối lại');
    const d = 1000 * 2 ** this.tries++;
    this.onState(`Termux: mất kết nối, thử lại sau ${d / 1000}s…`);
    setTimeout(() => { if (this.off || this.on) return; this.connect(this.cred.url, this.cred.token).then(() => this.onState('Termux: đã nối lại'), () => this.retry()); }, d);
  }
  close() { this.on = false; this.off = true; this.jobs.forEach(j => j.done(255)); this.jobs.clear(); this.ws?.close(); }
}

const api = {
  // bridge connect [token] [url=ws://127.0.0.1:8765] (trong APK không cần token: tự bật bridge trong Termux) · bridge off · bridge status
  async bridge(c, [sub = 'status', token = '', url = 'ws://127.0.0.1:8765']) {
    const sh = c.sh;
    if (sub === 'connect') {
      let sv = {}; try { sv = JSON.parse(localStorage.getItem('wx-bridge') || '{}'); } catch {}
      const apk = window.WXT && !token; // trong APK: token do APK giữ, bridge tự được bật
      const tk = apk ? WXT.token() : token || sv.token || '', u = (token || apk) ? url : sv.url || url; // APK luôn dùng cổng mặc định mà APK tự bật
      if (!tk) throw new Error('thiếu token — gõ: bridge connect <token>');
      sh.bridge ??= new Bridge(); sh.bridge.onState = m => sh.write(`\x1b[33m${m}\x1b[0m\n`);
      for (let i = 0; ; i++) {
        try { await sh.bridge.connect(u, tk); break; }
        catch (e) {
          if (!apk) throw e;
          if (i > 14) throw new Error('Termux không phản hồi — đã cài nodejs, bật allow-external-apps, cấp quyền Run commands chưa?');
          if (!i) { const m = WXT.start(); if (m) throw new Error(m); c.out('Đang bật bridge trong Termux…\n'); }
          await new Promise(r => setTimeout(r, 800));
        }
      }
      c.out('Đã nối Termux thật. "bridge off" để về shell ảo · ^D gửi EOF cho lệnh đang chạy.\n');
    }
    else if (sub === 'off') { sh.bridge?.close(); c.out('Đã về shell ảo.\n'); }
    else c.out(`bridge: ${sh.bridge?.on ? 'ON' : 'OFF'}\n`);
  },
  pkg: c => { c.err('pkg: shell ảo không cài gói. Dùng "bridge connect <token>" để chạy Termux thật.\n'); return 1; },
  apt: (c, a) => api.pkg(c, a),

  'termux-setup-storage'(c) { ['shared', 'downloads', 'documents'].forEach(d => c.vfs.mkdir(`${c.env.HOME}/storage/${d}`, true)); c.out('Đã tạo ~/storage/{shared,downloads,documents}\n'); },
  'termux-info': c => c.out(`Termux-core ảo\nUA: ${navigator.userAgent}\nOnline: ${navigator.onLine}\n`),
  async 'termux-clipboard-get'(c) { c.out(await navigator.clipboard.readText()); },
  async 'termux-clipboard-set'(c, a) { await navigator.clipboard.writeText(a.join(' ') || c.stdin); },
  'termux-toast'(c, a) { const m = a.join(' ') || c.stdin; c.sh.hooks.toast ? c.sh.hooks.toast(m) : c.out(m + '\n'); },
  'termux-vibrate'(c, a) { need(navigator.vibrate, 'vibrate'); navigator.vibrate(+arg(a, '-d') || 300); },
  'termux-open-url': (c, [u]) => void window.open(u, '_blank'),
  'termux-open': (c, [u]) => void window.open(u, '_blank'),
  async 'termux-share'(c, a) { need(navigator.share, 'share'); await navigator.share({ text: a.join(' ') || c.stdin }); },
  async 'termux-battery-status'(c) {
    need(navigator.getBattery, 'battery');
    const b = await navigator.getBattery();
    c.out(JSON.stringify({ percentage: Math.round(b.level * 100), status: b.charging ? 'CHARGING' : 'DISCHARGING' }, null, 2) + '\n');
  },
  async 'termux-notification'(c, a) {
    need(window.Notification, 'notification');
    if ((await Notification.requestPermission()) === 'granted') new Notification(arg(a, '--title') || 'Termux', { body: arg(a, '--content') || '' });
  },
  'termux-tts-speak'(c, a) { need(window.speechSynthesis, 'tts'); speechSynthesis.speak(new SpeechSynthesisUtterance(a.join(' ') || c.stdin)); },
  async 'termux-wake-lock'(c) { need(navigator.wakeLock, 'wake-lock'); c.sh.lock = await navigator.wakeLock.request('screen'); },
  'termux-wake-unlock': c => c.sh.lock?.release(),
  'termux-download': (c, a) => c.sh.cmds.wget(c, a),
};
