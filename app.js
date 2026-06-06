const express = require('express')
const socket = require('socket.io')
const { Chess } = require('chess.js')
const http = require('http')
const ejs = require("ejs")
const path = require("path")

const app = express()

const server = http.createServer(app)

const io = socket(server)

const chess = new Chess()

let player = {}
let currentPlayer = "W"

app.set("view engine", "ejs")
app.use(express.static(path.join(__dirname, "public")))

app.get("/", (req, res) => {
    res.render("index", { title: "Chess Game" })
})


io.on("connection", (socket) => {
    console.log("Player connected");
    if (!player.white) {
        player.white = socket.id;
        socket.emit("PlayerRole", "White")
    } else if (!player.black) {
        player.black = socket.id;
        socket.emit("PlayerRole", "Black")
    } else {
        socket.emit("PlayerRole", "Spectator")
    }

    io.on("disconnect", () => {
        if (player.white === socket.id) {
            delete player.white
        } else if (player.black === socket.id) {
            delete player.black
        }
    })

    socket.on("move", (move) => {
        try {
            if (chess.turn == "w" && socket.id !== player.white) return
            if (chess.turn == "b" && socket.id !== player.black) return

            const result = chess.move(move)

            if (result) {
                currentPlayer = chess.turn()
                io.emit("move", move)
                io.emit("currentBoardState", chess.fen())
            } else {
                console.log("Invalid Move :-", move);
                socket.emit("InvalidMove", move)
            }
            
        } catch (err) {
            console.log(err);
            socket.emit("InvalidMove", move)
            // socket.emit("Invalid Move", move);

        }
    })
})











server.listen(3000, () => {
    console.log("listening on 3000");
})