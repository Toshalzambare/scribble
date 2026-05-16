/** Simple reactive state store */
const state = {
  _data: {
    currentView: 'home',
    playerName: '',
    room: null,
    myId: null,
    isDrawing: false,
    gamePhase: null, // null | choosing | drawing | round_end | game_end
    currentWord: null,
    maskedWord: '',
    timer: 0,
    messages: [],
  },
  _listeners: new Map(),

  get(key) { return this._data[key]; },

  set(key, value) {
    this._data[key] = value;
    if (this._listeners.has(key)) {
      this._listeners.get(key).forEach((fn) => fn(value));
    }
  },

  on(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(fn);
    return () => this._listeners.get(key).delete(fn);
  },

  getAll() { return { ...this._data }; },
};

export default state;
