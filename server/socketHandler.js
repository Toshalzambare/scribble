import { createRoom, joinRoom, leaveRoom, findPlayerRoom, serializeRoom, getRoom } from './roomManager.js';
import { initGameState, startWordChoice, chooseWord, checkGuess, getNextHint, nextTurn, getStandings } from './gameEngine.js';
import config from './config.js';

const turnTimers = new Map();
const hintTimers = new Map();

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // --- Room Events ---
    socket.on('room:create', (data, callback) => {
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
        callback({ success: true, room: serializeRoom(room) });
      } catch (err) {
        callback({ success: false, error: err.message });
      }
    });

    socket.on('room:join', (data, callback) => {
      try {
        const result = joinRoom(data.code, socket.id, data.playerName || 'Player');
        if (result.error) {
          callback({ success: false, error: result.error });
          return;
        }
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

    socket.on('room:leave', () => {
      handlePlayerLeave(socket, io);
    });

    // --- Game Events ---
    socket.on('game:start', (_, callback) => {
      const room = findPlayerRoom(socket.id);
      if (!room) return callback?.({ success: false, error: 'Not in a room' });
      if (room.hostId !== socket.id) return callback?.({ success: false, error: 'Only the host can start' });
      if (room.players.size < config.game.minPlayersToStart) {
        return callback?.({ success: false, error: `Need at least ${config.game.minPlayersToStart} players` });
      }

      room.state = 'playing';
      room.gameState = initGameState(room);
      const wordData = startWordChoice(room);

      io.to(room.code).emit('game:started', {
        round: 1,
        maxRounds: room.gameState.maxRounds,
        drawer: getPlayerInfo(room, wordData.drawerId),
      });

      // Send word choices only to the drawer
      io.to(wordData.drawerId).emit('game:word_choices', { choices: wordData.choices });
      callback?.({ success: true });
    });

    socket.on('game:choose_word', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || !room.gameState) return;
      if (socket.id !== room.gameState.currentDrawer) return;

      const result = chooseWord(room, data.word);

      // Tell everyone drawing started (but not the actual word)
      io.to(room.code).emit('game:drawing_started', {
        maskedWord: result.maskedWord,
        wordLength: result.wordLength,
        roundTime: room.settings.roundTime,
      });

      // Start turn timer
      startTurnTimer(room, io);
      startHintTimer(room, io);
    });

    socket.on('game:draw', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room || !room.gameState) return;
      if (socket.id !== room.gameState.currentDrawer) return;
      // Broadcast drawing data to everyone except drawer
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

      if (result.isDrawer) return;
      if (result.alreadyGuessed) return;

      if (result.correct) {
        io.to(room.code).emit('game:correct_guess', {
          playerId: socket.id,
          playerName: result.guesserName,
          points: result.guesserPoints,
          players: Array.from(room.players.values()).map((p) => ({
            id: p.id, name: p.name, score: p.score, avatar: p.avatar,
          })),
        });

        if (result.allGuessed) {
          endTurn(room, io, 'all_guessed');
        }
      } else if (result.close) {
        socket.emit('game:close_guess');
      } else {
        // Broadcast as chat message
        io.to(room.code).emit('chat:message', {
          playerId: socket.id,
          playerName: room.players.get(socket.id)?.name || 'Unknown',
          message: data.guess,
          type: 'guess',
        });
      }
    });

    // --- Chat ---
    socket.on('chat:message', (data) => {
      const room = findPlayerRoom(socket.id);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;

      io.to(room.code).emit('chat:message', {
        playerId: socket.id,
        playerName: player.name,
        message: data.message,
        type: 'chat',
      });
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      handlePlayerLeave(socket, io);
    });
  });
}

function handlePlayerLeave(socket, io) {
  const result = leaveRoom(socket.id);
  if (!result) return;

  const { room, deleted } = result;
  if (deleted) {
    clearTimers(room.code);
    return;
  }

  socket.leave(room.code);
  io.to(room.code).emit('room:player_left', {
    playerId: socket.id,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id, name: p.name, score: p.score, isHost: p.isHost, avatar: p.avatar,
    })),
    newHostId: room.hostId,
  });

  // If the drawer left during a game, skip to next turn
  if (room.gameState && room.gameState.currentDrawer === socket.id && room.state === 'playing') {
    endTurn(room, io, 'drawer_left');
  }
}

function startTurnTimer(room, io) {
  clearTimers(room.code);
  const timer = setTimeout(() => {
    endTurn(room, io, 'time_up');
  }, room.gameState.roundTimeMs);
  turnTimers.set(room.code, timer);
}

function startHintTimer(room, io) {
  const interval = setInterval(() => {
    if (!room.gameState || room.gameState.phase !== 'drawing') {
      clearInterval(interval);
      return;
    }
    const hint = getNextHint(room);
    if (hint) {
      // Send hint to everyone except the drawer
      const drawerSocket = room.gameState.currentDrawer;
      io.to(room.code).except(drawerSocket).emit('game:hint', { hint });
    } else {
      clearInterval(interval);
    }
  }, config.game.hintIntervalSeconds * 1000);
  hintTimers.set(room.code, interval);
}

function endTurn(room, io, reason) {
  clearTimers(room.code);
  const gs = room.gameState;
  if (!gs) return;

  gs.phase = 'round_end';
  io.to(room.code).emit('game:turn_end', {
    reason,
    word: gs.currentWord,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id, name: p.name, score: p.score, avatar: p.avatar,
    })),
  });

  // After 5 seconds, start next turn
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
      // Reset scores
      for (const [, p] of room.players) p.score = 0;
      room.state = 'lobby';
      return;
    }

    const wordData = startWordChoice(room);
    io.to(room.code).emit('game:new_turn', {
      drawer: getPlayerInfo(room, wordData.drawerId),
      round: gs.currentRound,
    });
    io.to(wordData.drawerId).emit('game:word_choices', { choices: wordData.choices });
  }, 5000);
}

function clearTimers(roomCode) {
  if (turnTimers.has(roomCode)) {
    clearTimeout(turnTimers.get(roomCode));
    turnTimers.delete(roomCode);
  }
  if (hintTimers.has(roomCode)) {
    clearInterval(hintTimers.get(roomCode));
    hintTimers.delete(roomCode);
  }
}

function getPlayerInfo(room, playerId) {
  const p = room.players.get(playerId);
  return p ? { id: p.id, name: p.name, score: p.score, avatar: p.avatar } : null;
}

export default { setupSocketHandlers };
