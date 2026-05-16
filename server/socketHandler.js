import { createRoom, joinRoom, leaveRoom, findPlayerRoom, serializeRoom } from './roomManager.js';
import { initGameState, startWordChoice, chooseWord, checkGuess, getNextHint, nextTurn, getStandings } from './gameEngine.js';
import { fetchTopicData, getNextFact, getEntityForGuessing } from './topicEngine.js';
import config from './config.js';

const turnTimers = new Map();
const hintTimers = new Map();

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ==================== ROOM EVENTS ====================
    socket.on('room:create', async (data, callback) => {
      try {
        const room = createRoom({
          hostId: socket.id,
          hostName: data.playerName || 'Player',
          topic: data.topic || 'general',
          roomName: data.roomName || '',
          gridSize: data.gridSize,
          maxPlayers: data.maxPlayers,
          roundTime: data.roundTime,
          maxRounds: data.maxRounds,
        });
        socket.join(room.code);

        // Pre-fetch topic data in background (non-blocking)
        fetchTopicData(room.topic).then((topicData) => {
          room.topicData = topicData;
          room.shownFactHashes = new Set();
          room.usedEntityIds = new Set();
          console.log(`[TopicEngine] Data ready for room ${room.code}`);
          io.to(room.code).emit('room:topic_ready', { topic: room.topic, wordCount: topicData.words.length, factCount: topicData.facts.length, entityCount: topicData.entities.length });
        }).catch((err) => {
          console.warn(`[TopicEngine] Failed for "${room.topic}":`, err.message);
        });

        callback({ success: true, room: serializeRoom(room) });
      } catch (err) {
        callback({ success: false, error: err.message });
      }
    });

    socket.on('room:join', (data, callback) => {
      try {
        const result = joinRoom(data.code, socket.id, data.playerName || 'Player');
        if (result.error) { callback({ success: false, error: result.error }); return; }
        socket.join(result.room.code);
        const serialized = serializeRoom(result.room);
        socket.to(result.room.code).emit('room:player_joined', {
          player: serialized.players.find((p) => p.id === socket.id),
          players: serialized.players,
        });
        callback({ success: true, room: serialized });
      } catch (err) {
        callback({ success: false, error: err.message });
      }
    });

    socket.on('room:leave', () => handlePlayerLeave(socket, io));

    // ==================== MODE 1: DRAW & GUESS ====================
    socket.on('game:start', (data, callback) => {
      const room = findPlayerRoom(socket.id);
      if (!room) return callback?.({ success: false, error: 'Not in a room' });
      if (room.hostId !== socket.id) return callback?.({ success: false, error: 'Only the host can start' });
      if (room.players.size < config.game.minPlayersToStart) {
        return callback?.({ success: false, error: `Need at least ${config.game.minPlayersToStart} players` });
      }

      const mode = data?.mode || 'classic_draw_guess';
      room.currentMode = mode;

      if (mode === 'facts') {
        startFactsMode(room, io);
        return callback?.({ success: true });
      }
      if (mode === 'achievement') {
        startAchievementMode(room, io);
        return callback?.({ success: true });
      }

      // Default: Classic Draw & Guess
      room.state = 'playing';
      room.gameState = initGameState(room);
      const wordData = startWordChoice(room);

      io.to(room.code).emit('game:started', {
        mode: 'classic_draw_guess',
        round: 1,
        maxRounds: room.gameState.maxRounds,
        drawer: getPlayerInfo(room, wordData.drawerId),
      });
      io.to(wordData.drawerId).emit('game:word_choices', { choices: wordData.choices });
      callback?.({ success: true });
    });

    socket.on('game:choose_word', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || !room.gameState) return;
      if (socket.id !== room.gameState.currentDrawer) return;

      const result = chooseWord(room, data.word);
      io.to(room.code).emit('game:drawing_started', {
        maskedWord: result.maskedWord,
        wordLength: result.wordLength,
        roundTime: room.settings.roundTime,
      });
      startTurnTimer(room, io);
      startHintTimer(room, io);
    });

    socket.on('game:draw', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || !room.gameState) return;
      if (socket.id !== room.gameState.currentDrawer) return;
      socket.to(room.code).emit('game:draw', data);
    });

    socket.on('game:clear_canvas', () => {
      const room = findPlayerRoom(socket.id);
      if (!room || !room.gameState) return;
      if (socket.id !== room.gameState.currentDrawer) return;
      socket.to(room.code).emit('game:clear_canvas');
    });

    socket.on('game:guess', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || !room.gameState || room.gameState.phase !== 'drawing') return;

      const result = checkGuess(room, socket.id, data.guess);
      if (result.isDrawer || result.alreadyGuessed) return;

      if (result.correct) {
        io.to(room.code).emit('game:correct_guess', {
          playerId: socket.id,
          playerName: result.guesserName,
          points: result.guesserPoints,
          players: getPlayersArray(room),
        });
        if (result.allGuessed) endTurn(room, io, 'all_guessed');
      } else if (result.close) {
        socket.emit('game:close_guess');
      } else {
        io.to(room.code).emit('chat:message', {
          playerId: socket.id,
          playerName: room.players.get(socket.id)?.name || 'Unknown',
          message: data.guess, type: 'guess',
        });
      }
    });

    // ==================== MODE 6: FACTS ====================
    socket.on('facts:next', () => {
      const room = findPlayerRoom(socket.id);
      if (!room || room.currentMode !== 'facts') return;
      sendNextFact(room, io);
    });

    socket.on('facts:rate', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || room.currentMode !== 'facts') return;
      // Broadcast rating to all
      io.to(room.code).emit('facts:rated', {
        playerName: room.players.get(socket.id)?.name,
        rating: data.rating,
      });
    });

    socket.on('facts:stop', () => {
      const room = findPlayerRoom(socket.id);
      if (!room || room.hostId !== socket.id) return;
      room.state = 'lobby';
      room.currentMode = null;
      room.gameState = null;
      for (const [, p] of room.players) p.score = 0;
      io.to(room.code).emit('game:ended', { standings: getStandings(room), reason: 'Facts session ended' });
    });

    // ==================== MODE 4: ACHIEVEMENT ====================
    socket.on('achievement:buzz', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || room.currentMode !== 'achievement' || !room.achievementState) return;
      const as = room.achievementState;
      if (as.buzzedPlayer) return; // Someone already buzzed

      as.buzzedPlayer = socket.id;
      clearTimers(room.code);

      io.to(room.code).emit('achievement:buzzed', {
        playerId: socket.id,
        playerName: room.players.get(socket.id)?.name,
      });

      // Give them 10 seconds to answer
      const answerTimer = setTimeout(() => {
        as.buzzedPlayer = null;
        io.to(room.code).emit('achievement:buzz_timeout', { playerId: socket.id });
        resumeClueTimer(room, io);
      }, 10000);
      turnTimers.set(room.code + '_answer', answerTimer);
    });

    socket.on('achievement:answer', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || room.currentMode !== 'achievement' || !room.achievementState) return;
      const as = room.achievementState;
      if (as.buzzedPlayer !== socket.id) return;

      clearTimeout(turnTimers.get(room.code + '_answer'));
      turnTimers.delete(room.code + '_answer');
      as.buzzedPlayer = null;

      const guess = data.answer.toLowerCase().trim();
      const answer = as.currentEntity.name.toLowerCase().trim();
      const correct = guess === answer || answer.includes(guess) || guess.includes(answer);

      if (correct) {
        const cluesUsed = as.currentClueIndex;
        const points = Math.max(50, 300 - (cluesUsed - 1) * 60);
        const player = room.players.get(socket.id);
        if (player) player.score += points;

        io.to(room.code).emit('achievement:correct', {
          playerId: socket.id,
          playerName: player?.name,
          answer: as.currentEntity.name,
          points,
          cluesUsed,
          players: getPlayersArray(room),
        });

        // Next entity after 4 seconds
        setTimeout(() => nextAchievementRound(room, io), 4000);
      } else {
        io.to(room.code).emit('achievement:wrong', {
          playerId: socket.id,
          playerName: room.players.get(socket.id)?.name,
        });
        resumeClueTimer(room, io);
      }
    });

    socket.on('achievement:stop', () => {
      const room = findPlayerRoom(socket.id);
      if (!room || room.hostId !== socket.id) return;
      endAchievementMode(room, io);
    });

    // ==================== CHAT ====================
    socket.on('chat:message', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      io.to(room.code).emit('chat:message', {
        playerId: socket.id, playerName: player.name,
        message: data.message, type: 'chat',
      });
    });

    // ==================== DISCONNECT ====================
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      handlePlayerLeave(socket, io);
    });
  });
}

// ===== MODE 6: FACTS HELPERS =====

function startFactsMode(room, io) {
  if (!room.topicData) {
    io.to(room.code).emit('game:error', { error: 'Topic data not yet loaded. Wait a moment and try again.' });
    return;
  }
  room.state = 'playing';
  room.currentMode = 'facts';
  room.shownFactHashes = room.shownFactHashes || new Set();

  io.to(room.code).emit('game:started', {
    mode: 'facts',
    topic: room.topic,
    totalFacts: room.topicData.facts.length,
  });

  sendNextFact(room, io);
}

function sendNextFact(room, io) {
  if (!room.topicData) return;
  const fact = getNextFact(room.topicData, room.shownFactHashes);
  if (fact) {
    io.to(room.code).emit('facts:new', {
      text: fact.text,
      source: fact.source,
      title: fact.title || null,
      shown: room.shownFactHashes.size,
      total: room.topicData.facts.length,
    });
  } else {
    io.to(room.code).emit('facts:all_shown', { total: room.shownFactHashes.size });
  }
}

// ===== MODE 4: ACHIEVEMENT HELPERS =====

function startAchievementMode(room, io) {
  if (!room.topicData || room.topicData.entities.length === 0) {
    io.to(room.code).emit('game:error', { error: 'No entity data available for this topic. Try a different topic.' });
    return;
  }
  room.state = 'playing';
  room.currentMode = 'achievement';
  room.usedEntityIds = room.usedEntityIds || new Set();
  room.achievementState = { currentEntity: null, currentClueIndex: 0, buzzedPlayer: null, roundNumber: 0 };

  io.to(room.code).emit('game:started', {
    mode: 'achievement',
    topic: room.topic,
    totalEntities: room.topicData.entities.length,
  });

  nextAchievementRound(room, io);
}

function nextAchievementRound(room, io) {
  if (!room.topicData) return;
  clearTimers(room.code);

  const entity = getEntityForGuessing(room.topicData, room.usedEntityIds);
  if (!entity) {
    endAchievementMode(room, io);
    return;
  }

  const as = room.achievementState;
  as.currentEntity = entity;
  as.currentClueIndex = 0;
  as.buzzedPlayer = null;
  as.roundNumber++;

  io.to(room.code).emit('achievement:new_round', {
    roundNumber: as.roundNumber,
    totalClues: entity.clues.length,
  });

  // Send first clue after 2 seconds
  setTimeout(() => sendNextClue(room, io), 2000);
}

function sendNextClue(room, io) {
  const as = room.achievementState;
  if (!as || !as.currentEntity) return;

  if (as.currentClueIndex >= as.currentEntity.clues.length) {
    // All clues shown, reveal answer
    io.to(room.code).emit('achievement:reveal', {
      answer: as.currentEntity.name,
      description: as.currentEntity.description,
    });
    setTimeout(() => nextAchievementRound(room, io), 5000);
    return;
  }

  const clue = as.currentEntity.clues[as.currentClueIndex];
  as.currentClueIndex++;

  io.to(room.code).emit('achievement:clue', {
    text: clue.text,
    difficulty: clue.difficulty,
    clueNumber: as.currentClueIndex,
    totalClues: as.currentEntity.clues.length,
  });

  // Auto-advance to next clue after 12 seconds if no buzz
  const timer = setTimeout(() => {
    if (as.buzzedPlayer) return;
    sendNextClue(room, io);
  }, 12000);
  turnTimers.set(room.code, timer);
}

function resumeClueTimer(room, io) {
  const timer = setTimeout(() => {
    const as = room.achievementState;
    if (!as || as.buzzedPlayer) return;
    sendNextClue(room, io);
  }, 5000);
  turnTimers.set(room.code, timer);
}

function endAchievementMode(room, io) {
  clearTimers(room.code);
  room.state = 'finished';
  io.to(room.code).emit('game:ended', {
    standings: getStandings(room),
    reason: 'All entities guessed!',
  });
  room.gameState = null;
  room.achievementState = null;
  room.currentMode = null;
  for (const [, p] of room.players) p.score = 0;
  room.state = 'lobby';
}

// ===== SHARED HELPERS =====

function handlePlayerLeave(socket, io) {
  const result = leaveRoom(socket.id);
  if (!result) return;
  const { room, deleted } = result;
  if (deleted) { clearTimers(room.code); return; }

  socket.leave(room.code);
  io.to(room.code).emit('room:player_left', {
    playerId: socket.id,
    players: getPlayersArray(room),
    newHostId: room.hostId,
  });

  if (room.gameState && room.gameState.currentDrawer === socket.id && room.state === 'playing') {
    endTurn(room, io, 'drawer_left');
  }
}

function startTurnTimer(room, io) {
  clearTimers(room.code);
  const timer = setTimeout(() => endTurn(room, io, 'time_up'), room.gameState.roundTimeMs);
  turnTimers.set(room.code, timer);
}

function startHintTimer(room, io) {
  const interval = setInterval(() => {
    if (!room.gameState || room.gameState.phase !== 'drawing') { clearInterval(interval); return; }
    const hint = getNextHint(room);
    if (hint) {
      io.to(room.code).except(room.gameState.currentDrawer).emit('game:hint', { hint });
    } else { clearInterval(interval); }
  }, config.game.hintIntervalSeconds * 1000);
  hintTimers.set(room.code, interval);
}

function endTurn(room, io, reason) {
  clearTimers(room.code);
  const gs = room.gameState;
  if (!gs) return;

  gs.phase = 'round_end';
  io.to(room.code).emit('game:turn_end', { reason, word: gs.currentWord, players: getPlayersArray(room) });

  setTimeout(() => {
    if (!room.gameState || room.state !== 'playing') return;
    const turnResult = nextTurn(room);

    if (turnResult.gameOver) {
      room.state = 'finished';
      io.to(room.code).emit('game:ended', {
        standings: turnResult.standings,
        reason: turnResult.notEnoughPlayers ? 'Not enough players' : 'All rounds completed',
      });
      room.gameState = null;
      room.currentMode = null;
      for (const [, p] of room.players) p.score = 0;
      room.state = 'lobby';
      return;
    }

    const wordData = startWordChoice(room);
    io.to(room.code).emit('game:new_turn', { drawer: getPlayerInfo(room, wordData.drawerId), round: gs.currentRound });
    io.to(wordData.drawerId).emit('game:word_choices', { choices: wordData.choices });
  }, 5000);
}

function clearTimers(roomCode) {
  if (turnTimers.has(roomCode)) { clearTimeout(turnTimers.get(roomCode)); turnTimers.delete(roomCode); }
  if (hintTimers.has(roomCode)) { clearInterval(hintTimers.get(roomCode)); hintTimers.delete(roomCode); }
  if (turnTimers.has(roomCode + '_answer')) { clearTimeout(turnTimers.get(roomCode + '_answer')); turnTimers.delete(roomCode + '_answer'); }
}

function getPlayerInfo(room, playerId) {
  const p = room.players.get(playerId);
  return p ? { id: p.id, name: p.name, score: p.score, avatar: p.avatar } : null;
}

function getPlayersArray(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id, name: p.name, score: p.score, avatar: p.avatar, isHost: p.isHost,
  }));
}

export default { setupSocketHandlers };
