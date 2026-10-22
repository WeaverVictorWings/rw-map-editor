// 全局状态：编辑器、渲染器、当前文件、界面钩子
import { Editor } from './editor.js';
import { Renderer, Minimap } from './render.js';

const ed = new Editor();
const rend = new Renderer(document.getElementById('cv'), ed);
const mini = new Minimap(document.getElementById('mini'), rend);

export const A = {
  ed, rend, mini,
  mapName: '',
  fileHandle: null,
  handleName: '',
  autoDirty: false,
  savePromise: null,
  dockTab: 'tool',
  overlayKind: 'none',
  settings: { grid: true, dim: false, prune: false, autosaveSec: 30, symDiffKind: 'lr', poolStyle: '1x1', cover: true, coverSize: 400 },
  // 由各模块注册的界面刷新函数
  hooks: {},
  refresh(...what) { for (const w of what.length ? what : ['top', 'toolbar', 'dock', 'modes']) if (this.hooks[w]) this.hooks[w](); },
  isMobile() { return matchMedia('(max-width: 860px)').matches; },
};
