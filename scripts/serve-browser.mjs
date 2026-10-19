import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const port = Number(process.env.ACTION_FLOW_PORT ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json" };
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const pathname = new URL(request.url, "http://localhost").pathname;
    const path = pathname === "/" ? "playground/browser/index.html" : pathname.slice(1);
    if (!/^(?:playground\/browser\/|packages\/core\/dist\/)/u.test(path) || path.split("/").some((part) => part.startsWith(".")) || /[%\\]/u.test(path)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const extension = path.slice(path.lastIndexOf("."));
    const content = await readFile(fileURLToPath(new URL(path, root)));
    response.writeHead(200, { "Content-Type": types[extension] ?? "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`ActionFlow browser checks: http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
