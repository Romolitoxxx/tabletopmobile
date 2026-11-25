import { join } from 'node:path';
import { createServer } from './server';
import { SqliteTableStore } from './store';

// Configuration (environment):
//   PORT      listening port (default 2567)
//   DATA_DIR  folder of the SQLite database (default ./data)
const port = Number(process.env.PORT ?? 2567);
const store = new SqliteTableStore(join(process.env.DATA_DIR ?? 'data', 'tables.sqlite'));
const server = createServer({ store });
// The stored tables are reopened before the port opens (see GatedTransport).
await server.listen(port);
console.log(`Tabletop server listening on port ${port}`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  // Disposing the rooms writes every table to the store.
  void server.gracefullyShutdown(false).finally(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
