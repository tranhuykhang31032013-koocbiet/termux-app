#!/usr/bin/env python3
"""Gộp index.html + css + js thành dist/index.html (1 tệp, chạy offline trong APK/WebView).  Dùng: python build.py"""
import pathlib
import re

root = pathlib.Path(__file__).parent
read = lambda p: (root / p).read_text(encoding='utf-8')
html = read('index.html')
html = re.sub(r'<link rel="stylesheet" href="\./([^"]+)">', lambda m: '<style>' + read(m[1]) + '</style>', html)
html = re.sub(r'<script src="\./([^"]+)"></script>', lambda m: '<script>' + read(m[1]).replace('</script', '<\\/script') + '</script>', html)
left = re.findall(r'<link[^>]+stylesheet[^>]*>|<script[^>]+src=[^>]*>', html)
if left:
    raise SystemExit('Chưa gộp được (sai định dạng thẻ): ' + ' '.join(left))
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'index.html').write_text(html, encoding='utf-8')
print('OK → dist/index.html', len(html) // 1024, 'KB')
