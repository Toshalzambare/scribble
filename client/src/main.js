import './styles/main.css';
import { connectSocket } from './core/socket.js';
import { registerRoute, initRouter } from './core/router.js';
import { renderHome } from './views/home.js';
import { renderLobby } from './views/lobby.js';
import { renderGame } from './views/game.js';

// Connect socket
connectSocket();

// Register routes
registerRoute('home', renderHome);
registerRoute('lobby', renderLobby);
registerRoute('game', renderGame);

// Init router
const appEl = document.getElementById('app');
initRouter(appEl);
