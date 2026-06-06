(function () {
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  const game = new ChessGame();
  let myRole = null;

  const previousSocketId = sessionStorage.getItem('chess_socketId');
  const savedRole = sessionStorage.getItem('chess_role');
  const savedRoomId = sessionStorage.getItem('chess_roomId');

  socket.on('connect', () => {
    updateConnectionStatus(true);
    sessionStorage.setItem('chess_socketId', socket.id);

    if (savedRoomId === ROOM_ID && previousSocketId && previousSocketId !== socket.id) {
      socket.emit('reconnect_attempt', {
        roomId: ROOM_ID,
        previousId: previousSocketId
      });
    } else {
      if (savedRoomId === ROOM_ID && savedRole) {
        if (savedRole === 'white') {
          socket.emit('createRoom', { timeControl: 600 }, (resp) => {
            if (!resp.success) {
              socket.emit('joinRoom', { roomId: ROOM_ID });
            }
          });
        } else {
          socket.emit('joinRoom', { roomId: ROOM_ID });
        }
      } else {
        socket.emit('joinRoom', { roomId: ROOM_ID });
      }
    }
  });

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
  });

  socket.on('roleAssigned', (data) => {
    myRole = data.role;
    game.role = data.role;
    sessionStorage.setItem('chess_role', data.role);

    const roleText = document.getElementById('roleText');
    const roleBadge = document.getElementById('roleBadge');

    roleText.textContent = data.role.charAt(0).toUpperCase() + data.role.slice(1);

    if (data.role === 'white') {
      roleBadge.style.background = 'rgba(255,255,255,0.1)';
      roleBadge.style.color = '#fff';
      roleBadge.style.borderColor = 'rgba(255,255,255,0.2)';
      game.setOrientation('white');
    } else if (data.role === 'black') {
      roleBadge.style.background = 'rgba(80,80,80,0.3)';
      roleBadge.style.color = '#ccc';
      roleBadge.style.borderColor = 'rgba(150,150,150,0.3)';
      game.setOrientation('black');
    } else {
      roleBadge.style.background = 'var(--accent-dim)';
      roleBadge.style.color = 'var(--accent)';
      roleBadge.style.borderColor = 'rgba(129,182,76,0.3)';
      game.setOrientation('white');
    }

    game.updateActionButtons();
  });

  socket.on('boardUpdated', (data) => {
    game.updateFromServer(data);
    game.updateActionButtons();
  });

  socket.on('timerUpdate', (data) => {
    updateTimers(data);
  });

  socket.on('playerJoined', (data) => {
    showToast(`${data.role.charAt(0).toUpperCase() + data.role.slice(1)} player joined`, 'success');
  });

  socket.on('moveMade', () => {});

  socket.on('gameOver', (data) => {
    game.gameState = 'over';
    game.updateActionButtons();
    showGameOverModal(data);
  });

  socket.on('drawOffered', () => {
    showModal('drawOfferModal');
  });

  socket.on('drawAccepted', () => {
    hideModal('drawOfferModal');
    showToast('Draw accepted', 'info');
  });

  socket.on('drawRejected', () => {
    showToast('Draw offer declined', 'info');
  });

  socket.on('undoRequested', () => {
    showModal('undoOfferModal');
  });

  socket.on('undoAccepted', () => {
    hideModal('undoOfferModal');
    showToast('Undo accepted', 'success');
  });

  socket.on('undoRejected', () => {
    showToast('Undo request declined', 'info');
  });

  socket.on('playerDisconnected', (data) => {
    showToast(`${data.role.charAt(0).toUpperCase() + data.role.slice(1)} disconnected`, 'error');
  });

  socket.on('playerReconnected', (data) => {
    showToast(`${data.role.charAt(0).toUpperCase() + data.role.slice(1)} reconnected`, 'success');
  });

  socket.on('gameRestarted', () => {
    hideModal('gameOverModal');
    showToast('New game started!', 'success');
    game.gameState = 'waiting';
    game.updateActionButtons();
  });

  socket.on('playAgainRequested', () => {
    showToast('Opponent wants to play again', 'info');
  });

  game.onMoveMade = (from, to, promotion) => {
    socket.emit('makeMove', {
      roomId: ROOM_ID,
      from,
      to,
      promotion
    }, (response) => {
      if (response && !response.success) {
        showToast(response.error || 'Invalid move', 'error');
      }
    });
  };

  game.onPromotionNeeded = (color) => {
    showPromotionModal(color);
  };

  document.getElementById('flipBtn').addEventListener('click', () => {
    game.flipBoard();
    updateTimersDisplay();
  });

  document.getElementById('drawBtn').addEventListener('click', () => {
    if (myRole !== 'white' && myRole !== 'black') return;
    socket.emit('offerDraw', { roomId: ROOM_ID });
    showToast('Draw offered', 'info');
  });

  document.getElementById('undoBtn').addEventListener('click', () => {
    if (myRole !== 'white' && myRole !== 'black') return;
    socket.emit('undoRequest', { roomId: ROOM_ID });
    showToast('Undo requested', 'info');
  });

  document.getElementById('resignBtn').addEventListener('click', () => {
    if (myRole !== 'white' && myRole !== 'black') return;
    if (confirm('Are you sure you want to resign?')) {
      socket.emit('resign', { roomId: ROOM_ID });
    }
  });

  document.getElementById('acceptDrawBtn').addEventListener('click', () => {
    socket.emit('acceptDraw', { roomId: ROOM_ID });
    hideModal('drawOfferModal');
  });

  document.getElementById('rejectDrawBtn').addEventListener('click', () => {
    socket.emit('rejectDraw', { roomId: ROOM_ID });
    hideModal('drawOfferModal');
  });

  document.getElementById('acceptUndoBtn').addEventListener('click', () => {
    socket.emit('acceptUndo', { roomId: ROOM_ID });
    hideModal('undoOfferModal');
  });

  document.getElementById('rejectUndoBtn').addEventListener('click', () => {
    socket.emit('rejectUndo', { roomId: ROOM_ID });
    hideModal('undoOfferModal');
  });

  document.getElementById('playAgainBtn').addEventListener('click', () => {
    socket.emit('playAgain', { roomId: ROOM_ID });
    showToast('Waiting for opponent...', 'info');
  });

  document.getElementById('copyRoomBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(ROOM_ID).then(() => {
      showToast('Room ID copied!', 'success');
    }).catch(() => {
      const input = document.createElement('input');
      input.value = ROOM_ID;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast('Room ID copied!', 'success');
    });
  });

  let lastTimerData = null;

  function updateTimers(data) {
    lastTimerData = data;
    updateTimersDisplay();
  }

  function updateTimersDisplay() {
    if (!lastTimerData) return;
    const data = lastTimerData;

    const topTimerEl = document.getElementById('topTimer');
    const bottomTimerEl = document.getElementById('bottomTimer');

    const topColor = game.orientation === 'white' ? 'black' : 'white';
    const bottomColor = game.orientation === 'white' ? 'white' : 'black';

    topTimerEl.textContent = formatTime(data[topColor]);
    bottomTimerEl.textContent = formatTime(data[bottomColor]);

    topTimerEl.className = 'timer';
    bottomTimerEl.className = 'timer';

    if (data.activeClock === topColor) {
      topTimerEl.classList.add('active');
      if (data[topColor] <= 30) topTimerEl.classList.add('low-time');
    }
    if (data.activeClock === bottomColor) {
      bottomTimerEl.classList.add('active');
      if (data[bottomColor] <= 30) bottomTimerEl.classList.add('low-time');
    }
  }

  function formatTime(seconds) {
    if (seconds === undefined || seconds === null) return '10:00';
    seconds = Math.max(0, seconds);
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    if (seconds < 10) {
      return `${m}:${s.toString().padStart(2, '0')}.${tenths}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function showPromotionModal(color) {
    const modal = document.getElementById('promotionModal');
    const options = document.getElementById('promotionOptions');

    const pieces = [
      { type: 'q', w: '♕', b: '♛' },
      { type: 'r', w: '♖', b: '♜' },
      { type: 'b', w: '♗', b: '♝' },
      { type: 'n', w: '♘', b: '♞' }
    ];

    options.innerHTML = pieces.map(p => {
      const unicode = color === 'w' ? p.w : p.b;
      return `<div class="promotion-option" data-piece="${p.type}">${unicode}</div>`;
    }).join('');

    options.querySelectorAll('.promotion-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const piece = opt.dataset.piece;
        game.completePromotion(piece);
        hideModal('promotionModal');
      });
    });

    showModal('promotionModal');
  }

  function showGameOverModal(data) {
    const icon = document.getElementById('gameOverIcon');
    const title = document.getElementById('gameOverTitle');
    const reason = document.getElementById('gameOverReason');

    if (data.result === 'draw') {
      icon.textContent = '🤝';
      title.textContent = 'Draw';
      reason.textContent = data.reason || 'Game drawn';
    } else {
      const winnerName = data.result === 'white' ? 'White' : 'Black';
      if (data.result === myRole) {
        icon.textContent = '🏆';
        title.textContent = 'You Win!';
      } else if (myRole === 'spectator') {
        icon.textContent = '🏁';
        title.textContent = winnerName + ' Wins!';
      } else {
        icon.textContent = '😔';
        title.textContent = 'You Lose';
      }
      reason.textContent = `${winnerName} wins by ${data.reason || 'unknown'}`;
    }

    showModal('gameOverModal');
  }

  function showModal(id) {
    document.getElementById(id).classList.add('active');
  }

  function hideModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3000);
  }

  function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('span:last-child');

    if (connected) {
      dot.className = 'status-dot connected';
      text.textContent = 'Connected';
    } else {
      dot.className = 'status-dot';
      text.textContent = 'Reconnecting...';
    }
  }
})();
