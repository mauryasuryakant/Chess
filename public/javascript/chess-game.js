const socket = io()
const chess = new Chess()
const chassBoard = document.querySelector(".chessBoard")

let draggedPiece = null
let sourceSquare = null
let playerRole = null

const getPieceUnicode = (piece) => {
    const pieces = {
        wp: "♙",
        wr: "♖",
        wn: "♘",
        wb: "♗",
        wq: "♕",
        wk: "♔",

        bp: "♟",
        br: "♜",
        bn: "♞",
        bb: "♝",
        bq: "♛",
        bk: "♚"
    }

    return pieces[piece.color + piece.type]
}

const handleMove = (sourceSquare, targetSquare) => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

    socket.emit("move", {
        from: files[sourceSquare.col] + (8 - sourceSquare.row),
        to: files[targetSquare.col] + (8 - targetSquare.row),
        promotion: "q"
    })
}

const renderBoard = () => {
    const board = chess.board()

    chassBoard.innerHTML = ""

    board.forEach((row, rowIndex) => {
        row.forEach((square, squareIndex) => {

            const squareElement = document.createElement("div")

            squareElement.classList.add(
                "square",
                (rowIndex + squareIndex) % 2 === 0
                    ? "light"
                    : "dark"
            )

            squareElement.dataset.row = rowIndex
            squareElement.dataset.col = squareIndex

            squareElement.addEventListener("dragover", (e) => {
                e.preventDefault()
            })

            squareElement.addEventListener("drop", (e) => {
                e.preventDefault()

                if (draggedPiece) {
                    const targetSquare = {
                        row: parseInt(squareElement.dataset.row),
                        col: parseInt(squareElement.dataset.col)
                    }

                    handleMove(sourceSquare, targetSquare)
                }
            })

            if (square) {

                const pieceElement = document.createElement("div")

                pieceElement.classList.add(
                    "piece",
                    square.color === "w"
                        ? "white"
                        : "black"
                )

                pieceElement.innerText = getPieceUnicode(square)

                pieceElement.draggable = playerRole === square.color

                pieceElement.addEventListener("dragstart", (e) => {

                    draggedPiece = pieceElement

                    sourceSquare = {
                        row: rowIndex,
                        col: squareIndex
                    }

                    e.dataTransfer.setData("text/plain", "")
                })

                pieceElement.addEventListener("dragend", () => {
                    draggedPiece = null
                    sourceSquare = null
                })

                squareElement.appendChild(pieceElement)
            }

            chassBoard.appendChild(squareElement)
        })
    })
}

socket.on("playerRole", (role) => {
    playerRole = role
    renderBoard()
})

socket.on("spectatorRole", () => {
    playerRole = null
    renderBoard()
})

socket.on("boardState", (fen) => {
    chess.load(fen)
    renderBoard()
})

renderBoard()