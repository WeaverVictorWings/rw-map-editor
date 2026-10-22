package app.placeholder;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

// 文件读写：系统“另存为”、授权一次的游戏地图文件夹（不需要存储权限）
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    // ---------- 另存为 ----------
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "map.tmx");
        String mime = call.getString("mime", "application/octet-stream");
        if (call.getString("data") == null) { call.reject("没有要保存的数据"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            os.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
            os.flush();
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    // ---------- 游戏地图文件夹 ----------
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderResult");
    }

    @ActivityCallback
    private void onFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { }
        String docId = DocumentsContract.getTreeDocumentId(tree);
        String name = docId.contains(":") ? docId.substring(docId.lastIndexOf(':') + 1) : docId;
        if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", name.isEmpty() ? "地图文件夹" : name);
        call.resolve(ret);
    }

    private Uri findChild(Uri tree, String name) {
        ContentResolver cr = getContext().getContentResolver();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = cr.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
            }
        }
        return null;
    }

    @PluginMethod
    public void writeToFolder(PluginCall call) {
        try {
            Uri tree = Uri.parse(call.getString("tree"));
            String name = call.getString("name");
            String mime = call.getString("mime", "application/octet-stream");
            Uri doc = findChild(tree, name);
            if (doc == null) {
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                doc = DocumentsContract.createDocument(getContext().getContentResolver(), parent, mime, name);
            }
            if (doc == null) { call.reject("无法在文件夹里创建文件"); return; }
            try (OutputStream os = getContext().getContentResolver().openOutputStream(doc, "wt")) {
                os.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
                os.flush();
            }
            JSObject ret = new JSObject();
            ret.put("uri", doc.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void listFolder(PluginCall call) {
        try {
            Uri tree = Uri.parse(call.getString("tree"));
            ContentResolver cr = getContext().getContentResolver();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            JSArray files = new JSArray();
            try (Cursor c = cr.query(children, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                if (c != null) while (c.moveToNext()) {
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(3))) continue;
                    JSObject f = new JSObject();
                    f.put("name", c.getString(0));
                    f.put("size", c.getLong(1));
                    f.put("modified", c.getLong(2));
                    files.put(f);
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void readFromFolder(PluginCall call) {
        try {
            Uri tree = Uri.parse(call.getString("tree"));
            Uri doc = findChild(tree, call.getString("name"));
            if (doc == null) { call.reject("文件不存在"); return; }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            try (InputStream is = getContext().getContentResolver().openInputStream(doc)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            }
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    private static String msg(Exception e) { return e.getMessage() == null ? e.toString() : e.getMessage(); }
}
