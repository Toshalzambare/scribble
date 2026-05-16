import { emitWithAck } from '../core/socket.js';
import state from '../core/state.js';
import { navigate } from '../core/router.js';

const TOPICS = ['general', 'cricket', 'anime', 'football', 'tech', 'cartoon', 'countries', 'fruits', 'engineering'];

export function renderHome(appEl) {
  const savedName = localStorage.getItem('pa_name') || '';

  appEl.innerHTML = `
    <div class="home-view">
      <div class="home-logo">🎮</div>
      <h1 class="home-title gradient-text">PixelArena</h1>
      <p class="home-subtitle">Draw. Guess. Compete. With AI.</p>

      <div class="home-actions">
        <div class="card card-glow">
          <h3 style="margin-bottom:12px">Create a Room</h3>
          <form id="create-form" class="home-form">
            <div class="input-group">
              <label class="input-label">Your Name</label>
              <input class="input" id="create-name" placeholder="Enter your name" value="${savedName}" maxlength="20" required />
            </div>
            <div class="input-group">
              <label class="input-label">Topic</label>
              <input class="input" id="create-topic" placeholder="Type any topic..." value="general" />
            </div>
            <div class="topic-pills" id="topic-pills"></div>
            <button type="submit" class="btn btn-primary" id="create-btn">🚀 Create Room</button>
          </form>
        </div>

        <div class="divider"><span>or</span></div>

        <div class="card">
          <h3 style="margin-bottom:12px">Join a Room</h3>
          <form id="join-form" class="home-form">
            <div class="input-group">
              <label class="input-label">Your Name</label>
              <input class="input" id="join-name" placeholder="Enter your name" value="${savedName}" maxlength="20" required />
            </div>
            <div class="input-group">
              <label class="input-label">Room Code</label>
              <input class="input" id="join-code" placeholder="e.g. ABC123" maxlength="6" style="text-transform:uppercase;letter-spacing:3px;font-weight:700" required />
            </div>
            <button type="submit" class="btn btn-secondary" id="join-btn">🎯 Join Room</button>
          </form>
        </div>
      </div>
      <div id="home-error" style="color:var(--danger);margin-top:12px;font-size:0.9rem;text-align:center"></div>
    </div>
  `;

  // Render topic pills
  const pillsEl = appEl.querySelector('#topic-pills');
  const topicInput = appEl.querySelector('#create-topic');
  TOPICS.forEach((t) => {
    const pill = document.createElement('span');
    pill.className = `topic-pill${t === 'general' ? ' active' : ''}`;
    pill.textContent = t;
    pill.addEventListener('click', () => {
      topicInput.value = t;
      pillsEl.querySelectorAll('.topic-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
    });
    pillsEl.appendChild(pill);
  });

  topicInput.addEventListener('input', () => {
    pillsEl.querySelectorAll('.topic-pill').forEach((p) => {
      p.classList.toggle('active', p.textContent === topicInput.value.toLowerCase().trim());
    });
  });

  // Create room
  appEl.querySelector('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = appEl.querySelector('#create-name').value.trim();
    const topic = appEl.querySelector('#create-topic').value.trim() || 'general';
    if (!name) return;

    localStorage.setItem('pa_name', name);
    state.set('playerName', name);
    const btn = appEl.querySelector('#create-btn');
    btn.textContent = '⏳ Creating...';
    btn.disabled = true;

    const res = await emitWithAck('room:create', { playerName: name, topic });
    if (res.success) {
      state.set('room', res.room);
      navigate('lobby');
    } else {
      appEl.querySelector('#home-error').textContent = res.error || 'Failed to create room';
      btn.textContent = '🚀 Create Room';
      btn.disabled = false;
    }
  });

  // Join room
  appEl.querySelector('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = appEl.querySelector('#join-name').value.trim();
    const code = appEl.querySelector('#join-code').value.trim().toUpperCase();
    if (!name || !code) return;

    localStorage.setItem('pa_name', name);
    state.set('playerName', name);
    const btn = appEl.querySelector('#join-btn');
    btn.textContent = '⏳ Joining...';
    btn.disabled = true;

    const res = await emitWithAck('room:join', { playerName: name, code });
    if (res.success) {
      state.set('room', res.room);
      navigate('lobby');
    } else {
      appEl.querySelector('#home-error').textContent = res.error || 'Failed to join room';
      btn.textContent = '🎯 Join Room';
      btn.disabled = false;
    }
  });
}
