const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');

class GameManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(playerId, timeControl = 600) {
    const roomId = uuidv4().slice(0, 8);
    const chess = new Chess();

    const room = {
      id: roomId,
      chess,
      whitePlayer: playerId,
      blackPlayer: null,
      spectators: [],
      moveHistory: [],
      clocks: {
        white: timeControl,
        black: timeControl,
        activeClock: null,
        lastTick: null,
        interval: null,
        timeControl
      },
      lastMove: null,
      gameState: 'waiting',
      drawOffer: null,
      undoRequest: null,
      disconnectTimers: {},
      playAgainVotes: new Set(),
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  joinRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.whitePlayer === playerId) {
      return { role: 'white' };
    }
    if (room.blackPlayer === playerId) {
      return { role: 'black' };
    }

    if (!room.blackPlayer) {
      room.blackPlayer = playerId;
      if (room.disconnectTimers.black) {
        clearTimeout(room.disconnectTimers.black);
        delete room.disconnectTimers.black;
      }
      return { role: 'black' };
    }

    room.spectators.push(playerId);
    return { role: 'spectator' };
  }

  getPlayerRole(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.whitePlayer === playerId) return 'white';
    if (room.blackPlayer === playerId) return 'black';
    if (room.spectators.includes(playerId)) return 'spectator';
    return null;
  }

  findPlayerRoom(playerId) {
    for (const [roomId, room] of this.rooms) {
      if (room.whitePlayer === playerId) return { roomId, role: 'white' };
      if (room.blackPlayer === playerId) return { roomId, role: 'black' };
      if (room.spectators.includes(playerId)) return { roomId, role: 'spectator' };
    }
    return null;
  }

  makeMove(roomId, moveData) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.lastActivity = Date.now();
    room.drawOffer = null;
    room.undoRequest = null;

    try {
      const move = room.chess.move(moveData);
      if (!move) return null;

      room.moveHistory.push({
        san: move.san,
        from: move.from,
        to: move.to,
        color: move.color,
        piece: move.piece,
        captured: move.captured || null,
        promotion: move.promotion || null,
        flags: move.flags
      });

      room.lastMove = { from: move.from, to: move.to };
      return move;
    } catch (err) {
      return null;
    }
  }

  undoMove(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const undone = room.chess.undo();
    if (!undone) return false;

    room.moveHistory.pop();
    room.lastMove = room.moveHistory.length > 0
      ? { from: room.moveHistory[room.moveHistory.length - 1].from, to: room.moveHistory[room.moveHistory.length - 1].to }
      : null;

    return true;
  }

  checkGameOver(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.chess.in_checkmate()) {
      const winner = room.chess.turn() === 'w' ? 'black' : 'white';
      return { result: winner, reason: 'Checkmate' };
    }
    if (room.chess.in_stalemate()) {
      return { result: 'draw', reason: 'Stalemate' };
    }
    if (room.chess.in_threefold_repetition()) {
      return { result: 'draw', reason: 'Threefold Repetition' };
    }
    if (room.chess.insufficient_material()) {
      return { result: 'draw', reason: 'Insufficient Material' };
    }
    if (room.chess.in_draw()) {
      return { result: 'draw', reason: 'Fifty-Move Rule' };
    }
    return null;
  }

  startClock(roomId, onTimeout) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clocks.activeClock = 'white';
    room.clocks.lastTick = Date.now();

    if (room.clocks.interval) {
      clearInterval(room.clocks.interval);
    }

    room.clocks.interval = setInterval(() => {
      if (!room.clocks.activeClock || room.gameState !== 'playing') return;

      const now = Date.now();
      const elapsed = (now - room.clocks.lastTick) / 1000;
      room.clocks.lastTick = now;

      room.clocks[room.clocks.activeClock] -= elapsed;

      if (room.clocks[room.clocks.activeClock] <= 0) {
        room.clocks[room.clocks.activeClock] = 0;
        const timedOutColor = room.clocks.activeClock;
        room.clocks.activeClock = null;
        clearInterval(room.clocks.interval);
        room.clocks.interval = null;
        if (onTimeout) onTimeout(roomId, timedOutColor);
      }
    }, 100);
  }

  switchClock(roomId, onTimeout) {
    const room = this.rooms.get(roomId);
    if (!room || !room.clocks.activeClock) return;

    const now = Date.now();
    const elapsed = (now - room.clocks.lastTick) / 1000;
    room.clocks[room.clocks.activeClock] -= elapsed;

    if (room.clocks[room.clocks.activeClock] <= 0) {
      room.clocks[room.clocks.activeClock] = 0;
      const timedOutColor = room.clocks.activeClock;
      room.clocks.activeClock = null;
      this.stopClock(roomId);
      if (onTimeout) onTimeout(roomId, timedOutColor);
      return;
    }

    room.clocks.activeClock = room.clocks.activeClock === 'white' ? 'black' : 'white';
    room.clocks.lastTick = now;
  }

  stopClock(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.clocks.interval) {
      clearInterval(room.clocks.interval);
      room.clocks.interval = null;
    }
    room.clocks.activeClock = null;
  }

  broadcastTimers(emitFn) {
    for (const [roomId, room] of this.rooms) {
      if (room.gameState === 'playing' && room.clocks.activeClock) {
        emitFn(roomId, {
          white: Math.max(0, room.clocks.white),
          black: Math.max(0, room.clocks.black),
          activeClock: room.clocks.activeClock
        });
      }
    }
  }

  getCapturedPieces(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { white: [], black: [] };

    const captured = { white: [], black: [] };

    for (const move of room.moveHistory) {
      if (move.captured) {
        if (move.color === 'w') {
          captured.white.push(move.captured);
        } else {
          captured.black.push(move.captured);
        }
      }
    }

    const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    captured.white.sort((a, b) => order[a] - order[b]);
    captured.black.sort((a, b) => order[a] - order[b]);

    return captured;
  }

  resetRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.stopClock(roomId);
    room.chess = new Chess();
    room.moveHistory = [];
    room.lastMove = null;
    room.gameState = 'waiting';
    room.drawOffer = null;
    room.undoRequest = null;
    room.clocks.white = room.clocks.timeControl;
    room.clocks.black = room.clocks.timeControl;
    room.clocks.activeClock = null;
    room.clocks.lastTick = null;
    room.lastActivity = Date.now();
  }

  reconnectPlayer(roomId, previousId, newId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.whitePlayer === previousId) {
      room.whitePlayer = newId;
      if (room.disconnectTimers.white) {
        clearTimeout(room.disconnectTimers.white);
        delete room.disconnectTimers.white;
      }
      return { role: 'white' };
    }

    if (room.blackPlayer === previousId) {
      room.blackPlayer = newId;
      if (room.disconnectTimers.black) {
        clearTimeout(room.disconnectTimers.black);
        delete room.disconnectTimers.black;
      }
      return { role: 'black' };
    }

    return null;
  }

  removeRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      this.stopClock(roomId);
      if (room.disconnectTimers) {
        Object.values(room.disconnectTimers).forEach(t => clearTimeout(t));
      }
    }
    this.rooms.delete(roomId);
  }

  cleanupInactiveRooms() {
    const now = Date.now();
    const maxInactive = 30 * 60 * 1000;

    for (const [roomId, room] of this.rooms) {
      if (now - room.lastActivity > maxInactive && room.gameState !== 'playing') {
        this.removeRoom(roomId);
      }
    }
  }
}

module.exports = GameManager;
