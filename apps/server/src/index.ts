import { createServer } from './server';

const port = Number(process.env.PORT ?? 2567);
const server = createServer();
await server.listen(port);
console.log(`Tabletop server listening on ws://0.0.0.0:${port}`);

const stop = () => void server.gracefullyShutdown(true);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
