#!/usr/bin/env python3
"""Vá app/src/main/AndroidManifest.xml của fork termux-app (chạy nhiều lần vẫn an toàn):
  + WorkspaceActivity (thêm biểu tượng "Workspace X" cạnh Termux)
  + quyền MANAGE_EXTERNAL_STORAGE (cầu tệp WXFS)
  + usesCleartextTraffic (WebView nối ws://127.0.0.1 tới bridge; targetSdk 28 mặc định chặn http/ws)
Dùng ở gốc repo: python patch_manifest.py"""
import pathlib
import re

man = pathlib.Path('app/src/main/AndroidManifest.xml')
x = man.read_text(encoding='utf-8')

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
        raise SystemExit('LỖI: không thấy </application> trong AndroidManifest.xml')
    x = x[:i] + act + '    ' + x[i:]

if 'android:usesCleartextTraffic' in x:
    x = x.replace('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"')
else:
    x, n = re.subn(r'<application\b', '<application android:usesCleartextTraffic="true"', x, count=1)
    if not n:
        raise SystemExit('LỖI: không thấy thẻ <application>')

perms = ''.join('    <uses-permission android:name="android.permission.%s" />\n' % p
                for p in ('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE')
                if 'android.permission.%s"' % p not in x)
if perms:
    m = re.search(r'[ \t]*<application\b', x)
    x = x[:m.start()] + perms + x[m.start():]

man.write_text(x, encoding='utf-8')
print('OK -> AndroidManifest.xml đã vá')
