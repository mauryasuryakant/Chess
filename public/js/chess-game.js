const PIECE_UNICODE = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
};

const CAPTURED_UNICODE = {
  q: { w: '♛', b: '♕' },
  r: { w: '♜', b: '♖' },
  b: { w: '♝', b: '♗' },
  n: { w: '♞', b: '♘' },
  p: { w: '♟', b: '♙' }
};

class ChessGame {
  constructor() {
    this.boardEl = document.getElementById('chessBoard');
    this.orientation = 'white';
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.selectedSquare = null;
    this.legalMovesForSelected = [];
    this.allLegalMoves = [];
    this.lastMove = null;
    this.inCheck = false;
    this.turn = 'w';
    this.moveHistory = [];
    this.role = null;
    this.gameState = 'waiting';
    this.draggedPiece = null;
    this.draggedFrom = null;
    this.pendingPromotion = null;
    this.positionCache = null;
    this.positionCacheFen = null;

    this.onMoveMade = null;
    this.onPromotionNeeded = null;

    this.initBoard();
    this.initLabels();
    this.bindEvents();
  }

  initBoard() {
    this.boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        sq.className = 'square';
        sq.dataset.row = r;
        sq.dataset.col = c;
        this.boardEl.appendChild(sq);
      }
    }
    this.renderPosition();
  }

  initLabels() {
    const rankLeft = document.getElementById('rankLabelsLeft');
    const fileBottom = document.getElementById('fileLabels');
    rankLeft.innerHTML = '';
    fileBottom.innerHTML = '';

    const ranks = this.orientation === 'white'
      ? ['8', '7', '6', '5', '4', '3', '2', '1']
      : ['1', '2', '3', '4', '5', '6', '7', '8'];

    const files = this.orientation === 'white'
      ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];

    ranks.forEach(r => {
      const el = document.createElement('div');
      el.className = 'rank-label';
      el.textContent = r;
      rankLeft.appendChild(el);
    });

    files.forEach(f => {
      const el = document.createElement('div');
      el.className = 'file-label';
      el.textContent = f;
      fileBottom.appendChild(el);
    });
  }

  bindEvents() {
    this.boardEl.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.boardEl.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this.handleTouchEnd(e));
  }

  handleMouseDown(e) {
    const sq = e.target.closest('.square');
    if (!sq) return;

    const row = parseInt(sq.dataset.row);
    const col = parseInt(sq.dataset.col);
    const algebraic = this.coordsToAlgebraic(row, col);
    const piece = this.getPieceAt(algebraic);

    if (this.selectedSquare) {
      const isLegal = this.legalMovesForSelected.some(m => m.to === algebraic);
      if (isLegal) {
        this.tryMove(this.selectedSquare, algebraic);
        return;
      }
    }

    if (piece && this.canInteract(piece)) {
      this.selectSquare(algebraic);
      this.startDrag(e, sq, piece, algebraic);
    } else if (this.selectedSquare) {
      this.clearSelection();
    }
  }

  handleMouseMove(e) {
    if (!this.draggedPiece) return;
    e.preventDefault();
    this.draggedPiece.style.left = (e.clientX - this.draggedPiece._offsetX) + 'px';
    this.draggedPiece.style.top = (e.clientY - this.draggedPiece._offsetY) + 'px';
  }

  handleMouseUp(e) {
    if (!this.draggedPiece) return;
    const target = this.getSquareFromPoint(e.clientX, e.clientY);
    this.endDrag(target);
  }

  handleTouchStart(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;
    const sqEl = el.closest('.square');
    if (!sqEl) return;

    const row = parseInt(sqEl.dataset.row);
    const col = parseInt(sqEl.dataset.col);
    const algebraic = this.coordsToAlgebraic(row, col);
    const piece = this.getPieceAt(algebraic);

    if (this.selectedSquare) {
      const isLegal = this.legalMovesForSelected.some(m => m.to === algebraic);
      if (isLegal) {
        e.preventDefault();
        this.tryMove(this.selectedSquare, algebraic);
        return;
      }
    }

    if (piece && this.canInteract(piece)) {
      e.preventDefault();
      this.selectSquare(algebraic);
      this.startDrag(touch, sqEl, piece, algebraic);
    } else if (this.selectedSquare) {
      this.clearSelection();
    }
  }

  handleTouchMove(e) {
    if (!this.draggedPiece) return;
    e.preventDefault();
    const touch = e.touches[0];
    this.draggedPiece.style.left = (touch.clientX - this.draggedPiece._offsetX) + 'px';
    this.draggedPiece.style.top = (touch.clientY - this.draggedPiece._offsetY) + 'px';
  }

  handleTouchEnd(e) {
    if (!this.draggedPiece) return;
    const touch = e.changedTouches[0];
    const target = this.getSquareFromPoint(touch.clientX, touch.clientY);
    this.endDrag(target);
  }

  startDrag(e, sqEl, piece, from) {
    const pieceEl = sqEl.querySelector('.piece');
    if (!pieceEl) return;

    const rect = pieceEl.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : e.pageX;
    const clientY = e.clientY !== undefined ? e.clientY : e.pageY;

    this.draggedFrom = from;

    const clone = pieceEl.cloneNode(true);
    clone.classList.add('dragging');
    clone._offsetX = rect.width / 2;
    clone._offsetY = rect.height / 2;
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.style.left = (clientX - clone._offsetX) + 'px';
    clone.style.top = (clientY - clone._offsetY) + 'px';
    document.body.appendChild(clone);
    this.draggedPiece = clone;

    pieceEl.style.opacity = '0.3';
    this._dragOrigPiece = pieceEl;
  }

  endDrag(targetSquare) {
    if (this._dragOrigPiece) {
      this._dragOrigPiece.style.opacity = '1';
      this._dragOrigPiece = null;
    }

    if (this.draggedPiece) {
      this.draggedPiece.remove();
      this.draggedPiece = null;
    }

    if (targetSquare && this.draggedFrom) {
      const from = this.draggedFrom;
      const to = targetSquare;
      this.draggedFrom = null;

      if (from !== to) {
        const isLegal = this.legalMovesForSelected.some(m => m.to === to);
        if (isLegal) {
          this.tryMove(from, to);
          return;
        }
      }
    }

    this.draggedFrom = null;
  }

  getSquareFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const sq = el.closest('.square');
    if (!sq) return null;
    return this.coordsToAlgebraic(parseInt(sq.dataset.row), parseInt(sq.dataset.col));
  }

  canInteract(piece) {
    if (this.gameState !== 'playing' && this.gameState !== 'waiting') return false;
    if (this.role === 'spectator') return false;
    if (!this.role) return false;

    const pieceColor = piece.charAt(0);
    if (this.role === 'white' && pieceColor !== 'w') return false;
    if (this.role === 'black' && pieceColor !== 'b') return false;
    if ((this.turn === 'w' && pieceColor !== 'w') || (this.turn === 'b' && pieceColor !== 'b')) return false;

    return true;
  }

  selectSquare(algebraic) {
    this.selectedSquare = algebraic;
    this.legalMovesForSelected = this.allLegalMoves.filter(m => m.from === algebraic);
    this.renderPosition();
  }

  clearSelection() {
    this.selectedSquare = null;
    this.legalMovesForSelected = [];
    this.renderPosition();
  }

  tryMove(from, to) {
    const isPromotion = this.isPromotionMove(from, to);
    if (isPromotion) {
      this.pendingPromotion = { from, to };
      if (this.onPromotionNeeded) {
        const color = this.turn;
        this.onPromotionNeeded(color);
      }
      return;
    }

    this.clearSelection();
    if (this.onMoveMade) {
      this.onMoveMade(from, to, undefined);
    }
  }

  completePromotion(piece) {
    if (!this.pendingPromotion) return;
    const { from, to } = this.pendingPromotion;
    this.pendingPromotion = null;
    this.clearSelection();
    if (this.onMoveMade) {
      this.onMoveMade(from, to, piece);
    }
  }

  isPromotionMove(from, to) {
    const matchingMoves = this.allLegalMoves.filter(m => m.from === from && m.to === to);
    return matchingMoves.some(m => m.promotion);
  }

  updateFromServer(data) {
    this.fen = data.fen;
    this.turn = data.turn;
    this.moveHistory = data.moveHistory || [];
    this.lastMove = data.lastMove || null;
    this.inCheck = data.inCheck || false;
    this.gameState = data.gameState || 'waiting';
    this.allLegalMoves = data.legalMoves || [];
    this.positionCache = null;
    this.positionCacheFen = null;
    this.clearSelection();
    this.renderPosition();
    this.updateMoveList();
    this.updateCapturedPieces(data.capturedPieces);
    this.updateGameStatus(data);
  }

  getPosition() {
    if (this.positionCacheFen === this.fen && this.positionCache) {
      return this.positionCache;
    }
    this.positionCache = this.parseFEN(this.fen);
    this.positionCacheFen = this.fen;
    return this.positionCache;
  }

  renderPosition() {
    const position = this.getPosition();
    const squares = this.boardEl.querySelectorAll('.square');

    squares.forEach(sq => {
      const row = parseInt(sq.dataset.row);
      const col = parseInt(sq.dataset.col);

      const boardRow = this.orientation === 'white' ? row : 7 - row;
      const boardCol = this.orientation === 'white' ? col : 7 - col;

      const isLight = (boardRow + boardCol) % 2 === 0;
      sq.className = 'square ' + (isLight ? 'light' : 'dark');

      const algebraic = this.boardCoordsToAlgebraic(boardRow, boardCol);

      if (this.lastMove) {
        if (algebraic === this.lastMove.from || algebraic === this.lastMove.to) {
          sq.classList.add('highlighted');
        }
      }

      if (this.selectedSquare === algebraic) {
        sq.classList.add('selected');
      }

      const legalTarget = this.legalMovesForSelected.find(m => m.to === algebraic);
      if (legalTarget) {
        const targetPiece = position[boardRow] ? position[boardRow][boardCol] : null;
        sq.classList.add(targetPiece ? 'legal-capture' : 'legal-move');
      }

      const piece = position[boardRow] ? position[boardRow][boardCol] : null;

      if (this.inCheck && piece) {
        const kingPiece = this.turn === 'w' ? 'wk' : 'bk';
        if (piece === kingPiece) {
          sq.classList.add('check');
        }
      }

      sq.innerHTML = '';
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece';
        pieceEl.textContent = PIECE_UNICODE[piece] || '';
        sq.appendChild(pieceEl);
      }
    });
  }

  parseFEN(fen) {
    const position = [];
    const rows = fen.split(' ')[0].split('/');

    for (let r = 0; r < 8; r++) {
      position[r] = [];
      let col = 0;
      for (let i = 0; i < rows[r].length; i++) {
        const ch = rows[r][i];
        if (ch >= '1' && ch <= '8') {
          for (let e = 0; e < parseInt(ch); e++) {
            position[r][col++] = null;
          }
        } else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          position[r][col++] = color + ch.toLowerCase();
        }
      }
    }
    return position;
  }

  coordsToAlgebraic(viewRow, viewCol) {
    const boardRow = this.orientation === 'white' ? viewRow : 7 - viewRow;
    const boardCol = this.orientation === 'white' ? viewCol : 7 - viewCol;
    return this.boardCoordsToAlgebraic(boardRow, boardCol);
  }

  boardCoordsToAlgebraic(boardRow, boardCol) {
    return 'abcdefgh'[boardCol] + (8 - boardRow);
  }

  algebraicToBoardCoords(algebraic) {
    return {
      row: 8 - parseInt(algebraic[1]),
      col: 'abcdefgh'.indexOf(algebraic[0])
    };
  }

  getPieceAt(algebraic) {
    const position = this.getPosition();
    const { row, col } = this.algebraicToBoardCoords(algebraic);
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    return position[row] ? position[row][col] : null;
  }

  flipBoard() {
    this.orientation = this.orientation === 'white' ? 'black' : 'white';
    this.initLabels();
    this.renderPosition();
    this.updatePlayerBars();
  }

  setOrientation(color) {
    this.orientation = color;
    this.initLabels();
    this.renderPosition();
    this.updatePlayerBars();
  }

  updateMoveList() {
    const movesEl = document.getElementById('movesList');
    const countEl = document.getElementById('moveCount');

    if (!this.moveHistory || this.moveHistory.length === 0) {
      movesEl.innerHTML = '<div class="moves-empty">No moves yet</div>';
      countEl.textContent = '0';
      return;
    }

    countEl.textContent = this.moveHistory.length;
    let html = '';

    for (let i = 0; i < this.moveHistory.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteMove = this.moveHistory[i];
      const blackMove = this.moveHistory[i + 1];

      html += '<div class="move-row">';
      html += `<span class="move-number">${moveNum}.</span>`;
      html += `<span class="move-san">${whiteMove.san}</span>`;
      html += blackMove ? `<span class="move-san">${blackMove.san}</span>` : '<span></span>';
      html += '</div>';
    }

    movesEl.innerHTML = html;
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  updateCapturedPieces(captured) {
    if (!captured) return;

    const topCaptured = document.getElementById('topCaptured');
    const bottomCaptured = document.getElementById('bottomCaptured');

    const topColor = this.orientation === 'white' ? 'b' : 'w';
    const bottomColor = this.orientation === 'white' ? 'w' : 'b';

    const topPieces = topColor === 'w' ? captured.black : captured.white;
    const bottomPieces = bottomColor === 'w' ? captured.black : captured.white;

    topCaptured.innerHTML = (topPieces || []).map(p => {
      const displayColor = topColor === 'w' ? 'b' : 'w';
      return `<span class="captured-piece">${(CAPTURED_UNICODE[p] && CAPTURED_UNICODE[p][displayColor]) || ''}</span>`;
    }).join('');

    bottomCaptured.innerHTML = (bottomPieces || []).map(p => {
      const displayColor = bottomColor === 'w' ? 'b' : 'w';
      return `<span class="captured-piece">${(CAPTURED_UNICODE[p] && CAPTURED_UNICODE[p][displayColor]) || ''}</span>`;
    }).join('');
  }

  updatePlayerBars() {
    const topName = document.getElementById('topPlayerName');
    const bottomName = document.getElementById('bottomPlayerName');
    const topAvatar = document.getElementById('topPlayerAvatar');
    const bottomAvatar = document.getElementById('bottomPlayerAvatar');

    if (this.orientation === 'white') {
      topName.textContent = 'Black';
      bottomName.textContent = 'White';
      topAvatar.textContent = 'B';
      topAvatar.className = 'player-avatar';
      bottomAvatar.textContent = 'W';
      bottomAvatar.className = 'player-avatar accent';
    } else {
      topName.textContent = 'White';
      bottomName.textContent = 'Black';
      topAvatar.textContent = 'W';
      topAvatar.className = 'player-avatar accent';
      bottomAvatar.textContent = 'B';
      bottomAvatar.className = 'player-avatar';
    }
  }

  updateGameStatus(data) {
    const statusEl = document.getElementById('gameStatus');
    const icon = statusEl.querySelector('.status-icon');
    const text = statusEl.querySelector('.status-text');

    if (data.gameState === 'waiting') {
      icon.textContent = '⏳';
      text.textContent = 'Waiting for opponent...';
    } else if (data.gameState === 'playing') {
      if (data.inCheck) {
        icon.textContent = '⚠️';
        text.textContent = (data.turn === 'w' ? 'White' : 'Black') + ' is in check!';
      } else {
        icon.textContent = '♟';
        text.textContent = (data.turn === 'w' ? 'White' : 'Black') + "'s turn";
      }
    } else if (data.gameState === 'over') {
      icon.textContent = '🏁';
      text.textContent = 'Game over';
    }
  }

  updateActionButtons() {
    const drawBtn = document.getElementById('drawBtn');
    const undoBtn = document.getElementById('undoBtn');
    const resignBtn = document.getElementById('resignBtn');

    const isPlayer = this.role === 'white' || this.role === 'black';
    const isPlaying = this.gameState === 'playing';

    if (drawBtn) drawBtn.style.display = isPlayer ? '' : 'none';
    if (undoBtn) undoBtn.style.display = isPlayer ? '' : 'none';
    if (resignBtn) resignBtn.style.display = isPlayer ? '' : 'none';

    if (drawBtn) drawBtn.disabled = !isPlaying;
    if (undoBtn) undoBtn.disabled = !isPlaying;
    if (resignBtn) resignBtn.disabled = !isPlaying;
  }
}

window.ChessGame = ChessGame;
