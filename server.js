const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./utils/gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 10000,
  pingInterval: 5000
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const gameManager = new GameManager();

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/game/:roomId', (req, res) => {
  const { roomId } = req.params;
  res.render('game', { roomId });
});

io.on('connection', (socket) => {

  socket.on('createRoom', (data, callback) => {
    try {
      const timeControl = (data && data.timeControl) ? data.timeControl : 600;
      const room = gameManager.createRoom(socket.id, timeControl);
      socket.join(room.id);
      if (typeof callback === 'function') {
        callback({ success: true, roomId: room.id, role: 'white' });
      }
      socket.emit('roleAssigned', { role: 'white', roomId: room.id });
      emitBoardState(room.id);
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  socket.on('joinRoom', (data, callback) => {
    try {
      if (!data || !data.roomId) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Room ID is required.' });
        }
        return;
      }
      const result = gameManager.joinRoom(data.roomId, socket.id);
      if (!result) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Room not found.' });
        }
        return;
      }
      socket.join(data.roomId);
      if (typeof callback === 'function') {
        callback({ success: true, roomId: data.roomId, role: result.role });
      }
      socket.emit('roleAssigned', { role: result.role, roomId: data.roomId });

      if (result.role === 'black') {
        io.to(data.roomId).emit('playerJoined', { role: 'black' });
      }

      emitBoardState(data.roomId);
      emitTimerUpdate(data.roomId);
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  socket.on('makeMove', (data, callback) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room) return;

      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role !== 'white' && role !== 'black') {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Spectators cannot move.' });
        }
        return;
      }

      const turn = room.chess.turn();
      if ((turn === 'w' && role !== 'white') || (turn === 'b' && role !== 'black')) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Not your turn.' });
        }
        return;
      }

      if (room.gameState !== 'playing' && room.gameState !== 'waiting') {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Game is not in progress.' });
        }
        return;
      }

      if (room.gameState === 'waiting') {
        if (!room.whitePlayer || !room.blackPlayer) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Waiting for opponent.' });
          }
          return;
        }
        room.gameState = 'playing';
        gameManager.startClock(data.roomId, (roomId, color) => {
          handleTimeout(roomId, color);
        });
      }

      const moveResult = gameManager.makeMove(data.roomId, {
        from: data.from,
        to: data.to,
        promotion: data.promotion || undefined
      });

      if (!moveResult) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Illegal move.' });
        }
        return;
      }

      gameManager.switchClock(data.roomId, (roomId, color) => {
        handleTimeout(roomId, color);
      });

      if (typeof callback === 'function') {
        callback({ success: true });
      }

      emitBoardState(data.roomId);
      emitTimerUpdate(data.roomId);

      const gameOverResult = gameManager.checkGameOver(data.roomId);
      if (gameOverResult) {
        gameManager.stopClock(data.roomId);
        room.gameState = 'over';
        io.to(data.roomId).emit('gameOver', gameOverResult);
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  socket.on('offerDraw', (data) => {
    try {
      if (!data || !data.roomId) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role !== 'white' && role !== 'black') return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || room.gameState !== 'playing') return;
      room.drawOffer = role;
      const opponentRole = role === 'white' ? 'black' : 'white';
      const opponentId = opponentRole === 'white' ? room.whitePlayer : room.blackPlayer;
      if (opponentId) {
        io.to(opponentId).emit('drawOffered', { from: role });
      }
    } catch (err) { /* silent */ }
  });

  socket.on('acceptDraw', (data) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || !room.drawOffer) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role === room.drawOffer) return;
      if (role !== 'white' && role !== 'black') return;

      gameManager.stopClock(data.roomId);
      room.gameState = 'over';
      io.to(data.roomId).emit('drawAccepted', {});
      io.to(data.roomId).emit('gameOver', { result: 'draw', reason: 'Agreement' });
      room.drawOffer = null;
    } catch (err) { /* silent */ }
  });

  socket.on('rejectDraw', (data) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || !room.drawOffer) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role === room.drawOffer) return;

      const offererRole = room.drawOffer;
      room.drawOffer = null;
      const offererId = offererRole === 'white' ? room.whitePlayer : room.blackPlayer;
      if (offererId) {
        io.to(offererId).emit('drawRejected', {});
      }
    } catch (err) { /* silent */ }
  });

  socket.on('undoRequest', (data) => {
    try {
      if (!data || !data.roomId) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role !== 'white' && role !== 'black') return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || room.gameState !== 'playing') return;
      if (room.moveHistory.length === 0) return;
      room.undoRequest = role;
      const opponentRole = role === 'white' ? 'black' : 'white';
      const opponentId = opponentRole === 'white' ? room.whitePlayer : room.blackPlayer;
      if (opponentId) {
        io.to(opponentId).emit('undoRequested', { from: role });
      }
    } catch (err) { /* silent */ }
  });

  socket.on('acceptUndo', (data) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || !room.undoRequest) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role === room.undoRequest) return;
      if (role !== 'white' && role !== 'black') return;

      const undone = gameManager.undoMove(data.roomId);
      if (undone) {
        room.undoRequest = null;
        io.to(data.roomId).emit('undoAccepted', {});
        emitBoardState(data.roomId);
        emitTimerUpdate(data.roomId);
      }
    } catch (err) { /* silent */ }
  });

  socket.on('rejectUndo', (data) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || !room.undoRequest) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role === room.undoRequest) return;

      const requesterId = room.undoRequest === 'white' ? room.whitePlayer : room.blackPlayer;
      room.undoRequest = null;
      if (requesterId) {
        io.to(requesterId).emit('undoRejected', {});
      }
    } catch (err) { /* silent */ }
  });

  socket.on('resign', (data) => {
    try {
      if (!data || !data.roomId) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role !== 'white' && role !== 'black') return;
      const room = gameManager.getRoom(data.roomId);
      if (!room || room.gameState !== 'playing') return;

      gameManager.stopClock(data.roomId);
      room.gameState = 'over';
      const winner = role === 'white' ? 'black' : 'white';
      io.to(data.roomId).emit('gameOver', { result: winner, reason: 'Resignation' });
    } catch (err) { /* silent */ }
  });

  socket.on('playAgain', (data) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room) return;
      const role = gameManager.getPlayerRole(data.roomId, socket.id);
      if (role !== 'white' && role !== 'black') return;

      if (!room.playAgainVotes) room.playAgainVotes = new Set();
      room.playAgainVotes.add(role);

      if (room.playAgainVotes.size >= 2) {
        gameManager.resetRoom(data.roomId);
        room.playAgainVotes = new Set();
        io.to(data.roomId).emit('gameRestarted', {});
        emitBoardState(data.roomId);
        emitTimerUpdate(data.roomId);
      } else {
        const opponentRole = role === 'white' ? 'black' : 'white';
        const opponentId = opponentRole === 'white' ? room.whitePlayer : room.blackPlayer;
        if (opponentId) {
          io.to(opponentId).emit('playAgainRequested', { from: role });
        }
      }
    } catch (err) { /* silent */ }
  });

  socket.on('reconnect_attempt', (data) => {
    try {
      if (!data || !data.roomId) return;
      const room = gameManager.getRoom(data.roomId);
      if (!room) return;

      const reconnected = gameManager.reconnectPlayer(data.roomId, data.previousId, socket.id);
      if (reconnected) {
        socket.join(data.roomId);
        socket.emit('roleAssigned', { role: reconnected.role, roomId: data.roomId });
        emitBoardState(data.roomId);
        emitTimerUpdate(data.roomId);
        io.to(data.roomId).emit('playerReconnected', { role: reconnected.role });
      } else {
        const joinResult = gameManager.joinRoom(data.roomId, socket.id);
        if (joinResult) {
          socket.join(data.roomId);
          socket.emit('roleAssigned', { role: joinResult.role, roomId: data.roomId });
          emitBoardState(data.roomId);
          emitTimerUpdate(data.roomId);
        }
      }
    } catch (err) { /* silent */ }
  });

  socket.on('disconnect', () => {
    try {
      const roomInfo = gameManager.findPlayerRoom(socket.id);
      if (!roomInfo) return;

      const { roomId, role } = roomInfo;
      const room = gameManager.getRoom(roomId);
      if (!room) return;

      if (role === 'spectator') {
        room.spectators = room.spectators.filter(id => id !== socket.id);
        return;
      }

      room.disconnectTimers = room.disconnectTimers || {};
      io.to(roomId).emit('playerDisconnected', { role });

      room.disconnectTimers[role] = setTimeout(() => {
        const currentRoom = gameManager.getRoom(roomId);
        if (!currentRoom) return;

        if (role === 'white' && currentRoom.whitePlayer === socket.id) {
          if (currentRoom.gameState === 'playing') {
            gameManager.stopClock(roomId);
            currentRoom.gameState = 'over';
            io.to(roomId).emit('gameOver', { result: 'black', reason: 'Abandonment' });
          }
          currentRoom.whitePlayer = null;
        } else if (role === 'black' && currentRoom.blackPlayer === socket.id) {
          if (currentRoom.gameState === 'playing') {
            gameManager.stopClock(roomId);
            currentRoom.gameState = 'over';
            io.to(roomId).emit('gameOver', { result: 'white', reason: 'Abandonment' });
          }
          currentRoom.blackPlayer = null;
        }

        if (!currentRoom.whitePlayer && !currentRoom.blackPlayer && currentRoom.spectators.length === 0) {
          gameManager.removeRoom(roomId);
        }
      }, 30000);
    } catch (err) { /* silent */ }
  });

  function emitBoardState(roomId) {
    const room = gameManager.getRoom(roomId);
    if (!room) return;

    const legalMoves = room.chess.moves({ verbose: true }).map(m => ({
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured || null,
      promotion: m.promotion || null,
      flags: m.flags
    }));

    const boardState = {
      fen: room.chess.fen(),
      pgn: room.chess.pgn(),
      turn: room.chess.turn(),
      moveHistory: room.moveHistory,
      lastMove: room.lastMove,
      inCheck: room.chess.in_check(),
      gameState: room.gameState,
      capturedPieces: gameManager.getCapturedPieces(roomId),
      whiteConnected: !!room.whitePlayer,
      blackConnected: !!room.blackPlayer,
      legalMoves
    };

    io.to(roomId).emit('boardUpdated', boardState);
  }

  function emitTimerUpdate(roomId) {
    const room = gameManager.getRoom(roomId);
    if (!room) return;

    io.to(roomId).emit('timerUpdate', {
      white: room.clocks.white,
      black: room.clocks.black,
      activeClock: room.clocks.activeClock
    });
  }

  function handleTimeout(roomId, color) {
    const room = gameManager.getRoom(roomId);
    if (!room || room.gameState !== 'playing') return;

    gameManager.stopClock(roomId);
    room.gameState = 'over';
    const winner = color === 'white' ? 'black' : 'white';
    io.to(roomId).emit('timerUpdate', {
      white: room.clocks.white,
      black: room.clocks.black,
      activeClock: null
    });
    io.to(roomId).emit('gameOver', { result: winner, reason: 'Timeout' });
  }
});

setInterval(() => {
  gameManager.broadcastTimers((roomId, timerData) => {
    io.to(roomId).emit('timerUpdate', timerData);
  });
}, 100);

setInterval(() => {
  gameManager.cleanupInactiveRooms();
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess server running on http://localhost:${PORT}`);
});
