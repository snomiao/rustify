#!/usr/bin/env node
// rustify throwaway npm registry v1 — zero dependencies, runs on node or bun.
//
// Accepts `npm publish` and serves installs, so a release can be installed and
// run on every platform BEFORE anything reaches the real registry. No auth and
// no durability: never point real users at it.
//
//   registry.mjs <storage-dir> [port]     prints the URL once it is listening
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to the URL of a registry that keeps its data in `storageDir`.
export function startRegistry(storageDir, port = 0) {
const storage = path.resolve(storageDir);
fs.mkdirSync(storage, { recursive: true });

const fileFor = (name) => path.join(storage, encodeURIComponent(name) + ".json");
const load = (name) => (fs.existsSync(fileFor(name)) ? JSON.parse(fs.readFileSync(fileFor(name), "utf8")) : null);
const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const base = `http://${req.headers.host}`;
  const url = decodeURIComponent(new URL(req.url, base).pathname).replace(/^\/+/, "");
  const tarball = url.match(/^(.+)\/-\/([^/]+\.tgz)$/);
  if (req.method === "GET" && tarball) {
    const file = path.join(storage, path.basename(tarball[2]));
    if (!fs.existsSync(file)) return send(res, 404, { error: "no such tarball" });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === "GET") {
    const doc = load(url);
    return doc ? send(res, 200, doc) : send(res, 404, { error: "not found" });
  }
  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const doc = load(body.name) || { _id: body.name, name: body.name, "dist-tags": {}, versions: {}, time: {} };
      for (const [version, manifest] of Object.entries(body.versions || {})) {
        if (doc.versions[version]) {
          return send(res, 403, {
            error: `You cannot publish over the previously published versions: ${version}.`,
          });
        }
        const file = path.basename(manifest.dist.tarball);
        manifest.dist.tarball = `${base}/${body.name}/-/${file}`;
        doc.versions[version] = manifest;
        doc.time[version] = new Date().toISOString();
      }
      for (const [file, attachment] of Object.entries(body._attachments || {})) {
        fs.writeFileSync(path.join(storage, path.basename(file)), Buffer.from(attachment.data, "base64"));
      }
      Object.assign(doc["dist-tags"], body["dist-tags"] || {});
      fs.writeFileSync(fileFor(body.name), JSON.stringify(doc));
      send(res, 201, { ok: true });
    });
    return;
  }
  send(res, 404, { error: "unsupported" });
});

return new Promise((resolve) => {
  server.listen(port, "127.0.0.1", () => {
    server.unref();
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
  });
});
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const registry = await startRegistry(process.argv[2] || "registry-data", Number(process.argv[3] || 0));
  console.log(registry.url);
  setInterval(() => {}, 1 << 30); // stay up until killed
}
