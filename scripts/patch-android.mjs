// 在 `npx cap add android` 之后运行：加入“另存为”插件、注册插件、调整清单
import fs from 'fs';
import path from 'path';

const cfg = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
const pkg = cfg.appId;
const javaDir = path.join('android', 'app', 'src', 'main', 'java', ...pkg.split('.'));
fs.mkdirSync(javaDir, { recursive: true });

const plugin = fs.readFileSync('android-plugin/SaveFilePlugin.java', 'utf8').replace(/^package .*;/m, `package ${pkg};`);
fs.writeFileSync(path.join(javaDir, 'SaveFilePlugin.java'), plugin);

fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package ${pkg};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

const manifest = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
let m = fs.readFileSync(manifest, 'utf8');
if (!m.includes('android:largeHeap')) m = m.replace('<application', '<application\n        android:largeHeap="true"');
fs.writeFileSync(manifest, m);

// 不用打包工具时，把 Capacitor 的运行时脚本放进网页目录
const core = path.join('node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
if (fs.existsSync(core)) fs.copyFileSync(core, path.join('www', 'capacitor.js'));
else console.warn('未找到', core, '（依赖原生桥自带的 Capacitor 对象）');

console.log('安卓工程已调整：', javaDir);
