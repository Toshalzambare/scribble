import crypto from 'crypto';
import config from './config.js';

/**
 * In-memory room storage.
 * Rooms are ephemeral — they exist only while players are connected.
 */
const rooms = new Map();

/**
 * Generate a unique 6-character room code
 */
function generateRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(code));
  return code;
}

/**
 * Create a new room
 * @param {object} options
 * @param {string} options.hostId - Socket ID of the host
 * @param {string} options.hostName - Display name of the host
 * @param {string} options.topic - Room topic
 * @param {string} options.roomName - Display name for the room
 * @param {number} [options.gridSize] - Pixel grid size
 * @param {number} [options.maxPlayers] - Max players allowed
 * @param {number} [options.roundTime] - Seconds per round
 * @param {number} [options.maxRounds] - Total rounds
 * @returns {object} The created room
 */
export function createRoom({
  hostId,
  hostName,
  topic,
  roomName,
  gridSize = config.game.defaultGridSize,
  maxPlayers = config.game.maxPlayersPerRoom,
  roundTime = config.game.roundTimeSeconds,
  maxRounds = config.game.maxRounds,
}) {
  const code = generateRoomCode();
  const room = {
    code,
    name: roomName || `${topic} Room`,
    topic: topic || 'general',
    hostId,
    settings: {
      gridSize,
      maxPlayers,
      roundTime,
      maxRounds,
    },
    players: new Map(),
    state: 'lobby', // lobby | playing | finished
    gameState: null,
    createdAt: Date.now(),
  };

  // Add host as first player
  room.players.set(hostId, {
    id: hostId,
    name: hostName,
    score: 0,
    isHost: true,
    isConnected: true,
    avatar: getRandomAvatar(),
  });

  rooms.set(code, room);
  console.log(`[Room] Created room ${code} (topic: ${room.topic}) by ${hostName}`);
  return room;
}

/**
 * Join an existing room
 * @param {string} code - Room code
 * @param {string} playerId - Socket ID
 * @param {string} playerName - Display name
 * @returns {object|null} The room, or null if join failed
 */
export function joinRoom(code, playerId, playerName) {
  const room = rooms.get(code.toUpperCase());

  if (!room) {
    return { error: 'Room not found. Check the code and try again.' };
  }

  if (room.state !== 'lobby') {
    return { error: 'Game already in progress. Wait for the next round.' };
  }

  if (room.players.size >= room.settings.maxPlayers) {
    return { error: `Room is full (${room.settings.maxPlayers} players max).` };
  }

  // Check for duplicate names
  for (const [, player] of room.players) {
    if (player.name.toLowerCase() === playerName.toLowerCase()) {
      playerName = `${playerName}_${Math.floor(Math.random() * 99)}`;
    }
  }

  room.players.set(playerId, {
    id: playerId,
    name: playerName,
    score: 0,
    isHost: false,
    isConnected: true,
    avatar: getRandomAvatar(),
  });

  console.log(`[Room] ${playerName} joined room ${code}`);
  return { room };
}

/**
 * Remove a player from their room
 * @param {string} playerId
 * @returns {object|null} The room they left, or null
 */
export function leaveRoom(playerId) {
  for (const [code, room] of rooms) {
    if (room.players.has(playerId)) {
      const player = room.players.get(playerId);
      room.players.delete(playerId);
      console.log(`[Room] ${player.name} left room ${code}`);

      // If room is empty, delete it
      if (room.players.size === 0) {
        rooms.delete(code);
        console.log(`[Room] Room ${code} deleted (empty)`);
        return { room, deleted: true };
      }

      // If host left, transfer host to next player
      if (player.isHost) {
        const newHost = room.players.values().next().value;
        if (newHost) {
          newHost.isHost = true;
          room.hostId = newHost.id;
          console.log(`[Room] Host transferred to ${newHost.name} in room ${code}`);
        }
      }

      return { room, deleted: false };
    }
  }
  return null;
}

/**
 * Get room by code
 */
export function getRoom(code) {
  return rooms.get(code.toUpperCase()) || null;
}

/**
 * Find which room a player is in
 */
export function findPlayerRoom(playerId) {
  for (const [, room] of rooms) {
    if (room.players.has(playerId)) {
      return room;
    }
  }
  return null;
}

/**
 * Serialize room data for client (converts Maps to arrays)
 */
export function serializeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    topic: room.topic,
    hostId: room.hostId,
    settings: room.settings,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isHost: p.isHost,
      avatar: p.avatar,
    })),
    state: room.state,
    createdAt: room.createdAt,
  };
}

/**
 * Random avatar for players (emoji-based for v1)
 */
function getRandomAvatar() {
  const avatars = [
    '🦊', '🐱', '🐶', '🐼', '🐨', '🦁', '🐯', '🐸',
    '🐵', '🦄', '🐲', '🦅', '🐧', '🐙', '🦋', '🐬',
    '🦉', '🐺', '🦈', '🐢',
  ];
  return avatars[Math.floor(Math.random() * avatars.length)];
}

export default {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  findPlayerRoom,
  serializeRoom,
};
