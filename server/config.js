import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  game: {
    defaultGridSize: parseInt(process.env.DEFAULT_GRID_SIZE || '64', 10),
    maxPlayersPerRoom: parseInt(process.env.MAX_PLAYERS_PER_ROOM || '20', 10),
    roundTimeSeconds: parseInt(process.env.ROUND_TIME_SECONDS || '80', 10),
    maxRounds: parseInt(process.env.MAX_ROUNDS || '3', 10),
    hintIntervalSeconds: 20,
    minPlayersToStart: 2,
  },

  isDev() {
    return this.nodeEnv === 'development';
  },

  isProd() {
    return this.nodeEnv === 'production';
  },
};

export default config;
