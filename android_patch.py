#!/usr/bin/env python3
"""Chạy SAU `npx cap add android`, TRƯỚC khi build Gradle: gắn cầu WXFS (đọc/ghi bộ nhớ thật, tác vụ nặng chạy nền) + quyền tệp + cầu WXT (tự bật termux-bridge.js trong Termux thật; cần termux-bridge.js ở thư mục chạy) vào APK.  Dùng: python android_patch.py"""
import base64
import pathlib
import re

src = pathlib.Path('android/app/src/main')
# Tìm file MainActivity.java trong dự án
act = next(src.glob('java/**/MainActivity.java'))
# Lấy tên package của dự án bạn
pkg = re.search(r'package\s+([\w.]+);', act.read_text(encoding='utf-8'))[1]

WXFS = r'''package PKG;

import android.os.StatFs;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Cầu tệp cho fm.js.
 *  Nhanh, đồng bộ: write · create · mkdir → '' nếu OK, lỗi thì trả thông báo · ls → JSON mảng, lỗi → {"e":...} · read (lỗi: bắt đầu bằng ký tự 0x01) · stat · disk.
 *  Nặng, chạy nền (1 luồng + hàng đợi): startCp / startMv / startRm → jobId · poll(id) → {state: queue|run|done|err|cancel|gone, done, total, cur, err} · cancel(id). */
public class WXFS {
  private static final class Job {
    final String id; volatile String state = "queue", cur = "", err = ""; volatile long done, total; volatile boolean cancel;
    Job(String id) { this.id = id; }
    void chk() throws IOException { if (cancel) throw new InterruptedIOException("Đã huỷ"); }
  }
  private interface Task { void run(Job j) throws Exception; }

  private final ExecutorService q = Executors.newSingleThreadExecutor();
  private final AtomicInteger seq = new AtomicInteger();
  private final Map<String, Job> jobs = Collections.synchronizedMap(new LinkedHashMap<String, Job>() {
    @Override protected boolean removeEldestEntry(Map.Entry<String, Job> e) { return size() > 64; }
  });

  private static String err(Throwable e) { return e.getMessage() == null ? e.toString() : e.getMessage(); }
  private static String fail(String m) { try { return new JSONObject().put("e", m).toString(); } catch (Exception e) { return "{\"e\":\"?\"}"; } }
  /** Symlink? (lstat không đi theo liên kết) */
  private static boolean link(File f) { try { return OsConstants.S_ISLNK(Os.lstat(f.getPath()).st_mode); } catch (Exception e) { return false; } }
  /** b nằm trong a? So theo đường dẫn chuẩn (đã giải symlink, "..", /sdcard → /storage/emulated/0). */
  private static boolean inside(File a, File b) throws IOException {
    String p = a.getCanonicalPath(), c = b.getCanonicalPath();
    return c.startsWith(p.endsWith("/") ? p : p + "/");
  }
  /** Lý do cụ thể khi không liệt kê được thư mục. */
  private static String why(File d) {
    if (!d.exists()) return "Không tồn tại: " + d.getName();
    if (!d.isDirectory()) return "Không phải thư mục: " + d.getName();
    try { Os.close(Os.open(d.getPath(), OsConstants.O_RDONLY, 0)); }
    catch (ErrnoException e) { if (e.errno == OsConstants.EACCES || e.errno == OsConstants.EPERM) return "Không có quyền đọc thư mục"; }
    return d.canRead() ? "Không đọc được thư mục" : "Không có quyền đọc thư mục";
  }

  // ── tác vụ nền: 1 luồng riêng, xếp hàng lần lượt ──
  private String start(Task t) {
    Job j = new Job(String.valueOf(seq.incrementAndGet()));
    jobs.put(j.id, j);
    q.execute(() -> {
      if (j.cancel) { j.err = "Đã huỷ"; j.state = "cancel"; return; }
      j.state = "run";
      try { t.run(j); j.state = "done"; }
      catch (InterruptedIOException e) { j.err = "Đã huỷ"; j.state = "cancel"; }
      catch (Throwable e) { j.err = err(e); j.state = "err"; }
    });
    return j.id;
  }
  /** Tổng cần xử lí để tính tiến độ: byte (chép) hoặc số mục (xoá). Không đi qua symlink. */
  private static long weigh(File f, boolean bytes, Job j) throws IOException {
    j.chk();
    long t = bytes ? 0 : 1;
    if (link(f)) return t;
    if (!f.isDirectory()) return bytes ? f.length() : t;
    File[] l = f.listFiles();
    if (l != null) for (File c : l) t += weigh(c, bytes, j);
    return t;
  }
  /** Xoá: symlink chỉ gỡ liên kết, không bao giờ đệ quy vào đích của nó. */
  private static void del(File f, Job j) throws IOException {
    j.chk(); j.cur = f.getName();
    if (!link(f) && f.isDirectory()) {
      File[] l = f.listFiles();
      if (l == null) throw new IOException("Không đọc được " + f.getName());
      for (File c : l) del(c, j);
    }
    if (!f.delete() && f.exists()) throw new IOException("Không xoá được " + f.getName());
    j.done++;
  }
  /** Chép: symlink được tạo lại như liên kết (không đệ quy); tệp ghi vào tệp tạm rồi rename → huỷ/lỗi giữa chừng không để lại tệp dở. */
  private static void copy(File a, File b, Job j) throws IOException {
    j.chk(); j.cur = a.getName();
    if (link(a)) {
      try { b.delete(); Os.symlink(Os.readlink(a.getPath()), b.getPath()); }
      catch (ErrnoException e) { throw new IOException("Không chép được liên kết " + a.getName() + ": " + e.getMessage()); }
    } else if (a.isDirectory()) {
      if (!b.isDirectory() && !b.mkdirs()) throw new IOException("Không tạo được " + b.getName());
      File[] l = a.listFiles();
      if (l == null) throw new IOException("Không đọc được " + a.getName());
      for (File f : l) copy(f, new File(b, f.getName()), j);
    } else {
      File d = b.getAbsoluteFile().getParentFile();
      d.mkdirs();
      File t = File.createTempFile(".wx", ".tmp", d);
      try {
        try (InputStream i = new FileInputStream(a); OutputStream o = new FileOutputStream(t)) {
          byte[] x = new byte[65536]; int n;
          while ((n = i.read(x)) > 0) { j.chk(); o.write(x, 0, n); j.done += n; }
        }
        t.setLastModified(a.lastModified());
        if (!t.renameTo(b)) throw new IOException("Không ghi được " + b.getName());
      } finally { t.delete(); }
    }
  }

  @JavascriptInterface public String startCp(String a, String b) {
    return start(j -> {
      File s = new File(a), d = new File(b);
      if (s.getCanonicalPath().equals(d.getCanonicalPath())) throw new IOException("Nguồn và đích trùng nhau");
      if (inside(s, d)) throw new IOException("Không thể chép thư mục vào chính nó");
      j.total = weigh(s, true, j); copy(s, d, j);
    });
  }
  @JavascriptInterface public String startMv(String a, String b) {
    return start(j -> {
      File s = new File(a), d = new File(b);
      if (d.exists()) throw new IOException("Đã tồn tại: " + d.getName());
      if (inside(s, d)) throw new IOException("Không thể chuyển thư mục vào chính nó");
      if (s.renameTo(d)) return;
      j.total = weigh(s, true, j); copy(s, d, j);
      try { del(s, j); } catch (InterruptedIOException e) { throw e; } catch (IOException e) { throw new IOException("Đã chép nhưng không xoá được bản gốc"); }
    });
  }
  /** json: mảng đường dẫn, vd ["/a/b","/a/c"] — cả lô là 1 tác vụ. */
  @JavascriptInterface public String startRm(String json) {
    return start(j -> {
      JSONArray a = new JSONArray(json); List<File> l = new ArrayList<>();
      for (int k = 0; k < a.length(); k++) l.add(new File(a.getString(k)));
      long t = 0; for (File f : l) t += weigh(f, false, j);
      j.total = t; for (File f : l) del(f, j);
    });
  }
  @JavascriptInterface public String poll(String id) {
    Job j = jobs.get(id);
    try {
      return j == null ? "{\"state\":\"gone\"}" : new JSONObject().put("state", j.state).put("done", j.done).put("total", j.total).put("cur", j.cur).put("err", j.err).toString();
    } catch (Exception e) { return "{\"state\":\"gone\"}"; }
  }
  @JavascriptInterface public boolean cancel(String id) { Job j = jobs.get(id); if (j != null) j.cancel = true; return j != null; }

  // ── nhanh, đồng bộ ──
  @JavascriptInterface public String ls(String p) {
    try {
      File d = new File(p);
      File[] l = d.listFiles();
      if (l == null) return fail(why(d));
      JSONArray r = new JSONArray();
      for (File f : l) {
        boolean dir, lnk = false; long sz, mt;
        try { // 1 lệnh stat/mục (thay vì 3) + nhận diện symlink
          StructStat st = Os.lstat(f.getPath());
          lnk = OsConstants.S_ISLNK(st.st_mode);
          if (lnk) { try { st = Os.stat(f.getPath()); } catch (ErrnoException e) { } }
          dir = OsConstants.S_ISDIR(st.st_mode); sz = dir ? 0L : st.st_size; mt = st.st_mtime * 1000L;
        } catch (Exception e) { dir = f.isDirectory(); sz = dir ? 0L : f.length(); mt = f.lastModified(); }
        r.put(new JSONObject().put("n", f.getName()).put("d", dir).put("s", sz).put("m", mt).put("l", lnk));
      }
      return r.toString();
    } catch (Exception e) { return fail(err(e)); }
  }
  @JavascriptInterface public String read(String p, int max) {
    try (InputStream i = new FileInputStream(p)) {
      ByteArrayOutputStream o = new ByteArrayOutputStream();
      byte[] x = new byte[65536]; int n, t = 0;
      while (t < max && (n = i.read(x, 0, Math.min(x.length, max - t))) > 0) { o.write(x, 0, n); t += n; }
      return o.toString("UTF-8");
    } catch (Exception e) { return "\u0001" + err(e); }
  }
  /** Ghi nguyên tử: tệp tạm cùng thư mục + fsync + rename (gián đoạn thì tệp cũ vẫn nguyên). */
  @JavascriptInterface public String write(String p, String t) {
    File f = new File(p).getAbsoluteFile(), tmp = null;
    try {
      if (f.isFile() && !f.canWrite()) return "Tệp chỉ đọc: " + f.getName();
      tmp = File.createTempFile(".wx", ".tmp", f.getParentFile());
      try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(t.getBytes("UTF-8")); try { o.getFD().sync(); } catch (IOException ignored) { } }
      if (!tmp.renameTo(f)) return "Không ghi được " + f.getName();
      tmp = null; return "";
    } catch (Exception e) { return err(e); }
    finally { if (tmp != null) tmp.delete(); }
  }
  /** Tạo tệp rỗng MỚI; đã có thì báo lỗi, không đụng vào nội dung cũ (O_EXCL). */
  @JavascriptInterface public String create(String p) {
    File f = new File(p);
    try { return f.createNewFile() ? "" : "Đã tồn tại: " + f.getName(); } catch (Exception e) { return err(e); }
  }
  @JavascriptInterface public String mkdir(String p) { File f = new File(p); return f.isDirectory() || f.mkdirs() ? "" : "Không tạo được thư mục"; }
  @JavascriptInterface public String stat(String p) {
    File f = new File(p);
    try { return new JSONObject().put("r", f.canRead()).put("w", f.canWrite()).put("x", f.canExecute()).toString(); } catch (Exception e) { return "null"; }
  }
  @JavascriptInterface public String disk() {
    try { StatFs s = new StatFs("/storage/emulated/0"); return new JSONObject().put("free", s.getAvailableBytes()).put("total", s.getTotalBytes()).toString(); } catch (Exception e) { return "null"; }
  }
}
'''

MAIN = r'''package PKG;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import java.math.BigInteger;
import java.security.SecureRandom;

public class MainActivity extends BridgeActivity {
  private boolean asked;
  private static final String RC = "com.termux.permission.RUN_COMMAND", BR = "@@B64@@";

  /** Cầu tới Termux thật (RUN_COMMAND). visible=false: chạy nền · true: mở phiên Termux tương tác */
  public class Tx {
    @JavascriptInterface public String token() { // token cố định của APK, bridge nhận qua TX_TOKEN
      SharedPreferences p = getSharedPreferences("wx", 0);
      String t = p.getString("tk", null);
      if (t == null) { byte[] b = new byte[16]; new SecureRandom().nextBytes(b); t = new BigInteger(1, b).toString(16); p.edit().putString("tk", t).apply(); }
      return t;
    }
    @JavascriptInterface public String start() { // ghi bridge vào thư mục riêng ~/.wx rồi chạy nền
      // GIỮ NGUYÊN GÓI COM.TERMUX: Đường dẫn được đặt cố định về /data/data/com.termux/files/usr/bin/bash
      return run("mkdir -p ~/.wx && echo " + BR + " | base64 -d > ~/.wx/bridge.js && TX_TOKEN=" + token() + " exec node ~/.wx/bridge.js", false);
    }
    @JavascriptInterface public String run(String cmd, boolean visible) { // "" = đã gửi, khác "" = lý do lỗi
      if (getPackageManager().getLaunchIntentForPackage("com.termux") == null) return "Chưa cài Termux (bản F-Droid/GitHub)";
      if (checkSelfPermission(RC) != PackageManager.PERMISSION_GRANTED) {
        runOnUiThread(() -> requestPermissions(new String[]{RC}, 2));
        return "Hãy cấp quyền \"Run commands in Termux\" rồi gõ lại: bridge connect";
      }
      try {
        // Gửi Intent tới com.termux chính thức
        return startService(new Intent("com.termux.RUN_COMMAND").setClassName("com.termux", "com.termux.app.RunCommandService")
          .putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
          .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", cmd})
          .putExtra("com.termux.RUN_COMMAND_BACKGROUND", !visible)
          .putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")) == null ? "Termux không nhận lệnh (cần Termux bản F-Droid/GitHub mới)" : "";
      } catch (Exception e) { return String.valueOf(e.getMessage()); }
    }
  }

  @Override public void onCreate(Bundle b) {
    super.onCreate(b);
    getBridge().getWebView().addJavascriptInterface(new WXFS(), "WXFS");
    getBridge().getWebView().addJavascriptInterface(new Tx(), "WXT");
  }

  @Override public void onResume() {
    super.onResume();
    boolean ok = Build.VERSION.SDK_INT >= 30 ? Environment.isExternalStorageManager()
        : checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    if (ok) { getBridge().getWebView().evaluateJavascript("typeof FM!=='undefined'&&FM.refresh()", null); return; }
    if (asked) return;
    asked = true;
    if (Build.VERSION.SDK_INT >= 30) {
      try { startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()))); }
      catch (Exception e) { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
    } else requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
  }
}
'''

man = src / 'AndroidManifest.xml'
x = man.read_text(encoding='utf-8')
for a in ('android:requestLegacyExternalStorage="true"', 'android:usesCleartextTraffic="true"'):
    if a.split('=')[0] not in x:
        x = x.replace('<application', '<application ' + a, 1)
# Bổ sung các quyền Storage và RUN_COMMAND
perms = ''.join(f'    <uses-permission android:name="android.permission.{p}" />\n' for p in ('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE') if p not in x)
if 'RUN_COMMAND' not in x:
    perms += '    <uses-permission android:name="com.termux.permission.RUN_COMMAND" />\n    <queries><package android:name="com.termux" /></queries>\n'
x = x.replace('<application', perms + '    <application', 1) if perms else x
man.write_text(x, encoding='utf-8')

(act.parent / 'WXFS.java').write_text(WXFS.replace('PKG', pkg), encoding='utf-8')

# Đảm bảo tệp termux-bridge.js tồn tại cùng thư mục với script này
try:
    b64 = base64.b64encode(pathlib.Path('termux-bridge.js').read_bytes()).decode()
except FileNotFoundError:
    print("LỖI: Không tìm thấy tệp termux-bridge.js trong thư mục hiện tại.")
    exit(1)

act.write_text(MAIN.replace('PKG', pkg).replace('@@B64@@', b64), encoding='utf-8')
print('OK → WXFS.java + MainActivity.java + AndroidManifest.xml (package ' + pkg + ')')
