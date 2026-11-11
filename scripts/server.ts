import {createServer} from 'node:http';
import next from 'next';
import {serveAPI} from '../src/server/node-handler';
import {upgradeRealtime} from '../src/server/producer-realtime';

const dev=process.argv.includes('--dev');
const port=Number(process.env.PORT||5173),hostname=process.env.HOSTNAME||'127.0.0.1';
const server=createServer();
// Next installs its own upgrade listener when it serves the first page.
// Give it a separate dispatcher so that listener never also consumes voice sockets.
const nextUpgrades=createServer();
const app=next({dev,hostname,port,httpServer:nextUpgrades});
await app.prepare();
const handle=app.getRequestHandler(),upgrade=app.getUpgradeHandler();
server.on('request',(request,response)=>{
  // Keep API and realtime work in one module graph, SQLite owner and task registry.
  if(request.url?.startsWith('/api/'))void serveAPI(request,response);
  else void handle(request,response);
});
server.on('upgrade',(request,socket,head)=>{
  void upgradeRealtime(request,socket,head).then(handled=>{if(!handled){if(nextUpgrades.listenerCount('upgrade'))nextUpgrades.emit('upgrade',request,socket,head);else void upgrade(request,socket,head)}}).catch(()=>socket.destroy());
});
server.listen(port,hostname,()=>console.log(`Demotif ${dev?'development':'production'}: http://${hostname}:${port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{server.closeAllConnections();server.close();void app.close().finally(()=>process.exit(0))});
