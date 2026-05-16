import { getSocket } from '../core/socket.js';
import state from '../core/state.js';
import { navigate } from '../core/router.js';
import PixelCanvas from '../canvas/PixelCanvas.js';

let pixelCanvas = null;
let timerInterval = null;

export function renderGame(appEl) {
  const room = state.get('room');
  if (!room) { navigate('home'); return; }
  const myId = state.get('myId');

  appEl.innerHTML = `
    <div class="game-view">
      <div class="game-header">
        <span class="round-info" id="round-info">Round 1/${room.settings.maxRounds}</span>
        <span class="word-display" id="word-display">Waiting...</span>
        <span class="timer-display" id="timer-display">⏱ --</span>
      </div>
      <div class="game-body">
        <div class="canvas-area" id="canvas-area"></div>
        <div class="sidebar">
          <div class="sidebar-players" id="sidebar-players"></div>
          <div class="chat-area">
            <div class="chat-messages" id="chat-messages"></div>
            <div class="chat-input-area">
              <input class="input" id="chat-input" placeholder="Type your guess..." maxlength="100" autocomplete="off" />
              <button class="btn btn-primary" id="chat-send">➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderSidebarPlayers(appEl, room.players, myId, null, new Set());

  // Init canvas (read-only by default, enabled when it's your turn)
  pixelCanvas = new PixelCanvas(document.getElementById('canvas-area'), {
    gridSize: room.settings.gridSize,
    readOnly: true,
    onDraw: (data) => getSocket().emit('game:draw', data),
    onClear: () => getSocket().emit('game:clear_canvas'),
  });

  // Chat send
  const chatInput = document.getElementById('chat-input');
  const sendMsg = () => {
    const msg = chatInput.value.trim();
    if (!msg) return;
    getSocket().emit('game:guess', { guess: msg });
    chatInput.value = '';
  };
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
  document.getElementById('chat-send').addEventListener('click', sendMsg);

  // --- Socket Listeners ---
  const socket = getSocket();

  socket.on('game:word_choices', (data) => {
    showWordChoices(data.choices);
  });

  socket.on('game:drawing_started', (data) => {
    hideOverlays();
    document.getElementById('word-display').textContent = data.maskedWord;
    startTimer(data.roundTime);

    const isDrawer = room.gameState_drawerId === myId;
    if (isDrawer) {
      document.getElementById('chat-input').disabled = true;
      document.getElementById('chat-input').placeholder = 'You are drawing!';
    } else {
      document.getElementById('chat-input').disabled = false;
      document.getElementById('chat-input').placeholder = 'Type your guess...';
    }
  });

  socket.on('game:draw', (data) => {
    pixelCanvas?.applyDrawEvent(data);
  });

  socket.on('game:clear_canvas', () => {
    pixelCanvas?.clearCanvas();
  });

  socket.on('game:hint', (data) => {
    document.getElementById('word-display').textContent = data.hint;
  });

  socket.on('game:correct_guess', (data) => {
    addChatMessage(`✅ ${data.playerName} guessed it! (+${data.points})`, 'correct');
    renderSidebarPlayers(appEl, data.players, myId, room.gameState_drawerId, room.gameState_guessed || new Set());
    if (data.playerId === myId) {
      document.getElementById('chat-input').disabled = true;
      document.getElementById('chat-input').placeholder = 'You already guessed!';
    }
  });

  socket.on('game:close_guess', () => {
    showToast("That's close!", 'close-guess');
  });

  socket.on('chat:message', (data) => {
    addChatMessage(`${data.playerName}: ${data.message}`, data.type);
  });

  socket.on('game:turn_end', (data) => {
    stopTimer();
    pixelCanvas?.setReadOnly(true);
    showTurnEnd(data.word, data.reason);
    renderSidebarPlayers(appEl, data.players, myId, null, new Set());
  });

  socket.on('game:new_turn', (data) => {
    hideOverlays();
    pixelCanvas?.clearCanvas();
    pixelCanvas?.setReadOnly(true);
    document.getElementById('word-display').textContent = 'Waiting...';
    document.getElementById('round-info').textContent = `Round ${data.round}/${room.settings.maxRounds}`;

    room.gameState_drawerId = data.drawer.id;
    room.gameState_guessed = new Set();

    addChatMessage(`🎨 ${data.drawer.name} is choosing a word...`, 'system');

    if (data.drawer.id === myId) {
      // Word choices will come via game:word_choices event
    } else {
      document.getElementById('chat-input').disabled = false;
      document.getElementById('chat-input').placeholder = 'Type your guess...';
    }
  });

  socket.on('game:started', (data) => {
    room.gameState_drawerId = data.drawer.id;
    room.gameState_guessed = new Set();
    document.getElementById('round-info').textContent = `Round 1/${data.maxRounds}`;
    addChatMessage(`🎨 ${data.drawer.name} is choosing a word...`, 'system');
  });

  socket.on('game:ended', (data) => {
    stopTimer();
    showGameEnd(data.standings, data.reason);
  });

  socket.on('room:player_left', (data) => {
    room.players = data.players;
    room.hostId = data.newHostId;
    renderSidebarPlayers(appEl, data.players, myId, room.gameState_drawerId, room.gameState_guessed || new Set());
  });
}

function showWordChoices(choices) {
  hideOverlays();
  const overlay = document.createElement('div');
  overlay.className = 'word-choice-overlay';
  overlay.id = 'word-overlay';
  overlay.innerHTML = `
    <div class="word-choice-panel card card-glow">
      <h2>Choose a word to draw</h2>
      <div class="word-choices">${choices.map((w) => `<button class="word-choice-btn" data-word="${w}">${w}</button>`).join('')}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.word-choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const word = btn.dataset.word;
      getSocket().emit('game:choose_word', { word });
      hideOverlays();

      // Enable drawing for this player
      pixelCanvas?.setReadOnly(false);
      pixelCanvas?.clearCanvas();
      document.getElementById('word-display').textContent = word;
      document.getElementById('chat-input').disabled = true;
      document.getElementById('chat-input').placeholder = 'You are drawing!';

      const room = state.get('room');
      if (room) {
        room.gameState_drawerId = state.get('myId');
        room.gameState_guessed = new Set();
      }
    });
  });
}

function showTurnEnd(word, reason) {
  const reasonText = reason === 'time_up' ? '⏰ Time\'s up!' : reason === 'all_guessed' ? '🎉 Everyone guessed!' : '👋 Drawer left';
  const overlay = document.createElement('div');
  overlay.className = 'turn-end-overlay';
  overlay.id = 'turn-end-overlay';
  overlay.innerHTML = `
    <div class="turn-end-panel card card-glow">
      <h2>${reasonText}</h2>
      <div class="word-reveal">${word}</div>
      <p style="color:var(--text-secondary)">Next turn starting...</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showGameEnd(standings, reason) {
  hideOverlays();
  const overlay = document.createElement('div');
  overlay.className = 'game-end-overlay';
  overlay.id = 'game-end-overlay';
  const medals = ['🥇', '🥈', '🥉'];
  overlay.innerHTML = `
    <div class="card card-glow" style="max-width:400px;width:100%">
      <h2 class="gradient-text text-center" style="margin-bottom:4px">Game Over!</h2>
      <p class="text-center" style="color:var(--text-secondary);margin-bottom:16px">${reason}</p>
      <div class="standings-list">
        ${standings.map((s, i) => `
          <div class="standing-row">
            <span class="rank">${medals[i] || s.rank}</span>
            <span class="avatar">${s.avatar}</span>
            <span class="name">${s.name}</span>
            <span class="score">${s.score}</span>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary w-full" style="margin-top:16px" id="back-lobby-btn">🏠 Back to Lobby</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#back-lobby-btn').addEventListener('click', () => {
    hideOverlays();
    navigate('lobby');
  });
}

function hideOverlays() {
  document.querySelectorAll('#word-overlay, #turn-end-overlay, #game-end-overlay').forEach((el) => el.remove());
}

function addChatMessage(text, type = 'chat') {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = `chat-msg ${type}`;
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function startTimer(seconds) {
  stopTimer();
  let remaining = seconds;
  const el = document.getElementById('timer-display');
  const update = () => {
    if (!el) return;
    el.textContent = `⏱ ${remaining}`;
    el.classList.toggle('urgent', remaining <= 15);
  };
  update();
  timerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { stopTimer(); return; }
    update();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function renderSidebarPlayers(appEl, players, myId, drawerId, guessed) {
  const el = appEl.querySelector('#sidebar-players') || document.getElementById('sidebar-players');
  if (!el) return;
  el.innerHTML = players.map((p) => `
    <div class="player-row${p.id === drawerId ? ' is-drawing' : ''}${guessed?.has?.(p.id) ? ' guessed' : ''}">
      <span class="avatar">${p.avatar}</span>
      <span class="name">${p.name}${p.id === drawerId ? ' 🎨' : ''}${p.id === myId ? ' (You)' : ''}</span>
      <span class="score">${p.score}</span>
    </div>
  `).join('');
}

function showToast(message, type = '') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
