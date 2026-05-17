import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3001');

function App() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-4xl font-bold mb-4 text-blue-400">Dynamic Skribble</h1>
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <span className="font-semibold">Server Status:</span>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        
        <p className="text-gray-300 text-sm mb-6 text-center">
          Phase 1 initialized. The backend and frontend are now communicating successfully.
        </p>

        <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-200">
          Create Room
        </button>
      </div>
    </div>
  );
}

export default App;
