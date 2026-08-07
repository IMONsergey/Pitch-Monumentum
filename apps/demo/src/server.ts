import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root=resolve(process.argv[2]??".pitch-demo"); const port=Number(process.argv[3]??"4173");
const server=createServer(async(req:any,res:any)=>{try{const path=req.url==="/"?join(root,"preview","deck.html"):join(root,req.url.replace(/^\//,""));const data=await readFile(path);res.writeHead(200,{"Content-Type":path.endsWith(".html")?"text/html; charset=utf-8":"application/octet-stream"});res.end(data);}catch{res.writeHead(404);res.end("Not found");}});
server.listen(port,"127.0.0.1",()=>console.log(`PitchOS preview: http://127.0.0.1:${port}`));
