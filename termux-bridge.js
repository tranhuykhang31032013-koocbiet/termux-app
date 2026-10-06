#!/usr/bin/env node
// Cầu nối Termux thật. Chạy trong Termux: node termux-bridge.js [cổng=8765] → mở http://localhost:8765
// Phục vụ tệp tĩnh + WebSocket chạy lệnh. Chỉ nghe 127.0.0.1, bắt buộc token + Origin hợp lệ.
// Không có PTY: lệnh tương tác (vim, nano, python REPL…) không chạy được. Trong ứng dụng gõ: bridge connect <token>
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const PORT = +process.argv[2] || 8765, ROOT = __dirname, TOKEN = process.env.TX_TOKEN || randomBytes(8).toString('hex');
const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, 'file://', 'null', 'https://appassets.androidplatform.net', 'https://localhost', 'http://localhost', 'capacitor://localhost', ...(process.env.TX_ORIGINS || '').split(',').filter(Boolean)]; // WebView APK + TX_ORIGINS="a,b"
const ENV = { ...process.env, TERM: process.env.TERM || 'xterm-256color', COLORTERM: 'truecolor' }, HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/; // HOST: chặn DNS-rebinding
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json' };

const send = (s, o) => {
  if (s.destroyed) return true;
  const b = Buffer.from(JSON.stringify(o)), n = b.length;
  const h = n < 126 ? Buffer.from([0x81, n])
    : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : Buffer.from([0x81, 127, 0, 0, 0, 0, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  return s.write(Buffer.concat([h, b])); // false = trình duyệt chưa kịp nhận → bên gọi tạm dừng đọc
};

function session(s) {
  let buf = Buffer.alloc(0), cwd = process.env.HOME || process.cwd();
  const procs = new Map(), sig = (p, g) => { try { process.kill(-p.pid, g); } catch { try { p.kill(g); } catch {} } }; // tín hiệu tới cả nhóm tiến trình

  send(s, { t: 'hello', cwd });
  const handle = m => {
    if (m.kill) return procs.forEach(p => sig(p, 'SIGINT'));
    if (m.in != null || m.eof) { const p = procs.get(m.id); if (p?.stdin.writable) m.eof ? p.stdin.end() : p.stdin.write(String(m.in)); return; } // stdin cho lệnh đang chạy
    const id = m.id, cd = /^\s*cd(?:\s+(.*))?\s*$/.exec(m.cmd);
    if (cd) {
      const t = path.resolve(cwd, (cd[1] || '~').replace(/^["']|["']$/g, '').replace(/^~/, process.env.HOME || '/'));
      if (fs.existsSync(t) && fs.statSync(t).isDirectory()) cwd = t; else send(s, { id, t: 'err', d: `cd: ${cd[1]}: No such directory\n` });
      return send(s, { id, t: 'exit', code: 0, cwd });
    }
    // Khởi chạy bash từ môi trường Termux
    const p = cp.spawn(process.env.SHELL || 'bash', ['-c', `${m.cmd}\n__rc=$?; pwd >&3; exit $__rc`], { cwd, env: ENV, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    procs.set(id, p);
    let pw = '', hold = false;
    const feed = (t, st) => { // setEncoding: UTF-8 không vỡ ở ranh giới khối · chờ 'drain' khi trình duyệt chưa kịp nhận
      st.setEncoding('utf8');
      st.on('data', d => { if (!send(s, { id, t, d }) && !hold) { hold = true; p.stdout.pause(); p.stderr.pause(); s.once('drain', () => { hold = false; p.stdout.resume(); p.stderr.resume(); }); } });
    };
    feed('out', p.stdout); feed('err', p.stderr);
    p.stdio[3].on('data', d => (pw += d)); // fd 3: thư mục cuối → `cd a && ls` giữ nguyên cho lệnh sau
    p.on('error', e => { procs.delete(id); send(s, { id, t: 'err', d: e.message + '\n' }); send(s, { id, t: 'exit', code: 127, cwd }); });
    p.on('close', code => { procs.delete(id); pw = pw.trim(); if (pw && fs.existsSync(pw)) cwd = pw; send(s, { id, t: 'exit', code, cwd }); });
    p.stdin.on('error', () => {});
    if (m.stdin) p.stdin.write(m.stdin);
    if (!m.open) p.stdin.end(); // open: giữ stdin mở để nhận dòng gõ thêm
  };

  s.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) { // tách khung WebSocket (client luôn gửi có mask)
      if (buf.length < 2) return;
      let n = buf[1] & 127, o = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
      if (n > 8e6) return s.destroy(); // khung quá lớn
      if (buf.length < o + 4 + n) return;
      const op = buf[0] & 15, mask = buf.subarray(o, o + 4), p = Buffer.alloc(n);
      for (let i = 0; i < n; i++) p[i] = buf[o + 4 + i] ^ mask[i % 4];
      buf = buf.subarray(o + 4 + n);
      if (op === 8) return s.end();
      if (op === 1) { try { handle(JSON.parse(p.toString())); } catch (e) { send(s, { t: 'err', d: String(e) }); } }
    }
  });
  s.on('error', () => {});
  s.on('close', () => procs.forEach(p => sig(p, 'SIGTERM')));
}

const srv = http.createServer((q, r) => {
  try {
    if (!HOST.test(q.headers.host || '')) return r.writeHead(421).end();
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!f.startsWith(ROOT + path.sep)) return r.writeHead(403).end();
    fs.readFile(f, (e, d) => (e ? r.writeHead(404).end('404') : r.writeHead(200, { 'Content-Type': MIME[path.extname(f).slice(1)] || 'application/octet-stream' }).end(d)));
  } catch { r.writeHead(400).end(); }
});

srv.on('upgrade', (q, s) => {
  let ok = false;
  try { // so token hằng thời gian · URL lạ không làm sập server
    const t = Buffer.from(new URL(q.url, 'http://x').searchParams.get('token') || ''), k = Buffer.from(TOKEN);
    ok = HOST.test(q.headers.host || '') && t.length === k.length && timingSafeEqual(t, k) && ORIGINS.includes(q.headers.origin);
  } catch {}
  if (!ok) return s.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  const acc = createHash('sha1').update(q.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  session(s);
});

srv.listen(PORT, '127.0.0.1', () => console.log(`Workspace X: http://localhost:${PORT}\nTrong ứng dụng gõ: bridge connect ${TOKEN}`));
