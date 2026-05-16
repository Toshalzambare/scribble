/**
 * PixelCanvas — Raster grid drawing engine with full tool suite
 * Supports both pixel-grid mode and smooth drawing mode
 * Touch + Mouse input, Undo/Redo stack
 */

const COLORS = [
  '#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00',
  '#ff6600','#ff00ff','#00ffff','#884400','#888888','#ff69b4',
  '#8b0000','#006400','#00008b','#ff8c00','#4b0082','#2f4f4f',
  '#7c5cfc','#22c55e','#ef4444','#f59e0b','#06b6d4','#ec4899',
];

export default class PixelCanvas {
  constructor(container, options = {}) {
    this.gridSize = options.gridSize || 64;
    this.container = container;
    this.isReadOnly = options.readOnly || false;

    // State
    this.currentTool = 'pencil';
    this.currentColor = '#000000';
    this.brushSize = 1;
    this.isDrawing = false;
    this.lastPos = null;

    // Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 30;

    // Canvas setup
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridSize;
    this.canvas.height = this.gridSize;
    this.canvas.className = 'pixel-canvas';
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingEnabled = false;
    this.clearCanvas();

    // Drawing callback (for network sync)
    this.onDraw = options.onDraw || null;
    this.onClear = options.onClear || null;

    // Build UI
    this._buildUI();

    if (!this.isReadOnly) {
      this._bindEvents();
    }
  }

  _buildUI() {
    this.container.innerHTML = '';

    // Canvas wrapper
    this.wrapperEl = document.createElement('div');
    this.wrapperEl.className = 'canvas-wrapper';
    this.wrapperEl.appendChild(this.canvas);
    this.container.appendChild(this.wrapperEl);

    if (this.isReadOnly) return;

    // Toolbar
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'toolbar';

    // Tools
    const tools = [
      { id: 'pencil', icon: '✏️', title: 'Pencil' },
      { id: 'eraser', icon: '🧹', title: 'Eraser' },
      { id: 'fill', icon: '🪣', title: 'Fill' },
      { id: 'rect', icon: '⬜', title: 'Rectangle' },
      { id: 'circle', icon: '⭕', title: 'Circle' },
      { id: 'line', icon: '📏', title: 'Line' },
    ];

    const toolGroup = document.createElement('div');
    toolGroup.className = 'flex gap-sm';
    tools.forEach((t) => {
      const btn = document.createElement('button');
      btn.className = `btn-icon${t.id === this.currentTool ? ' active' : ''}`;
      btn.title = t.title;
      btn.textContent = t.icon;
      btn.dataset.tool = t.id;
      btn.addEventListener('click', () => this._selectTool(t.id));
      toolGroup.appendChild(btn);
    });
    this.toolbarEl.appendChild(toolGroup);

    // Brush size
    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '1';
    sizeSlider.max = '5';
    sizeSlider.value = '1';
    sizeSlider.className = 'brush-size-slider';
    sizeSlider.title = 'Brush size';
    sizeSlider.addEventListener('input', (e) => { this.brushSize = parseInt(e.target.value); });
    this.toolbarEl.appendChild(sizeSlider);

    // Undo/Redo
    const undoGroup = document.createElement('div');
    undoGroup.className = 'flex gap-sm';
    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn-icon';
    undoBtn.title = 'Undo';
    undoBtn.textContent = '↩️';
    undoBtn.addEventListener('click', () => this.undo());
    const redoBtn = document.createElement('button');
    redoBtn.className = 'btn-icon';
    redoBtn.title = 'Redo';
    redoBtn.textContent = '↪️';
    redoBtn.addEventListener('click', () => this.redo());
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-icon';
    clearBtn.title = 'Clear';
    clearBtn.textContent = '🗑️';
    clearBtn.addEventListener('click', () => { this.clearCanvas(); this.onClear?.(); });
    undoGroup.append(undoBtn, redoBtn, clearBtn);
    this.toolbarEl.appendChild(undoGroup);

    this.container.appendChild(this.toolbarEl);

    // Color palette
    this.paletteEl = document.createElement('div');
    this.paletteEl.className = 'toolbar';
    const palette = document.createElement('div');
    palette.className = 'color-palette';
    COLORS.forEach((c) => {
      const swatch = document.createElement('div');
      swatch.className = `color-swatch${c === this.currentColor ? ' active' : ''}`;
      swatch.style.background = c;
      swatch.dataset.color = c;
      swatch.addEventListener('click', () => this._selectColor(c));
      palette.appendChild(swatch);
    });
    this.paletteEl.appendChild(palette);
    this.container.appendChild(this.paletteEl);
  }

  _selectTool(toolId) {
    this.currentTool = toolId;
    this.toolbarEl.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === toolId);
    });
  }

  _selectColor(color) {
    this.currentColor = color;
    this.paletteEl.querySelectorAll('.color-swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.color === color);
    });
    if (this.currentTool === 'eraser') this.currentTool = 'pencil';
  }

  _bindEvents() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this._startDraw(e));
    this.canvas.addEventListener('mousemove', (e) => this._moveDraw(e));
    this.canvas.addEventListener('mouseup', () => this._endDraw());
    this.canvas.addEventListener('mouseleave', () => this._endDraw());

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._startDraw(e.touches[0]); }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); this._moveDraw(e.touches[0]); }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => { e.preventDefault(); this._endDraw(); }, { passive: false });
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  }

  _startDraw(e) {
    this.isDrawing = true;
    this.lastPos = this._getPos(e);
    this._saveUndoState();

    if (this.currentTool === 'fill') {
      this._floodFill(this.lastPos.x, this.lastPos.y, this.currentColor);
      this._emitDraw({ tool: 'fill', x: this.lastPos.x, y: this.lastPos.y, color: this.currentColor });
      this.isDrawing = false;
      return;
    }

    if (this.currentTool === 'pencil' || this.currentTool === 'eraser') {
      this._drawPixel(this.lastPos.x, this.lastPos.y);
      this._emitDraw({ tool: this.currentTool, points: [this.lastPos], color: this._drawColor(), size: this.brushSize });
    }

    this.shapeStart = this.lastPos;
    this.shapeSnapshot = this.ctx.getImageData(0, 0, this.gridSize, this.gridSize);
  }

  _moveDraw(e) {
    if (!this.isDrawing) return;
    const pos = this._getPos(e);

    if (this.currentTool === 'pencil' || this.currentTool === 'eraser') {
      this._drawLine(this.lastPos.x, this.lastPos.y, pos.x, pos.y);
      this._emitDraw({ tool: this.currentTool, points: [this.lastPos, pos], color: this._drawColor(), size: this.brushSize });
      this.lastPos = pos;
    } else if (['rect', 'circle', 'line'].includes(this.currentTool)) {
      // Preview shape
      this.ctx.putImageData(this.shapeSnapshot, 0, 0);
      this._drawShape(this.shapeStart, pos);
    }
  }

  _endDraw() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (['rect', 'circle', 'line'].includes(this.currentTool) && this.shapeStart && this.lastPos) {
      this._emitDraw({ tool: this.currentTool, start: this.shapeStart, end: this.lastPos, color: this.currentColor, size: this.brushSize });
    }
  }

  _drawColor() {
    return this.currentTool === 'eraser' ? '#ffffff' : this.currentColor;
  }

  _drawPixel(x, y) {
    const color = this._drawColor();
    this.ctx.fillStyle = color;
    const s = this.brushSize;
    const offset = Math.floor(s / 2);
    for (let dx = 0; dx < s; dx++) {
      for (let dy = 0; dy < s; dy++) {
        const px = x - offset + dx;
        const py = y - offset + dy;
        if (px >= 0 && px < this.gridSize && py >= 0 && py < this.gridSize) {
          this.ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  _drawLine(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this._drawPixel(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  _drawShape(start, end) {
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.brushSize;

    if (this.currentTool === 'rect') {
      const w = end.x - start.x;
      const h = end.y - start.y;
      this.ctx.strokeRect(start.x, start.y, w, h);
    } else if (this.currentTool === 'circle') {
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (this.currentTool === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    }
  }

  _floodFill(startX, startY, fillColor) {
    const imgData = this.ctx.getImageData(0, 0, this.gridSize, this.gridSize);
    const data = imgData.data;
    const w = this.gridSize;
    const targetColor = this._getPixelColor(data, startX, startY, w);
    const fill = this._hexToRgb(fillColor);

    if (targetColor[0] === fill[0] && targetColor[1] === fill[1] && targetColor[2] === fill[2]) return;

    const stack = [[startX, startY]];
    const visited = new Set();

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= w) continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const c = this._getPixelColor(data, x, y, w);
      if (c[0] !== targetColor[0] || c[1] !== targetColor[1] || c[2] !== targetColor[2]) continue;

      visited.add(key);
      const i = (y * w + x) * 4;
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    this.ctx.putImageData(imgData, 0, 0);
  }

  _getPixelColor(data, x, y, w) {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  _hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }

  _emitDraw(data) {
    this.onDraw?.(data);
  }

  // --- Public API ---

  clearCanvas() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.gridSize, this.gridSize);
  }

  applyDrawEvent(data) {
    if (data.tool === 'fill') {
      this._floodFill(data.x, data.y, data.color);
    } else if (data.tool === 'pencil' || data.tool === 'eraser') {
      this.ctx.fillStyle = data.color;
      const pts = data.points;
      const oldBrush = this.brushSize;
      this.brushSize = data.size || 1;
      if (pts.length === 1) {
        this._drawPixel(pts[0].x, pts[0].y);
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          this._drawLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        }
      }
      this.brushSize = oldBrush;
    } else if (['rect', 'circle', 'line'].includes(data.tool)) {
      const oldColor = this.currentColor;
      const oldBrush = this.brushSize;
      this.currentColor = data.color;
      this.brushSize = data.size || 1;
      this._drawShape(data.start, data.end);
      this.currentColor = oldColor;
      this.brushSize = oldBrush;
    }
  }

  _saveUndoState() {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.gridSize, this.gridSize));
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.ctx.getImageData(0, 0, this.gridSize, this.gridSize));
    this.ctx.putImageData(this.undoStack.pop(), 0, 0);
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.ctx.getImageData(0, 0, this.gridSize, this.gridSize));
    this.ctx.putImageData(this.redoStack.pop(), 0, 0);
  }

  setReadOnly(val) {
    this.isReadOnly = val;
    if (val) {
      this.toolbarEl?.classList.add('hidden');
      this.paletteEl?.classList.add('hidden');
    } else {
      this.toolbarEl?.classList.remove('hidden');
      this.paletteEl?.classList.remove('hidden');
    }
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
