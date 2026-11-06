var https = require("https");
var http = require("http");
var fs = require("fs");
var path = require("path");

var certPath = path.join(__dirname, "cert.pem");
var keyPath = path.join(__dirname, "key.pem");
var options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

var CRLF = "\r\n";

var server = https.createServer(options, function (cReq, cRes) {
  var opts = {
    hostname: "localhost",
    port: 5173,
    path: cReq.url,
    method: cReq.method,
    headers: Object.assign({}, cReq.headers, { host: "localhost:5173" }),
  };
  var pReq = http.request(opts, function (pRes) {
    cRes.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(cRes);
  });
  pReq.on("error", function () {
    if (!cRes.headersSent) cRes.writeHead(502);
    cRes.end("unavailable");
  });
  cReq.pipe(pReq);
});

server.on("upgrade", function (req, socket) {
  var opts = {
    hostname: "localhost",
    port: 5173,
    path: req.url,
    method: "GET",
    headers: Object.assign({}, req.headers, { host: "localhost:5173" }),
  };
  var pReq = http.request(opts);
  pReq.on("upgrade", function (pRes, pSocket, pHead) {
    var h = "HTTP/1.1 101 Switching Protocols" + CRLF;
    for (var i = 0; i < pRes.rawHeaders.length; i += 2) {
      h += pRes.rawHeaders[i] + ": " + pRes.rawHeaders[i + 1] + CRLF;
    }
    h += CRLF;
    socket.write(h);
    if (pHead.length > 0) socket.write(pHead);
    pSocket.pipe(socket);
    socket.pipe(pSocket);
  });
  pReq.on("error", function () {
    socket.destroy();
  });
  pReq.end();
});

server.listen(5174, "0.0.0.0", function () {
  console.log("HTTPS proxy on https://0.0.0.0:5174");
});
