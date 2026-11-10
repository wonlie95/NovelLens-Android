package com.novellens.reader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONArray;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private static final int FILE_CHOOSER_REQUEST = 701;
    private final ExecutorService network = Executors.newFixedThreadPool(4);
    private TextToSpeech speech;
    private boolean speechReady = false, speaking = false, paused = false;
    private boolean speechInitialized = false;
    private String speechText = "", utterance = "";
    private volatile int spokenOffset = 0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDefaultTextEncodingName("UTF-8");
        s.setAllowFileAccess(true);
        // 允许本地页面读取同目录的离线注音词典。
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(false);
        // Bing 网页翻译的会话参数与 Cookie 必须由同一个应用会话保存。
        java.net.CookieHandler.setDefault(new java.net.CookieManager());
        speech = new TextToSpeech(this, status -> {
            speechInitialized = true;
            speechReady = status == TextToSpeech.SUCCESS;
            if (speechReady) speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { runOnUiThread(() -> { if (id.equals(utterance)) speaking = false; }); }
                @Override public void onError(String id) { runOnUiThread(() -> { if (id.equals(utterance)) speaking = false; }); }
                @Override public void onRangeStart(String id, int start, int end, int frame) { if (id.equals(utterance)) spokenOffset = start; }
            });
        });
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(Intent.createChooser(intent, "选择电子书文件"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooserCallback = null;
        }
    }

    @Override protected void onDestroy() {
        if (speech != null) { speech.stop(); speech.shutdown(); }
        network.shutdownNow();
        webView.destroy();
        super.onDestroy();
    }

    public class Bridge {
        @JavascriptInterface public void request(String requestJson, String id) {
            network.execute(() -> {
                HttpURLConnection c = null;
                try {
                    JSONObject request = new JSONObject(requestJson);
                    if ("speech".equals(request.optString("type"))) {
                        runOnUiThread(() -> handleSpeech(request, id));
                        return;
                    }
                    URL target = new URL(request.getString("url"));
                    String host = target.getHost();
                    if (!(host.equals("jisho.org") || host.equals("translate.googleapis.com") || host.equals("cn.bing.com") || host.equals("www.bing.com") || host.equals("api.mymemory.translated.net") || host.equals("lingva.ml") || host.equals("fanyi-api.baidu.com") || host.equals("api-free.deepl.com") || host.equals("api.deepl.com") || host.equals("api.cognitive.microsofttranslator.com"))) throw new SecurityException("不允许访问此地址");
                    c = (HttpURLConnection) target.openConnection();
                    c.setConnectTimeout(10000); c.setReadTimeout(15000);
                    c.setRequestProperty("User-Agent", "NovelLens/1.0 Android");
                    c.setRequestMethod(request.optString("method", "GET"));
                    JSONObject headers = request.optJSONObject("headers");
                    if (headers != null) {
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            c.setRequestProperty(key, headers.optString(key));
                        }
                    }
                    if (request.has("body") && !request.isNull("body")) {
                        byte[] bytes = request.getString("body").getBytes(StandardCharsets.UTF_8);
                        c.setDoOutput(true);
                        try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
                    }
                    int code = c.getResponseCode();
                    InputStream stream = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
                    if (stream == null) throw new IllegalStateException("HTTP " + code);
                    BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
                    StringBuilder body = new StringBuilder(); String line;
                    while ((line = br.readLine()) != null) body.append(line);
                    respond(id, code >= 200 && code < 300, body.toString(), code >= 200 && code < 300 ? "" : "HTTP " + code);
                } catch (Exception e) { respond(id, false, "", e.getMessage()); }
                finally { if (c != null) c.disconnect(); }
            });
        }
    }

    // Android 系统朗读没有原生暂停：记录引擎报告的当前位置，继续时从该位置重新播放。
    private void handleSpeech(JSONObject request, String id) {
        try {
            String action = request.optString("action");
            if ("voices".equals(action)) {
                // 语音引擎异步启动，等待初始化结束后再把可用语音返回界面。
                if (!speechInitialized) {
                    int attempts = request.optInt("_attempts", 0);
                    if (attempts < 20) {
                        request.put("_attempts", attempts + 1);
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> handleSpeech(request, id), 500);
                        return;
                    }
                }
                JSONArray voices = new JSONArray();
                if (speechReady && speech.getVoices() != null) for (Voice voice : speech.getVoices()) {
                    if ("ja".equals(voice.getLocale().getLanguage()) && !voice.isNetworkConnectionRequired())
                        voices.put(new JSONObject().put("id", voice.getName()).put("name", voice.getName()));
                }
                respond(id, true, voices.toString(), ""); return;
            }
            if (!speechReady) throw new IllegalStateException("语音引擎尚未准备好，请安装日语语音包");
            if ("speak".equals(action)) {
                Voice selected = null;
                for (Voice voice : speech.getVoices()) if (voice.getName().equals(request.optString("voice")) && "ja".equals(voice.getLocale().getLanguage())) selected = voice;
                if (selected == null) throw new IllegalStateException("请安装并选择日语语音包");
                speech.stop(); speech.setVoice(selected); speech.setSpeechRate((float)request.optDouble("rate", 1));
                speechText = request.optString("text"); spokenOffset = 0; paused = false; speaking = true;
                utterance = java.util.UUID.randomUUID().toString();
                if (speech.speak(speechText, TextToSpeech.QUEUE_FLUSH, null, utterance) == TextToSpeech.ERROR) throw new IllegalStateException("语音引擎无法朗读");
            } else if ("pause".equals(action)) {
                paused = true; speaking = false; utterance = ""; speech.stop();
            } else if ("resume".equals(action)) {
                String remaining = speechText.substring(Math.min(spokenOffset, speechText.length()));
                speechText = remaining; spokenOffset = 0; paused = false; speaking = true;
                utterance = java.util.UUID.randomUUID().toString();
                if (speech.speak(remaining, TextToSpeech.QUEUE_FLUSH, null, utterance) == TextToSpeech.ERROR) throw new IllegalStateException("语音引擎无法继续朗读");
            } else if ("stop".equals(action)) {
                utterance = ""; speech.stop(); paused = false; speaking = false;
            }
            respond(id, true, new JSONObject().put("speaking", speaking).put("paused", paused).toString(), "");
        } catch (Exception e) { respond(id, false, "", e.getMessage()); }
    }

    private void respond(String id, boolean ok, String body, String error) {
        try {
            String js = "window.hostResponse(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(body) + "," + JSONObject.quote(error == null ? "网络请求失败" : error) + ")";
            runOnUiThread(() -> webView.evaluateJavascript(js, null));
        } catch (Exception ignored) { }
    }
}
