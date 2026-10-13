// ==UserScript==
// @name         网页内视频全屏（In-Page Video Fullscreen）
// @namespace    http://tampermonkey.net/zhuyi
// @version      0.1.9
// @description  悬停任意网页视频并按下热键，将其放大到浏览器视口内全屏（非系统/原生全屏）。再次按热键或 Esc 退出。
// @author       zhuyi
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// 说明：如需用 gist 自动更新，请在上方 metadata 区域添加 @downloadURL 和 @updateURL 并指向真实 raw 地址。
// 若已开启 Tampermonkey 同步，则无需 gist，脚本会自动多机同步。

(function () {
  'use strict';

  // ===== 可配置项 =====
  // 热键：用物理键位 e.code 触发（不受中文输入法影响）。
  // 推荐 'KeyV'（单按 V）——YouTube/B站/Netflix 等主流视频站不占用，单手可按。
  // 想完全避免冲突可改用组合键：'KeyV' + 检测 e.altKey 等，具体见 keydown 处理。
  // 备选（改下面这一行即可）：
  //   标点键（冲突最少）：'Backquote' 反引号 ` / 'Backslash' 反斜杠 \ / 'Semicolon' 分号 ;
  //   单字母（谨慎）：'KeyG'、'KeyU'、'KeyP' 等也可能被某些站点占用。
  const HOTKEY_CODE = 'KeyV';
  const HOTKEY_CHAR = 'v'; // 与上面 code 对应的字符，作为备用匹配

  // 非 YouTube 的简单播放器（微博 / B站网页端等）是否走 transform 容器方案（保留站点原生控制条）。
  // true：用 transform:scale 放大播放器容器，保留原生控制条（微博等简单站点有效）。
  // false：一律走 captureStream 镜像方案（浏览器默认控制条，通用但丢失站点原生控制条）。
  // 注：YouTube 因 transform 会黑屏，已强制走镜像方案，不受此项影响。
  const SIMPLE_SITE_USE_TRANSFORM = true;

  function isYouTube() {
    return location.hostname.includes('youtube.com') || location.hostname.includes('youtu.be');
  }

  // 启动诊断：Console 日志 + 页面右上角绿色小点（3 秒后淡出），
  // 用于确认脚本确实已注入，不用每次开 F12。
  // eslint-disable-next-line no-console
  console.log('[ipvf] loaded, hotkey code:', HOTKEY_CODE, 'char:', HOTKEY_CHAR);

  (function showLoadIndicator() {
    if (!document.body) return;
    const dot = document.createElement('div');
    dot.id = 'ipvf-load-indicator';
    dot.style.cssText =
      'position:fixed;top:8px;right:8px;width:10px;height:10px;' +
      'border-radius:50%;background:#00e676;z-index:2147483647;' +
      'box-shadow:0 0 4px rgba(0,230,118,0.8);pointer-events:none;' +
      'transition:opacity 1s ease-out;opacity:1;';
    document.body.appendChild(dot);
    setTimeout(() => { dot.style.opacity = '0'; }, 2500);
    setTimeout(() => { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 3600);
  })();

  // ===== 运行时状态 =====
  let mouseX = 0;
  let mouseY = 0;
  let activeVideo = null; // 当前处于网页内全屏的视频
  let activeContainer = null; // 容器放大方案中被放大的播放器容器
  let mirrorVideo = null; // 镜像方案中用于显示画面的独立 video
  let mirrorCleanup = null; // 镜像方案的事件清理函数
  let sourceMutedOriginal = null; // 进入镜像方案前原 video 的 muted 状态
  let activeMode = null; // 'transform' | 'mirror' | 'container'
  let lastHoverVideo = null; // 最近悬停过的视频（按钮点击时备用）
  let ipvfBtn = null; // 悬浮"网页全屏"按钮
  let backdrop = null; // 盖住页面其余内容的黑色遮罩

  // 记录鼠标位置，热键/按钮触发时用于定位"鼠标下的视频"
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updateButton();
  }, true);

  // 创建/返回悬浮按钮；点击即触发或退出网页内全屏，无需快捷键
  function ensureButton() {
    if (ipvfBtn) return ipvfBtn;
    ipvfBtn = document.createElement('div');
    ipvfBtn.id = 'ipvf-btn';
    ipvfBtn.style.cssText =
      'position:fixed;z-index:2147483648;display:none;padding:5px 12px;' +
      'background:rgba(0,0,0,0.72);color:#fff;font-size:13px;line-height:1;' +
      'border-radius:5px;cursor:pointer;font-family:sans-serif;user-select:none;' +
      'box-shadow:0 1px 4px rgba(0,0,0,0.4);';
    ipvfBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeVideo) {
        exitFullscreen();
      } else {
        const v = lastHoverVideo || findVideoAtPoint(mouseX, mouseY);
        if (v) { activeVideo = v; applyFullscreen(v); }
      }
      updateButton();
    });
    document.documentElement.appendChild(ipvfBtn);
    return ipvfBtn;
  }

  // 根据当前状态更新按钮：全屏中显示"退出"；悬停视频显示"网页全屏"；否则隐藏
  function updateButton() {
    const btn = ensureButton();
    if (activeVideo) {
      btn.textContent = '退出网页全屏';
      btn.style.display = 'block';
      btn.style.top = '12px';
      btn.style.left = '50%';
      btn.style.transform = 'translateX(-50%)';
      return;
    }
    const v = findVideoAtPoint(mouseX, mouseY);
    if (v) {
      lastHoverVideo = v;
      const r = v.getBoundingClientRect();
      btn.textContent = '网页全屏';
      btn.style.display = 'block';
      btn.style.transform = 'none';
      btn.style.top = (r.top + 8) + 'px';
      btn.style.left = Math.max(8, r.right - 78) + 'px';
    } else {
      btn.style.display = 'none';
    }
  }

  // 通过坐标找到鼠标所在视频：遍历所有 <video>，用包围盒判断哪个包含鼠标坐标。
  // 不依赖 elementFromPoint 的祖先链——YouTube/B站 的 <video> 与控制条/遮罩是兄弟节点，
  // 悬停处最上层若是遮罩，closest('video') 会找不到，故改用矩形命中检测。
  function findVideoAtPoint(x, y) {
    const videos = document.querySelectorAll('video');
    let best = null;
    let bestArea = Infinity;
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const area = r.width * r.height;
        if (area < bestArea) { best = v; bestArea = area; }
      }
    }
    return best;
  }

  // 识别播放器容器：对 YouTube 等特殊播放器，应整体放大容器而非单独移动 <video>，
  // 否则 MSE/Shadow DOM 渲染上下文被破坏会出现黑屏（有声音无画面）。
  function getPlayerContainer(video) {
    // YouTube：最外层播放器容器 #movie_player 或 .html5-video-player
    const yt = video.closest('#movie_player') || video.closest('.html5-video-player');
    if (yt) return yt;

    // 通用启发式：向上找尺寸与视频接近（±60%）、且不是 body/html 的祖先容器
    let el = video.parentElement;
    const vr = video.getBoundingClientRect();
    for (let i = 0; el && i < 6; i++) {
      if (el === document.body || el === document.documentElement) break;
      const er = el.getBoundingClientRect();
      const wRatio = er.width / (vr.width || 1);
      const hRatio = er.height / (vr.height || 1);
      if (wRatio >= 0.9 && wRatio <= 1.6 && hRatio >= 0.9 && hRatio <= 1.6) {
        return el;
      }
      el = el.parentElement;
    }
    return video;
  }

  // 用 transform:scale 视觉放大播放器容器，保留原生控制条。
  // 关键：只改 transform/position，不改变内部 video 的 layout 尺寸与 DOM，
  // 避免触发站点播放器重绘（之前覆盖 width/height 为 100vw 会导致黑屏）。
  function applyTransformToPlayer(player) {
    const rect = player.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;

    const sx = window.innerWidth / rect.width;
    const sy = window.innerHeight / rect.height;
    const offsetX = rect.left;
    const offsetY = rect.top;

    player.__ipvf_original_style = player.getAttribute('style') || '';

    // fixed 脱离文档流，避免被祖先 overflow 裁剪；transform 仅视觉放大，不改变 layout 尺寸
    player.style.position = 'fixed';
    player.style.top = '0';
    player.style.left = '0';
    player.style.width = rect.width + 'px';
    player.style.height = rect.height + 'px';
    player.style.margin = '0';
    player.style.transformOrigin = '0 0';
    player.style.transform =
      'translate(' + (-offsetX) + 'px,' + (-offsetY) + 'px) scale(' + sx + ',' + sy + ')';
    player.style.zIndex = '2147483647';
    player.style.background = '#000';
    return true;
  }

  // 尝试用 captureStream 创建镜像 video：不移动/不修改原 video，仅取它的 MediaStream
  // 显示到一个独立的新 video 上，从而绕过 YouTube 等站点移动 video 后黑屏的问题。
  function createMirrorVideo(source) {
    if (typeof source.captureStream !== 'function') return null;
    if (source.readyState < 2) return null; // HAVE_CURRENT_DATA 以下无法稳定捕获
    try {
      const stream = source.captureStream();
      const mirror = document.createElement('video');
      mirror.srcObject = stream;
      mirror.autoplay = true;
      mirror.muted = false; // 音频从镜像出；进入前会把原 video 静音，避免双重音轨
      mirror.playsInline = true;
      mirror.controls = true;
      mirror.style.cssText =
        'position:fixed;left:0;top:0;width:100vw;height:100vh;' +
        'object-fit:contain;z-index:2147483647;background:#000;';
      return { mirror, stream };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[ipvf] captureStream failed:', err);
      return null;
    }
  }

  // 把 mirror 的播放控制反向同步给原 video，让用户在全屏界面操作的就是原视频
  function bindMirrorControls(mirror, source) {
    const handlers = [];
    const add = (type, fn) => {
      mirror.addEventListener(type, fn);
      handlers.push(() => mirror.removeEventListener(type, fn));
    };
    add('play', () => { try { source.play(); } catch {} });
    add('pause', () => { try { source.pause(); } catch {} });
    add('seeking', () => { source.currentTime = mirror.currentTime; });
    add('volumechange', () => {
      source.volume = mirror.volume;
      source.muted = mirror.muted;
    });
    return () => handlers.forEach((h) => h());
  }

  // 进入网页内全屏：优先镜像方案（不碰原 video），失败则 fallback 容器放大方案
  function applyFullscreen(video) {
    // 若页面已处于原生全屏（如其他脚本抢先触发），先退出，避免叠影
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    activeVideo = video;

    // 锁定页面滚动
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // 黑色遮罩盖住页面其余内容
    backdrop = document.createElement('div');
    backdrop.style.cssText =
      'position:fixed;inset:0;background:#000;opacity:0.96;z-index:2147483646;';
    document.documentElement.appendChild(backdrop);

    // 方案 0：transform 容器方案（保留原生控制条），仅用于非 YouTube 的简单播放器
    // （YouTube 用 transform 会黑屏，故 YouTube 一律走下方镜像方案）
    if (!isYouTube() && SIMPLE_SITE_USE_TRANSFORM) {
      const container = getPlayerContainer(video);
      if (container && container !== video && applyTransformToPlayer(container)) {
        activeMode = 'transform';
        activeContainer = container;
        // eslint-disable-next-line no-console
        console.log('[ipvf] using transform mode (native controls)');
        return;
      }
    }

    // 方案 A：镜像方案（对 YouTube/B站等复杂播放器最稳）
    const mirrorInfo = createMirrorVideo(video);
    if (mirrorInfo) {
      activeMode = 'mirror';
      mirrorVideo = mirrorInfo.mirror;
      // 进入镜像方案时：让原 video 静音，声音只从 mirror 出，彻底避免回声
      sourceMutedOriginal = video.muted;
      video.muted = true;
      document.documentElement.appendChild(mirrorVideo);
      mirrorCleanup = bindMirrorControls(mirrorVideo, video);
      // eslint-disable-next-line no-console
      console.log('[ipvf] using mirror mode');
      return;
    }

    // 方案 B：容器放大方案（fallback，适用于不支持 captureStream 的站点）
    activeMode = 'container';
    const container = getPlayerContainer(video);
    activeContainer = container;

    video.__ipvf_original_style = video.getAttribute('style') || '';
    container.__ipvf_original_style = container.getAttribute('style') || '';

    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.margin = '0';
    container.style.padding = '0';
    container.style.border = 'none';
    container.style.zIndex = '2147483647';
    container.style.background = '#000';

    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.maxWidth = '100%';
    video.style.maxHeight = '100%';
    video.controls = true;
    // eslint-disable-next-line no-console
    console.log('[ipvf] using container mode');
  }

  // 退出网页内全屏，还原所有状态
  function exitFullscreen() {
    if (activeMode === 'transform') {
      if (activeContainer) {
        activeContainer.setAttribute('style', activeContainer.__ipvf_original_style);
        delete activeContainer.__ipvf_original_style;
      }
      activeContainer = null;
    } else if (activeMode === 'mirror') {
      if (mirrorCleanup) { mirrorCleanup(); mirrorCleanup = null; }
      if (mirrorVideo) {
        try { mirrorVideo.pause(); } catch {}
        mirrorVideo.srcObject = null;
        if (mirrorVideo.parentNode) mirrorVideo.parentNode.removeChild(mirrorVideo);
        mirrorVideo = null;
      }
      // 恢复原始音频状态
      if (activeVideo && sourceMutedOriginal !== null) {
        activeVideo.muted = sourceMutedOriginal;
        sourceMutedOriginal = null;
      }
    } else if (activeMode === 'container') {
      if (activeVideo) {
        activeVideo.setAttribute('style', activeVideo.__ipvf_original_style);
        delete activeVideo.__ipvf_original_style;
      }
      if (activeContainer) {
        activeContainer.setAttribute('style', activeContainer.__ipvf_original_style);
        delete activeContainer.__ipvf_original_style;
      }
      activeContainer = null;
    }

    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
    backdrop = null;

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    activeVideo = null;
    activeMode = null;
    updateButton();
  }

  // 切换逻辑：仅对鼠标下的视频生效；已全屏则退出；切换目标先退出旧的
  function toggle() {
    const video = findVideoAtPoint(mouseX, mouseY);
    if (!video) return; // 鼠标下无视频则不动作（防止误触退出）
    if (activeVideo === video) {
      exitFullscreen();
    } else {
      if (activeVideo) exitFullscreen();
      activeVideo = video;
      applyFullscreen(video);
      updateButton();
    }
  }

  // 全局热键：V 切换，Esc 退出；输入框内不触发。
  // 监听 window capture 阶段，配合 stopImmediatePropagation 阻止站点监听器继续执行
  //（preventDefault 只拦浏览器默认行为，拦不住 JS 监听器）。
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    const isHotkey = (e.code === HOTKEY_CODE || e.key === HOTKEY_CHAR) && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (isHotkey) {
      // eslint-disable-next-line no-console
      console.log('[ipvf] hotkey', HOTKEY_CODE, 'matched; active=', !!activeVideo);
      // 若当前已在网页内全屏，V 优先退出并吃掉事件
      if (activeVideo) {
        e.preventDefault();
        e.stopImmediatePropagation();
        exitFullscreen();
        return;
      }
      const video = findVideoAtPoint(mouseX, mouseY);
      // eslint-disable-next-line no-console
      console.log('[ipvf] findVideoAtPoint result:', video);
      if (video) {
        e.preventDefault();
        e.stopImmediatePropagation();
        activeVideo = video;
        applyFullscreen(video);
        updateButton();
      }
    } else if (e.key === 'Escape' && activeVideo) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exitFullscreen();
    }
  }, true);
})();
