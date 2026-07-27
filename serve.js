const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT = 7000;
const MIME = {
    ".html": "text/html",
    ".js":   "application/javascript",
    ".wasm": "application/wasm",
    ".css":  "text/css",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".mp3":  "audio/mpeg",
};

http.createServer((req, res) => {
    let filePath = "." + req.url.split("?")[0];
    if (filePath === "./") filePath = "./index.html";

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(filePath)] || "text/plain",
            "Cross-Origin-Opener-Policy":   "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "same-origin",
        });
        res.end(data);
    });
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));