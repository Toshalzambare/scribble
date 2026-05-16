import { getSocket } from '../core/socket.js';
import state from '../core/state.js';
import { navigate } from '../core/router.js';
import PixelCanvas from '../canvas/PixelCanvas.js';

let pixelCanvas = null;
let timerInterval = null;

export function renderGame(appEl) {
  const room = state.get('room');
  if (!room) { navigate('home'); return; }
  const mode = state.get('gameMode') || 'classic_draw_guess';

  if (mode === 'facts') return renderFactsMode(appEl, room);
  if (mode === 'achievement') return renderAchievementMode(appEl, room);
  return renderDrawMode(appEl, room);
}

// ==================== MODE 1: DRAW & GUESS ====================
function renderDrawMode(appEl, room) {
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
    </div>`;

  renderSidebarPlayers(room.players, myId, null, new Set());
  pixelCanvas = new PixelCanvas(document.getElementById('canvas-area'), {
    gridSize: room.settings.gridSize,
    readOnly: true,
    onDraw: (data) => getSocket().emit('game:draw', data),
    onClear: () => getSocket().emit('game:clear_canvas'),
  });

  const chatInput = document.getElementById('chat-input');
  const sendMsg = () => { const m = chatInput.value.trim(); if (!m) return; getSocket().emit('game:guess', { guess: m }); chatInput.value = ''; };
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });
  document.getElementById('chat-send').addEventListener('click', sendMsg);

  const socket = getSocket();
  socket.on('game:word_choices', (d) => showWordChoices(d.choices));
  socket.on('game:drawing_started', (d) => {
    hideOverlays(); document.getElementById('word-display').textContent = d.maskedWord; startTimer(d.roundTime);
    const isDrawer = room.gameState_drawerId === myId;
    chatInput.disabled = isDrawer; chatInput.placeholder = isDrawer ? 'You are drawing!' : 'Type your guess...';
  });
  socket.on('game:draw', (d) => pixelCanvas?.applyDrawEvent(d));
  socket.on('game:clear_canvas', () => pixelCanvas?.clearCanvas());
  socket.on('game:hint', (d) => { document.getElementById('word-display').textContent = d.hint; });
  socket.on('game:correct_guess', (d) => {
    addChatMessage(`✅ ${d.playerName} guessed it! (+${d.points})`, 'correct');
    renderSidebarPlayers(d.players, myId, room.gameState_drawerId, room.gameState_guessed || new Set());
    if (d.playerId === myId) { chatInput.disabled = true; chatInput.placeholder = 'You guessed it!'; }
  });
  socket.on('game:close_guess', () => showToast("That's close!", 'close-guess'));
  socket.on('chat:message', (d) => addChatMessage(`${d.playerName}: ${d.message}`, d.type));
  socket.on('game:turn_end', (d) => { stopTimer(); pixelCanvas?.setReadOnly(true); showTurnEnd(d.word, d.reason); renderSidebarPlayers(d.players, myId, null, new Set()); });
  socket.on('game:new_turn', (d) => {
    hideOverlays(); pixelCanvas?.clearCanvas(); pixelCanvas?.setReadOnly(true);
    document.getElementById('word-display').textContent = 'Waiting...';
    document.getElementById('round-info').textContent = `Round ${d.round}/${room.settings.maxRounds}`;
    room.gameState_drawerId = d.drawer.id; room.gameState_guessed = new Set();
    addChatMessage(`🎨 ${d.drawer.name} is choosing a word...`, 'system');
    chatInput.disabled = false; chatInput.placeholder = 'Type your guess...';
  });
  socket.on('game:started', (d) => {
    room.gameState_drawerId = d.drawer?.id; room.gameState_guessed = new Set();
    document.getElementById('round-info').textContent = `Round 1/${d.maxRounds}`;
    if (d.drawer) addChatMessage(`🎨 ${d.drawer.name} is choosing a word...`, 'system');
  });
  socket.on('game:ended', (d) => { stopTimer(); showGameEnd(d.standings, d.reason); });
  socket.on('room:player_left', (d) => { room.players = d.players; room.hostId = d.newHostId; renderSidebarPlayers(d.players, myId, room.gameState_drawerId, room.gameState_guessed || new Set()); });
}

// ==================== MODE 6: FACTS ====================
function renderFactsMode(appEl, room) {
  const myId = state.get('myId');
  const isHost = room.hostId === myId;

  appEl.innerHTML = `
    <div class="game-view">
      <div class="game-header">
        <span class="round-info">📚 Facts Mode</span>
        <span class="word-display gradient-text">${room.topic}</span>
        <span class="timer-display" id="fact-counter">0 / ?</span>
      </div>
      <div class="game-body">
        <div class="facts-area">
          <div class="fact-card card card-glow" id="fact-card">
            <div class="fact-text" id="fact-text">Loading first fact...</div>
            <div class="fact-meta" id="fact-meta"></div>
          </div>
          <div class="fact-actions">
            <button class="btn btn-icon" id="fact-dislike" title="Boring">👎</button>
            <button class="btn btn-primary" id="fact-next">Next Fact ➤</button>
            <button class="btn btn-icon" id="fact-like" title="Interesting">👍</button>
          </div>
          ${isHost ? '<button class="btn btn-danger" id="facts-stop" style="margin-top:16px">⏹ End Facts Session</button>' : ''}
        </div>
        <div class="sidebar">
          <div class="sidebar-players" id="sidebar-players"></div>
          <div class="chat-area">
            <div class="chat-messages" id="chat-messages"></div>
            <div class="chat-input-area">
              <input class="input" id="chat-input" placeholder="Discuss..." maxlength="100" autocomplete="off" />
              <button class="btn btn-primary" id="chat-send">➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  renderSidebarPlayers(room.players, myId, null, new Set());
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { getSocket().emit('chat:message', { message: chatInput.value.trim() }); chatInput.value = ''; } });
  document.getElementById('chat-send').addEventListener('click', () => { getSocket().emit('chat:message', { message: chatInput.value.trim() }); chatInput.value = ''; });

  document.getElementById('fact-next').addEventListener('click', () => getSocket().emit('facts:next'));
  document.getElementById('fact-like').addEventListener('click', () => { getSocket().emit('facts:rate', { rating: 'like' }); showToast('👍 Liked!', 'success'); });
  document.getElementById('fact-dislike').addEventListener('click', () => { getSocket().emit('facts:rate', { rating: 'dislike' }); showToast('👎 Noted', ''); });

  const stopBtn = document.getElementById('facts-stop');
  if (stopBtn) stopBtn.addEventListener('click', () => getSocket().emit('facts:stop'));

  const socket = getSocket();
  socket.on('facts:new', (d) => {
    document.getElementById('fact-text').textContent = d.text;
    document.getElementById('fact-meta').textContent = d.title ? `📖 ${d.title}` : '📖 Wikipedia';
    document.getElementById('fact-counter').textContent = `${d.shown} / ${d.total}`;
    const card = document.getElementById('fact-card');
    card.style.animation = 'none'; card.offsetHeight; card.style.animation = 'slideIn 0.3s ease-out';
  });
  socket.on('facts:all_shown', (d) => {
    document.getElementById('fact-text').textContent = `🎉 All ${d.total} facts shown! No repeats.`;
    document.getElementById('fact-next').disabled = true;
  });
  socket.on('facts:rated', (d) => addChatMessage(`${d.playerName} rated ${d.rating === 'like' ? '👍' : '👎'}`, 'system'));
  socket.on('chat:message', (d) => addChatMessage(`${d.playerName}: ${d.message}`, d.type));
  socket.on('game:ended', (d) => showGameEnd(d.standings, d.reason));
  socket.on('room:player_left', (d) => { room.players = d.players; renderSidebarPlayers(d.players, myId, null, new Set()); });
}

// ==================== MODE 4: ACHIEVEMENT ====================
function renderAchievementMode(appEl, room) {
  const myId = state.get('myId');
  const isHost = room.hostId === myId;

  appEl.innerHTML = `
    <div class="game-view">
      <div class="game-header">
        <span class="round-info" id="round-info">🏆 Guess by Clues</span>
        <span class="word-display gradient-text">${room.topic}</span>
        <span class="timer-display" id="clue-counter">Clue 0/0</span>
      </div>
      <div class="game-body">
        <div class="achievement-area">
          <div class="clue-card card card-glow" id="clue-card">
            <div class="clue-number" id="clue-number">Round starting...</div>
            <div class="clue-text" id="clue-text">Get ready to guess!</div>
            <div class="clue-difficulty" id="clue-difficulty"></div>
          </div>
          <div class="achievement-actions">
            <button class="btn btn-primary btn-buzz" id="buzz-btn">🔔 BUZZ IN</button>
          </div>
          <div class="answer-form hidden" id="answer-form">
            <input class="input" id="answer-input" placeholder="Type your answer..." maxlength="100" autocomplete="off" />
            <button class="btn btn-success" id="answer-submit">Submit Answer</button>
          </div>
          ${isHost ? '<button class="btn btn-danger" id="achievement-stop" style="margin-top:12px">⏹ End Session</button>' : ''}
        </div>
        <div class="sidebar">
          <div class="sidebar-players" id="sidebar-players"></div>
          <div class="chat-area">
            <div class="chat-messages" id="chat-messages"></div>
            <div class="chat-input-area">
              <input class="input" id="chat-input" placeholder="Chat..." maxlength="100" autocomplete="off" />
              <button class="btn btn-primary" id="chat-send">➤</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  renderSidebarPlayers(room.players, myId, null, new Set());
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { getSocket().emit('chat:message', { message: chatInput.value.trim() }); chatInput.value = ''; } });
  document.getElementById('chat-send').addEventListener('click', () => { getSocket().emit('chat:message', { message: chatInput.value.trim() }); chatInput.value = ''; });

  // Buzz button
  document.getElementById('buzz-btn').addEventListener('click', () => {
    getSocket().emit('achievement:buzz');
  });

  // Answer submit
  const answerInput = document.getElementById('answer-input');
  document.getElementById('answer-submit').addEventListener('click', () => {
    const answer = answerInput.value.trim();
    if (!answer) return;
    getSocket().emit('achievement:answer', { answer });
    answerInput.value = '';
    document.getElementById('answer-form').classList.add('hidden');
    document.getElementById('buzz-btn').classList.remove('hidden');
  });
  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('answer-submit').click();
  });

  const stopBtn = document.getElementById('achievement-stop');
  if (stopBtn) stopBtn.addEventListener('click', () => getSocket().emit('achievement:stop'));

  const socket = getSocket();

  socket.on('achievement:new_round', (d) => {
    document.getElementById('round-info').textContent = `🏆 Round ${d.roundNumber}`;
    document.getElementById('clue-text').textContent = 'Next clue coming...';
    document.getElementById('clue-number').textContent = '';
    document.getElementById('clue-difficulty').textContent = '';
    document.getElementById('buzz-btn').classList.remove('hidden');
    document.getElementById('buzz-btn').disabled = false;
    document.getElementById('answer-form').classList.add('hidden');
  });

  socket.on('achievement:clue', (d) => {
    document.getElementById('clue-text').textContent = d.text;
    document.getElementById('clue-number').textContent = `Clue ${d.clueNumber} of ${d.totalClues}`;
    document.getElementById('clue-counter').textContent = `Clue ${d.clueNumber}/${d.totalClues}`;
    const diffColors = { hard: 'var(--danger)', medium: 'var(--warning)', easy: 'var(--success)' };
    const diffEl = document.getElementById('clue-difficulty');
    diffEl.textContent = d.difficulty.toUpperCase();
    diffEl.style.color = diffColors[d.difficulty] || 'var(--text-secondary)';
    // Pulse animation
    const card = document.getElementById('clue-card');
    card.style.animation = 'none'; card.offsetHeight; card.style.animation = 'slideIn 0.3s ease-out';
  });

  socket.on('achievement:buzzed', (d) => {
    if (d.playerId === myId) {
      document.getElementById('buzz-btn').classList.add('hidden');
      document.getElementById('answer-form').classList.remove('hidden');
      document.getElementById('answer-input').focus();
    } else {
      document.getElementById('buzz-btn').disabled = true;
      addChatMessage(`🔔 ${d.playerName} buzzed in!`, 'system');
    }
  });

  socket.on('achievement:buzz_timeout', (d) => {
    document.getElementById('buzz-btn').classList.remove('hidden');
    document.getElementById('buzz-btn').disabled = false;
    document.getElementById('answer-form').classList.add('hidden');
    addChatMessage(`⏰ ${d.playerId === myId ? 'You' : 'Player'} ran out of time to answer`, 'system');
  });

  socket.on('achievement:correct', (d) => {
    addChatMessage(`✅ ${d.playerName} got it: "${d.answer}" (+${d.points} pts, ${d.cluesUsed} clues)`, 'correct');
    document.getElementById('clue-text').textContent = `✅ ${d.answer}`;
    document.getElementById('buzz-btn').disabled = true;
    renderSidebarPlayers(d.players, myId, null, new Set());
  });

  socket.on('achievement:wrong', (d) => {
    addChatMessage(`❌ ${d.playerName} guessed wrong!`, 'system');
    document.getElementById('buzz-btn').classList.remove('hidden');
    document.getElementById('buzz-btn').disabled = false;
    document.getElementById('answer-form').classList.add('hidden');
  });

  socket.on('achievement:reveal', (d) => {
    document.getElementById('clue-text').textContent = `The answer was: ${d.answer}`;
    document.getElementById('clue-number').textContent = d.description;
    document.getElementById('buzz-btn').disabled = true;
  });

  socket.on('chat:message', (d) => addChatMessage(`${d.playerName}: ${d.message}`, d.type));
  socket.on('game:ended', (d) => showGameEnd(d.standings, d.reason));
  socket.on('room:player_left', (d) => { room.players = d.players; renderSidebarPlayers(d.players, myId, null, new Set()); });
}

// ==================== SHARED HELPERS ====================
function showWordChoices(choices) {
  hideOverlays();
  const overlay = document.createElement('div');
  overlay.className = 'word-choice-overlay'; overlay.id = 'word-overlay';
  overlay.innerHTML = `<div class="word-choice-panel card card-glow"><h2>Choose a word to draw</h2><div class="word-choices">${choices.map((w) => `<button class="word-choice-btn" data-word="${w}">${w}</button>`).join('')}</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.word-choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      getSocket().emit('game:choose_word', { word: btn.dataset.word });
      hideOverlays();
      pixelCanvas?.setReadOnly(false); pixelCanvas?.clearCanvas();
      document.getElementById('word-display').textContent = btn.dataset.word;
      document.getElementById('chat-input').disabled = true;
      document.getElementById('chat-input').placeholder = 'You are drawing!';
      const room = state.get('room');
      if (room) { room.gameState_drawerId = state.get('myId'); room.gameState_guessed = new Set(); }
    });
  });
}

function showTurnEnd(word, reason) {
  const texts = { time_up: "⏰ Time's up!", all_guessed: '🎉 Everyone guessed!', drawer_left: '👋 Drawer left' };
  const overlay = document.createElement('div');
  overlay.className = 'turn-end-overlay'; overlay.id = 'turn-end-overlay';
  overlay.innerHTML = `<div class="turn-end-panel card card-glow"><h2>${texts[reason] || reason}</h2><div class="word-reveal">${word}</div><p style="color:var(--text-secondary)">Next turn starting...</p></div>`;
  document.body.appendChild(overlay);
}

function showGameEnd(standings, reason) {
  hideOverlays();
  const medals = ['🥇', '🥈', '🥉'];
  const overlay = document.createElement('div');
  overlay.className = 'game-end-overlay'; overlay.id = 'game-end-overlay';
  overlay.innerHTML = `<div class="card card-glow" style="max-width:400px;width:100%"><h2 class="gradient-text text-center" style="margin-bottom:4px">Game Over!</h2><p class="text-center" style="color:var(--text-secondary);margin-bottom:16px">${reason}</p><div class="standings-list">${standings.map((s, i) => `<div class="standing-row"><span class="rank">${medals[i] || s.rank}</span><span class="avatar">${s.avatar}</span><span class="name">${s.name}</span><span class="score">${s.score}</span></div>`).join('')}</div><button class="btn btn-primary w-full" style="margin-top:16px" id="back-lobby-btn">🏠 Back to Lobby</button></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#back-lobby-btn').addEventListener('click', () => { hideOverlays(); navigate('lobby'); });
}

function hideOverlays() { document.querySelectorAll('#word-overlay, #turn-end-overlay, #game-end-overlay').forEach((el) => el.remove()); }

function addChatMessage(text, type = 'chat') {
  const c = document.getElementById('chat-messages'); if (!c) return;
  const m = document.createElement('div'); m.className = `chat-msg ${type}`; m.textContent = text;
  c.appendChild(m); c.scrollTop = c.scrollHeight;
}

function startTimer(seconds) {
  stopTimer(); let r = seconds;
  const el = document.getElementById('timer-display');
  const u = () => { if (el) { el.textContent = `⏱ ${r}`; el.classList.toggle('urgent', r <= 15); } };
  u(); timerInterval = setInterval(() => { r--; if (r <= 0) { stopTimer(); return; } u(); }, 1000);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function renderSidebarPlayers(players, myId, drawerId, guessed) {
  const el = document.getElementById('sidebar-players'); if (!el) return;
  const list = Array.isArray(players) ? players : Array.from(players.values());
  el.innerHTML = list.map((p) => `<div class="player-row${p.id === drawerId ? ' is-drawing' : ''}${guessed?.has?.(p.id) ? ' guessed' : ''}"><span class="avatar">${p.avatar}</span><span class="name">${p.name}${p.id === drawerId ? ' 🎨' : ''}${p.id === myId ? ' (You)' : ''}</span><span class="score">${p.score}</span></div>`).join('');
}

function showToast(message, type = '') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = message;
  c.appendChild(t); setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease-out forwards'; setTimeout(() => t.remove(), 300); }, 2500);
}
