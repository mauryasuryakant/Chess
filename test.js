const express = require("express")
const socket = require("socket.io")
const http = require("http")
const ejs = require("ejs")
const path = require("path")

const app = express();

const server = http.createServer(app)

const io = socket(server)

app.set("view engine", "ejs")
app.use(express.static(path.join(__dirname, "Public")))

app.get("/", (req,res) => {
    res.render("index")
})

io.on("connection", function (e) {
    console.log("connected");
    e.on("massage", function (){
        console.log("Got a massage");
    })
    e.emit("server-massage")
})

server.listen(3000, () => {
    console.log("Server started on localhost:3000");
})