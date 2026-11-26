(function () {
  const ns = (globalThis.__PureClip = globalThis.__PureClip || {});
  if (ns.pickerLoaded) return;
  ns.pickerLoaded = true;

  const HOST_ID = 'pureclip-picker-host';
  let activeSession = null;

  function stopPicker() {
    if (!activeSession) return;
    const { onMouseMove, onClick, onKeyDown, host, rafId } = activeSession;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    activeSession = null;
  }

  function startPicker({ onConfirm, onCancel }) {
    stopPicker();

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .pc-hover-box {
        position: fixed;
        border: 2px solid #0f766e;
        background: rgba(15, 118, 110, 0.12);
        border-radius: 4px;
        pointer-events: none;
        transition: all 60ms ease-out;
        display: none;
      }
      .pc-selected-box {
        position: fixed;
        border: 2px dashed #d97706;
        background: rgba(217, 119, 6, 0.12);
        border-radius: 4px;
        pointer-events: none;
      }
      .pc-hud {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: #18181b;
        color: #f4f4f5;
        border: 1px solid #3f3f46;
        border-radius: 999px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.35);
        font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
        font-size: 13px;
        pointer-events: auto;
        user-select: none;
      }
      .pc-hud button {
        border: 1px solid #52525b;
        background: #27272a;
        color: #f4f4f5;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .pc-hud button:hover { background: #3f3f46; }
      .pc-hud button.primary {
        background: #0f766e;
        border-color: #0f766e;
        color: #ffffff;
        font-weight: 600;
      }
      .pc-hud button.primary:hover { background: #0d9488; }
      .pc-count { color: #5eead4; font-weight: 600; }
    `;

    const hoverBox = document.createElement('div');
    hoverBox.className = 'pc-hover-box';

    const selectedLayer = document.createElement('div');

    const hud = document.createElement('div');
    hud.className = 'pc-hud';
    hud.innerHTML = `
      <span>点击瞄准区块（Shift 多选）</span>
      <span class="pc-count" id="pc-sel-count">已选 0 块</span>
      <button type="button" id="pc-expand" title="快捷键 ↑">↑ 扩大范围</button>
      <button type="button" id="pc-narrow" title="快捷键 ↓">↓ 缩小范围</button>
      <button type="button" id="pc-done" class="primary">完成提取</button>
      <button type="button" id="pc-cancel">取消 (Esc)</button>
    `;

    shadow.append(style, selectedLayer, hoverBox, hud);
    document.documentElement.appendChild(host);

    const countEl = shadow.getElementById('pc-sel-count');
    let hoveredEl = null;
    const selectedEls = [];
    let pendingPoint = null;
    let rafId = 0;

    function updateBoxes() {
      if (hoveredEl && hoveredEl.isConnected) {
        const rect = hoveredEl.getBoundingClientRect();
        hoverBox.style.display = 'block';
        hoverBox.style.top = `${rect.top}px`;
        hoverBox.style.left = `${rect.left}px`;
        hoverBox.style.width = `${rect.width}px`;
        hoverBox.style.height = `${rect.height}px`;
      } else {
        hoverBox.style.display = 'none';
      }

      selectedLayer.innerHTML = '';
      for (const el of selectedEls) {
        if (!el.isConnected) continue;
        const rect = el.getBoundingClientRect();
        const box = document.createElement('div');
        box.className = 'pc-selected-box';
        box.style.top = `${rect.top}px`;
        box.style.left = `${rect.left}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        selectedLayer.appendChild(box);
      }
      countEl.textContent = `已选 ${selectedEls.length} 块`;
    }

    function expandSelection() {
      const target = selectedEls[selectedEls.length - 1] || hoveredEl;
      if (target && target.parentElement && target.parentElement !== document.documentElement) {
        const next = target.parentElement;
        if (selectedEls.length > 0) {
          selectedEls[selectedEls.length - 1] = next;
        }
        hoveredEl = next;
        updateBoxes();
      }
    }

    function narrowSelection() {
      const target = selectedEls[selectedEls.length - 1] || hoveredEl;
      if (!target) return;
      const candidate = Array.from(target.children).find(
        (c) => (c.textContent || '').trim().length > 20 || c.querySelector('img, p, pre')
      );
      if (candidate) {
        if (selectedEls.length > 0) {
          selectedEls[selectedEls.length - 1] = candidate;
        }
        hoveredEl = candidate;
        updateBoxes();
      }
    }

    function finishSelection() {
      const result = selectedEls.length > 0 ? [...selectedEls] : hoveredEl ? [hoveredEl] : [];
      stopPicker();
      if (result.length > 0) {
        onConfirm(result);
      } else {
        onCancel();
      }
    }

    function onMouseMove(e) {
      if (e.target === host) return;
      pendingPoint = { x: e.clientX, y: e.clientY };
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!pendingPoint) return;
        const el = document.elementFromPoint(pendingPoint.x, pendingPoint.y);
        if (el && el !== host && !host.contains(el) && el !== document.documentElement) {
          hoveredEl = el;
          updateBoxes();
        }
      });
      if (activeSession) activeSession.rafId = rafId;
    }

    function onClick(e) {
      if (e.target === host || host.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      if (!hoveredEl) return;
      if (e.shiftKey) {
        const idx = selectedEls.indexOf(hoveredEl);
        if (idx >= 0) selectedEls.splice(idx, 1);
        else selectedEls.push(hoveredEl);
        updateBoxes();
      } else {
        selectedEls.length = 0;
        selectedEls.push(hoveredEl);
        finishSelection();
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopPicker();
        onCancel();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        expandSelection();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        narrowSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishSelection();
      }
    }

    shadow.getElementById('pc-expand').addEventListener('click', expandSelection);
    shadow.getElementById('pc-narrow').addEventListener('click', narrowSelection);
    shadow.getElementById('pc-done').addEventListener('click', finishSelection);
    shadow.getElementById('pc-cancel').addEventListener('click', () => {
      stopPicker();
      onCancel();
    });

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);

    activeSession = { onMouseMove, onClick, onKeyDown, host, rafId };
  }

  ns.picker = {
    startPicker,
    stopPicker
  };
})();
