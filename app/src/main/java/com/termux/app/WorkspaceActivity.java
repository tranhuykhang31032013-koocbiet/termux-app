package com.termux.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.Gravity;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.util.Map;

/**
 * Workspace X chạy NGAY TRONG fork Termux (package com.termux, giữ nguyên).
 * - WebView nạp assets/workspace/index.html (do build.py tạo).
 * - WXFS: cầu tệp (WXFS.java).
 * - WXT : bật termux-bridge.js bằng Node của chính Termux này (không cần app Termux ngoài, không cần RUN_COMMAND).
 */
public class WorkspaceActivity extends Activity {
  private static final String FILES = "/data/data/com.termux/files", PREFIX = FILES + "/usr", HOME = FILES + "/home";
  private static Process bridge, installer; // static: sống tiếp khi Activity bị tạo lại
  private WebView web;
  private boolean asked;

  private static boolean ready() { return new File(PREFIX + "/bin/bash").exists(); }

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    if (ready()) { init(); return; }
    // Lần đầu: để TermuxActivity cài bootstrap. Bấm Back khi xong là quay lại đây và giao diện tự nạp (onResume).
    waiting();
    Toast.makeText(this, "Lần đầu: đang cài môi trường Termux. Xong bấm Back để vào Workspace X.", Toast.LENGTH_LONG).show();
    startActivity(new Intent(this, TermuxActivity.class));
  }

  private void waiting() {
    TextView t = new TextView(this);
    t.setText("Môi trường Termux chưa cài xong.\n\nChạm để mở trình cài đặt.");
    t.setTextColor(0xFFE6E8EB);
    t.setTextSize(16);
    t.setGravity(Gravity.CENTER);
    t.setBackgroundColor(0xFF0E1013);
    t.setOnClickListener(v -> startActivity(new Intent(this, TermuxActivity.class)));
    setContentView(t);
  }

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  private void init() {
    // Giữ tiến trình app sống khi chuyển nền (dịch vụ nền của chính Termux). Lỗi cũng không sao.
    try { startService(new Intent(this, TermuxService.class)); } catch (Exception ignored) { }

    web = new WebView(this);
    web.setBackgroundColor(0xFF0E1013);
    setContentView(web);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(true);
    if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
    web.setWebViewClient(new WebViewClient() {
      @SuppressWarnings("deprecation")
      @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
        if (url.startsWith("file:///android_asset/")) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
        return true; // liên kết ngoài mở bằng trình duyệt, WebView (có cầu tệp) chỉ nạp trang của mình
      }
    });
    web.addJavascriptInterface(new WXFS(), "WXFS");
    web.addJavascriptInterface(new Tx(), "WXT");
    web.loadUrl("file:///android_asset/workspace/index.html");
  }

  @Override protected void onResume() {
    super.onResume();
    if (web == null) { if (ready()) init(); else return; }
    boolean ok;
    if (Build.VERSION.SDK_INT >= 30) ok = Environment.isExternalStorageManager();
    else if (Build.VERSION.SDK_INT >= 23) ok = checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    else ok = true;
    if (ok) { web.evaluateJavascript("typeof FM!=='undefined'&&FM.refresh()", null); return; }
    if (asked) return;
    asked = true;
    if (Build.VERSION.SDK_INT >= 30) {
      try { startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()))); }
      catch (Exception e) { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
    } else if (Build.VERSION.SDK_INT >= 23) {
      requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
    }
  }

  @Override protected void onDestroy() {
    if (isFinishing() && alive(bridge)) bridge.destroy(); // thoát hẳn Workspace X → tắt bridge
    if (web != null) { web.destroy(); web = null; }
    super.onDestroy();
  }

  // ── Chạy lệnh bằng bash của Termux (cùng app nên chạy thẳng, không qua Intent) ──
  private static boolean alive(Process p) {
    if (p == null) return false;
    try { p.exitValue(); return false; } catch (IllegalThreadStateException e) { return true; }
  }

  private static Process launch(String cmd, String token) throws IOException {
    ProcessBuilder pb = new ProcessBuilder(PREFIX + "/bin/bash", "-c", cmd);
    Map<String, String> e = pb.environment();
    e.remove("LD_LIBRARY_PATH");
    e.remove("LD_PRELOAD");
    e.put("HOME", HOME);
    e.put("PREFIX", PREFIX);
    e.put("PATH", PREFIX + "/bin");
    e.put("TMPDIR", PREFIX + "/tmp");
    e.put("SHELL", PREFIX + "/bin/bash");
    e.put("LANG", "en_US.UTF-8");
    e.put("TERM", "xterm-256color");
    e.put("COLORTERM", "truecolor");
    for (String n : new String[]{"libtermux-exec-ld-preload.so", "libtermux-exec.so"}) { // termux-exec: sửa shebang /usr/bin/env…
      File f = new File(PREFIX + "/lib/" + n);
      if (f.exists()) { e.put("LD_PRELOAD", f.getPath()); break; }
    }
    if (token != null) e.put("TX_TOKEN", token);
    pb.directory(new File(HOME));
    pb.redirectErrorStream(true);
    Process p = pb.start();
    try { p.getOutputStream().close(); } catch (IOException ignored) { } // stdin đóng: không có lệnh nào chờ gõ
    return p;
  }

  private void copyAsset(String name, File dst) throws IOException {
    try (InputStream i = getAssets().open("workspace/" + name); OutputStream o = new FileOutputStream(dst)) {
      byte[] x = new byte[16384]; int n;
      while ((n = i.read(x)) > 0) o.write(x, 0, n);
    }
  }

  /** Cầu WXT cho api.js: token() · start() → "" nếu OK, khác "" = lý do lỗi · openTermux() mở terminal Termux đầy đủ. */
  public class Tx {
    @JavascriptInterface public String token() { // token cố định của app, bridge nhận qua TX_TOKEN
      SharedPreferences p = getSharedPreferences("wx", 0);
      String t = p.getString("tk", null);
      if (t == null) { byte[] r = new byte[16]; new SecureRandom().nextBytes(r); t = new BigInteger(1, r).toString(16); p.edit().putString("tk", t).apply(); }
      return t;
    }

    @JavascriptInterface public synchronized String start() {
      try {
        File d = new File(HOME, ".wx");
        d.mkdirs();
        if (!new File(PREFIX + "/bin/node").exists()) { // lần đầu: cài Node.js (nền, log ở ~/.wx/install.log)
          if (alive(installer)) return "Đang cài Node.js (vài phút, cần mạng). Xong gõ lại: bridge connect";
          installer = launch("exec >> ~/.wx/install.log 2>&1; pkg install -y nodejs", null);
          return "Bắt đầu cài Node.js (lần đầu, vài phút, cần mạng; log: ~/.wx/install.log). Xong gõ lại: bridge connect";
        }
        if (alive(bridge)) return "";
        copyAsset("termux-bridge.js", new File(d, "bridge.js"));
        bridge = launch("exec >> ~/.wx/bridge.log 2>&1; exec node ~/.wx/bridge.js", token());
        return "";
      } catch (Exception e) { return String.valueOf(e.getMessage()); }
    }

    @JavascriptInterface public void openTermux() { // terminal thật có PTY (vim, nano, python…)
      runOnUiThread(() -> startActivity(new Intent(WorkspaceActivity.this, TermuxActivity.class)));
    }
  }
}
