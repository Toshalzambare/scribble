import { getSocket, emitWithAck } from '../core/socket.js';
import state from '../core/state.js';
import { navigate } from '../core/router.js';

export function renderLobby(appEl) {
  const room = state.get('room');
  if (!room) { navigate('home'); return; }

  const myId = state.get('myId');
  const isHost = room.hostId === myId;

  appEl.innerHTML = `
    <div class="lobby-view">
      <div class="lobby-header">
        <div>
          <h2>${room.name}</h2>
          <div class="badge badge-accent" style="margin-top:4px">Topic: ${room.topic}</div>
        </div>
        <div class="room-code-display" id="code-copy" title="Click to copy">
          <span>${room.code}</span>
          <span class="copy-hint">📋 tap to copy</span>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:12px">Players (${room.players.length}/${room.settings.maxPlayers})</h3>
        <div class="player-grid" id="player-grid"></div>
      </div>

      ${isHost ? `
      <div class="card">
        <h3 style="margin-bottom:12px">Room Settings</h3>
        <div class="lobby-settings">
          <div class="input-group">
            <label class="input-label">Grid Size</label>
            <select class="input" id="set-grid">
              <option value="32" ${room.settings.gridSize == 32 ? 'selected' : ''}>32×32 (Chunky)</option>
              <option value="64" ${room.settings.gridSize == 64 ? 'selected' : ''}>64×64 (Retro)</option>
              <option value="128" ${room.settings.gridSize == 128 ? 'selected' : ''}>128×128 (Detailed)</option>
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">Round Time</label>
            <select class="input" id="set-time">
              <option value="60" ${room.settings.roundTime == 60 ? 'selected' : ''}>60 seconds</option>
              <option value="80" ${room.settings.roundTime == 80 ? 'selected' : ''}>80 seconds</option>
              <option value="120" ${room.settings.roundTime == 120 ? 'selected' : ''}>120 seconds</option>
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">Rounds</label>
            <select class="input" id="set-rounds">
              <option value="2" ${room.settings.maxRounds == 2 ? 'selected' : ''}>2 rounds</option>
              <option value="3" ${room.settings.maxRounds == 3 ? 'selected' : ''}>3 rounds</option>
              <option value="5" ${room.settings.maxRounds == 5 ? 'selected' : ''}>5 rounds</option>
            </select>
          </div>
        </div>
      </div>` : ''}

      <div class="flex gap-md" style="margin-top:auto;padding:16px 0">
        <button class="btn btn-secondary" id="leave-btn" style="flex:1">🚪 Leave</button>
        ${isHost ? '<button class="btn btn-primary" id="start-btn" style="flex:2">🎮 Start Game</button>' : '<p style="text-align:center;color:var(--text-secondary);flex:2">Waiting for host to start...</p>'}
      </div>
      <div id="lobby-error" style="color:var(--danger);text-align:center;font-size:0.9rem"></div>
    </div>
  `;

  renderPlayers(appEl, room.players, myId);

  // Copy room code
  appEl.querySelector('#code-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      const hint = appEl.querySelector('.copy-hint');
      hint.textContent = '✅ Copied!';
      setTimeout(() => { hint.textContent = '📋 tap to copy'; }, 2000);
    } catch { /* ignore */ }
  });

  // Leave
  appEl.querySelector('#leave-btn').addEventListener('click', () => {
    getSocket().emit('room:leave');
    state.set('room', null);
    navigate('home');
  });

  // Start
  const startBtn = appEl.querySelector('#start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      startBtn.textContent = '⏳ Starting...';
      startBtn.disabled = true;
      const res = await emitWithAck('game:start');
      if (!res.success) {
        appEl.querySelector('#lobby-error').textContent = res.error;
        startBtn.textContent = '🎮 Start Game';
        startBtn.disabled = false;
      }
    });
  }

  // Socket listeners
  const socket = getSocket();

  const onJoin = (data) => {
    const r = state.get('room');
    if (r) { r.players = data.players; state.set('room', r); }
    renderPlayers(appEl, data.players, myId);
    updatePlayerCount(appEl, data.players.length, room.settings.maxPlayers);
  };

  const onLeft = (data) => {
    const r = state.get('room');
    if (r) { r.players = data.players; r.hostId = data.newHostId; state.set('room', r); }
    renderPlayers(appEl, data.players, myId);
    updatePlayerCount(appEl, data.players.length, room.settings.maxPlayers);
  };

  const onGameStarted = (data) => {
    state.set('gamePhase', 'choosing');
    navigate('game');
  };

  socket.on('room:player_joined', onJoin);
  socket.on('room:player_left', onLeft);
  socket.on('game:started', onGameStarted);

  // Cleanup when leaving lobby
  const cleanup = state.on('currentView', () => {
    socket.off('room:player_joined', onJoin);
    socket.off('room:player_left', onLeft);
    socket.off('game:started', onGameStarted);
    cleanup();
  });
}

function renderPlayers(appEl, players, myId) {
  const grid = appEl.querySelector('#player-grid');
  if (!grid) return;
  grid.innerHTML = players.map((p) => `
    <div class="player-card${p.id === myId ? ' is-you' : ''}">
      <span class="avatar">${p.avatar}</span>
      <span class="name">${p.name}</span>
      ${p.isHost ? '<span class="host-badge">👑 Host</span>' : ''}
    </div>
  `).join('');
}

function updatePlayerCount(appEl, count, max) {
  const h3 = appEl.querySelector('.player-grid')?.parentElement?.querySelector('h3');
  if (h3) h3.textContent = `Players (${count}/${max})`;
}
