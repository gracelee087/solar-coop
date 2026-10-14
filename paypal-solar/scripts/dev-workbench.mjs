import { createServer } from 'node:http';
import next from 'next';
const hostname = '127.0.0.1';
const port = Number(process.env.PORT ?? 3007);
const app = next({ dev: true, hostname, port, dir: process.cwd() });
await app.prepare();
const handler = app.getRequestHandler();
createServer((req, res) => handler(req, res)).listen(port, hostname, () => console.log(`Operator desk: http://${hostname}:${port}/coop`));
