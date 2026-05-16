import { getWordChoices } from './wordBank.js';
import { getTopicWords } from './topicEngine.js';

/**
 * Game Engine for Mode 1: Classic Draw & Guess
 */

export function initGameState(room) {
  const playerIds = Array.from(room.players.keys());
  for (let i = playerIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
  }

  return {
    mode: 'classic_draw_guess',
    currentRound: 1,
    maxRounds: room.settings.maxRounds,
    turnOrder: playerIds,
    currentTurnIndex: 0,
    currentDrawer: playerIds[0],
    currentWord: null,
    wordChoices: null,
    wordChosen: false,
    hints: [],
    hintIndex: 0,
    roundStartTime: null,
    roundTimeMs: room.settings.roundTime * 1000,
    guessedPlayers: new Set(),
    phase: 'choosing',
  };
}

export function startWordChoice(room) {
  const gs = room.gameState;
  gs.phase = 'choosing';
  gs.wordChosen = false;
  // Use Topic Engine words if available, fall back to static word bank
  if (room.topicData) {
    gs.wordChoices = getTopicWords(room.topicData, 3);
  } else {
    gs.wordChoices = getWordChoices(room.topic);
  }
  gs.currentWord = null;
  gs.guessedPlayers = new Set();
  gs.hints = [];
  gs.hintIndex = 0;
  return { drawerId: gs.currentDrawer, choices: gs.wordChoices };
}

export function chooseWord(room, word) {
  const gs = room.gameState;
  gs.currentWord = word;
  gs.wordChosen = true;
  gs.phase = 'drawing';
  gs.roundStartTime = Date.now();
  gs.hints = generateHints(word);
  gs.hintIndex = 0;
  return { wordLength: word.length, maskedWord: maskWord(word) };
}

export function checkGuess(room, playerId, guess) {
  const gs = room.gameState;
  if (playerId === gs.currentDrawer) return { correct: false, isDrawer: true };
  if (gs.guessedPlayers.has(playerId)) return { correct: false, alreadyGuessed: true };

  const ng = guess.toLowerCase().trim();
  const nw = gs.currentWord.toLowerCase().trim();

  if (ng === nw) {
    gs.guessedPlayers.add(playerId);
    const elapsed = Date.now() - gs.roundStartTime;
    const remaining = gs.roundTimeMs - elapsed;
    const timeRatio = Math.max(0, remaining / gs.roundTimeMs);
    const guesserPoints = Math.round(50 + 200 * timeRatio);
    const drawerPoints = Math.round(25 + 50 * timeRatio);

    const guesser = room.players.get(playerId);
    const drawer = room.players.get(gs.currentDrawer);
    if (guesser) guesser.score += guesserPoints;
    if (drawer) drawer.score += drawerPoints;

    const allGuessed = gs.guessedPlayers.size >= room.players.size - 1;
    return { correct: true, guesserPoints, drawerPoints, allGuessed, guesserName: guesser?.name };
  }

  if (nw.length > 5 && isCloseGuess(ng, nw)) return { correct: false, close: true };
  return { correct: false };
}

export function getNextHint(room) {
  const gs = room.gameState;
  if (gs.hintIndex < gs.hints.length) return gs.hints[gs.hintIndex++];
  return null;
}

export function nextTurn(room) {
  const gs = room.gameState;
  gs.currentTurnIndex++;

  if (gs.currentTurnIndex >= gs.turnOrder.length) {
    gs.currentTurnIndex = 0;
    gs.currentRound++;
    if (gs.currentRound > gs.maxRounds) {
      gs.phase = 'game_end';
      return { gameOver: true, standings: getStandings(room) };
    }
  }

  gs.turnOrder = gs.turnOrder.filter((id) => room.players.has(id));
  if (gs.turnOrder.length < 2) {
    gs.phase = 'game_end';
    return { gameOver: true, notEnoughPlayers: true, standings: getStandings(room) };
  }

  gs.currentTurnIndex = gs.currentTurnIndex % gs.turnOrder.length;
  gs.currentDrawer = gs.turnOrder[gs.currentTurnIndex];
  return { gameOver: false, nextDrawer: gs.currentDrawer, currentRound: gs.currentRound };
}

export function getStandings(room) {
  return Array.from(room.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, avatar: p.avatar, id: p.id }));
}

function maskWord(word) {
  return word.split('').map((c) => (c === ' ' ? '  ' : '_')).join(' ');
}

function generateHints(word) {
  const hints = [];
  const chars = word.split('');
  const indices = chars.map((c, i) => (c !== ' ' ? i : -1)).filter((i) => i !== -1);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const perHint = Math.max(1, Math.floor(indices.length * 0.3));
  const revealed = new Set();
  for (let h = 0; h < 3 && revealed.size < indices.length; h++) {
    for (let r = 0; r < perHint && revealed.size < indices.length; r++) {
      revealed.add(indices[revealed.size]);
    }
    hints.push(chars.map((c, i) => (c === ' ' ? '  ' : revealed.has(i) ? c : '_')).join(' '));
  }
  return hints;
}

function isCloseGuess(guess, answer) {
  if (Math.abs(guess.length - answer.length) > 2) return false;
  let d = 0;
  for (let i = 0; i < Math.max(guess.length, answer.length); i++) {
    if (guess[i] !== answer[i]) d++;
    if (d > 2) return false;
  }
  return d <= 2;
}

export default { initGameState, startWordChoice, chooseWord, checkGuess, getNextHint, nextTurn, getStandings };
