#!/usr/bin/env python3
"""Gộp index.html + css + js thành 1 tệp rồi đặt vào assets của app Termux (fork), kèm termux-bridge.js.
Chạy ở gốc repo, TRƯỚC khi build Gradle.  Dùng: python build.py"""
import pathlib
import re
import shutil

root = pathlib.Path(__file__).parent
read = lambda p: (root / p).read_text(encoding='utf-8')
html = read('index.html')
html = re.sub(r'<link rel="stylesheet" href="\./([^"]+)">', lambda m: '<style>' + read(m[1]) + '</style>', html)
html = re.sub(r'<script src="\./([^"]+)"></script>', lambda m: '<script>' + read(m[1]).replace('</script', '<\\/script') + '</script>', html)
left = re.findall(r'<link[^>]+stylesheet[^>]*>|<script[^>]+src=[^>]*>', html)
if left:
    raise SystemExit('Chưa gộp được (sai định dạng thẻ): ' + ' '.join(left))

out = root / 'app' / 'src' / 'main' / 'assets' / 'workspace'
out.mkdir(parents=True, exist_ok=True)
(out / 'index.html').write_text(html, encoding='utf-8')

bridge = root / 'termux-bridge.js'
if not bridge.exists():
    raise SystemExit('LỖI: không thấy termux-bridge.js ở gốc repo')
shutil.copyfile(bridge, out / 'termux-bridge.js')
print('OK ->', out, '(index.html', len(html) // 1024, 'KB + termux-bridge.js)')
