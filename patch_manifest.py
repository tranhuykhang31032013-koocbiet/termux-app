#!/usr/bin/env python3
"""Vá app/src/main/AndroidManifest.xml của fork termux-app (chạy nhiều lần vẫn an toàn).
  + WorkspaceActivity = MÀN HÌNH KHỞI ĐỘNG DUY NHẤT (TermuxActivity không còn biểu tượng riêng)
  + tên app "Workspace X" + biểu tượng ic_workspace
  + quyền MANAGE_EXTERNAL_STORAGE (cầu tệp WXFS)
  + usesCleartextTraffic (WebView nối ws://127.0.0.1 tới bridge; targetSdk 28 mặc định chặn http/ws)
Dùng ở gốc repo: python patch_manifest.py"""
import pathlib
import re

APP = 'Workspace X'
need = [
    'app/src/main/java/com/termux/app/WorkspaceActivity.java',
    'app/src/main/java/com/termux/app/WXFS.java',
    'app/src/main/res/mipmap-xxxhdpi/ic_workspace.png',
]
miss = [p for p in need if not pathlib.Path(p).exists()]
if miss:
    raise SystemExit('LỖI: thiếu tệp (chưa tải lên đúng chỗ?):\n  ' + '\n  '.join(miss))

man = pathlib.Path('app/src/main/AndroidManifest.xml')
x = man.read_text(encoding='utf-8')

# 1) Thẻ <application>: nhãn, biểu tượng, cleartext
m = re.search(r'<application\b[^>]*>', x, re.S)
if not m:
    raise SystemExit('LỖI: không thấy thẻ <application>')
tag = m[0]
def put(tag, name, val):
    pat = r'android:%s="[^"]*"' % name
    if re.search(pat, tag):
        return re.sub(pat, 'android:%s="%s"' % (name, val), tag)
    return tag.replace('<application', '<application android:%s="%s"' % (name, val), 1)
for k, v in (('label', APP), ('icon', '@mipmap/ic_workspace'), ('roundIcon', '@mipmap/ic_workspace'), ('usesCleartextTraffic', 'true')):
    tag = put(tag, k, v)
x = x[:m.start()] + tag + x[m.end():]

# 2) TermuxActivity bỏ LAUNCHER (vẫn mở được bằng Intent tường minh / thông báo)
t = re.search(r'<activity\b[^>]*android:name="(?:\.app|com\.termux\.app)\.TermuxActivity"[^>]*>.*?</activity>', x, re.S)
if t:
    blk = re.sub(r'[ \t]*<category\s+android:name="android\.intent\.category\.LAUNCHER"\s*/>[ \t]*\n?', '', t[0])
    x = x[:t.start()] + blk + x[t.end():]
    print('TermuxActivity: đã bỏ LAUNCHER' if blk != t[0] else 'TermuxActivity: không có LAUNCHER (bỏ qua)')
else:
    print('CẢNH BÁO: không thấy TermuxActivity trong manifest')

# 3) Thêm WorkspaceActivity làm LAUNCHER
if 'WorkspaceActivity' not in x:
    act = '''
        <activity
            android:name=".app.WorkspaceActivity"
            android:label="Workspace X"
            android:exported="true"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboard|keyboardHidden|uiMode|density"
            android:windowSoftInputMode="adjustResize"
            android:theme="@android:style/Theme.DeviceDefault.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
'''
    i = x.rfind('</application>')
    if i < 0:
        raise SystemExit('LỖI: không thấy </application>')
    x = x[:i] + act + '    ' + x[i:]

# 4) Quyền
perms = ''.join('    <uses-permission android:name="android.permission.%s" />\n' % p
                for p in ('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE')
                if 'android.permission.%s"' % p not in x)
if perms:
    m = re.search(r'[ \t]*<application\b', x)
    x = x[:m.start()] + perms + x[m.start():]

man.write_text(x, encoding='utf-8')
print('OK -> AndroidManifest.xml đã vá (launcher = Workspace X)')
