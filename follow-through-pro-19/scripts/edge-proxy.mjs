/**
 * Local stand-in for deploy/Caddyfile plus the tunnel, for testing the
 * deployed topology on a machine without Caddy: one origin that routes
 * /api/v1/* to the API (:8082), /relay (WebSocket) to the signaling relay
 * (:8080) and everything else to the web app's node-server build (:3000),
 * forwarding the headers Caddy forwards.
 *
 *   node scripts/edge-proxy.mjs [key.pem cert.pem]
 *
 * Plain HTTP on :8090 always; HTTPS on :8443 when a key and certificate are
 * given (self-signed is fine: `openssl req -x509 -newkey rsa:2048 -nodes
 * -keyout key.pem -out cert.pem -days 2 -subj /CN=<ip> -addext
 * subjectAltName=IP:<ip>`). The camera API needs a secure context, so a
 * browser on another device, or scripts/live-check.mjs, uses the HTTPS
 * port with this machine's LAN address.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const routes = [
  { test: (p) => p.startsWith("/api/v1/") || p === "/api/v1", port: 8082 },
  { test: (p) => p === "/relay", port: 8080, rewrite: () => "/" },
  { test: () => true, port: 3000 },
];
const pick = (url) => routes.find((r) => r.test(new URL(url, "http://x").pathname));

function forwarded(req) {
  return {
    ...req.headers,
    "x-forwarded-proto": req.socket.encrypted ? "https" : "http",
    "x-forwarded-host": req.headers.host,
    "x-forwarded-for": req.socket.remoteAddress,
  };
}

function onRequest(req, res) {
  const r = pick(req.url);
  const proxy = http.request(
    {
      host: "127.0.0.1",
      port: r.port,
      method: req.method,
      path: r.rewrite ? r.rewrite(req.url) : req.url,
      headers: forwarded(req),
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  proxy.on("error", (e) => {
    res.writeHead(502);
    res.end(String(e));
  });
  req.pipe(proxy);
}

function onUpgrade(req, socket, head) {
  const r = pick(req.url);
  const upstream = net.connect(r.port, "127.0.0.1", () => {
    const path = r.rewrite ? r.rewrite(req.url) : req.url;
    const lines = [`${req.method} ${path} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) lines.push(`${k}: ${v}`);
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
}

const plain = http.createServer(onRequest);
plain.on("upgrade", onUpgrade);
plain.listen(8090, "0.0.0.0", () => console.log("edge proxy: http on :8090"));

const [key, cert] = process.argv.slice(2);
if (key && cert) {
  const tls = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    onRequest,
  );
  tls.on("upgrade", onUpgrade);
  tls.listen(8443, "0.0.0.0", () => console.log("edge proxy: https on :8443"));
}
