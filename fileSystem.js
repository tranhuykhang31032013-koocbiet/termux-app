const files = new Map(); // đường dẫn → File
const SKIP = /(^|\/)(\.git|node_modules)(\/|$)/;
const BIN = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|rar|mp[34]|mkv|woff2?|ttf|otf|exe|dll|so|apk|class|jar)$/i;

const isBinary = name => BIN.test(name);
const clearFiles = () => files.clear();

function addFile(file, path = file.webkitRelativePath || file.name) {
  path = path.split('/').filter(s => s && s !== '.' && s !== '..').join('/'); // chặn ../ (Zip Slip)
  if (path && !SKIP.test(path)) files.set(path, file);
}
// .zip được giải nén thành thư mục (WebView của APK thường không chọn được thư mục)
const addAny = async f => { if (/\.zip$/i.test(f.name)) for (const [p, x] of await unzip(f)) addFile(x, p); else addFile(f); };
const addList = async list => { for (const f of [...list]) await addAny(f); };
const addText = (name, text) => addFile(new File([text], name, { type: 'text/plain' }), name);

async function walk(entry, base = '') {
  if (entry.isFile) return addFile(await new Promise((ok, no) => entry.file(ok, no)), base + entry.name);
  if (SKIP.test(base + entry.name)) return;
  const reader = entry.createReader();
  let batch;
  do {
    batch = await new Promise((ok, no) => reader.readEntries(ok, no));
    for (const e of batch) await walk(e, base + entry.name + '/');
  } while (batch.length);
}

// Phải gọi webkitGetAsEntry đồng bộ trước mọi await (items hết hạn sau sự kiện drop)
async function addDrop(items) {
  const list = [...items].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.() ?? i.getAsFile());
  for (const e of list) e instanceof File ? await addAny(e) : e && await walk(e);
}

function buildTree() {
  const root = {};
  for (const p of files.keys()) {
    const parts = p.split('/');
    let n = root;
    parts.forEach((s, i) => { if (i < parts.length - 1) n = n[s] ??= {}; else n[s] = p; });
  }
  return root;
}

async function unzip(file) { // đọc .zip bằng DecompressionStream (WebView/Chrome ≥ 103)
  const u = new Uint8Array(await file.arrayBuffer()), v = new DataView(u.buffer), td = new TextDecoder(), out = [];
  let e = u.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('không phải tệp zip');
  let n = v.getUint16(e + 10, true), p = v.getUint32(e + 16, true);
  while (n--) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
    const name = td.decode(u.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/');
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    if (name.endsWith('/') || SKIP.test(name)) continue;
    const s = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), raw = new Blob([u.subarray(s, s + size)]);
    const data = method ? await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob() : raw;
    out.push([name, new File([data], name.split('/').pop())]);
  }
  return out;
}
