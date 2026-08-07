import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CodexEvent, CodexRequestTransport } from "./codex-gateway.js";

type Pending={resolve:(v:unknown)=>void;reject:(e:Error)=>void};
export class JsonlStdioTransport implements CodexRequestTransport {
  private child:any; private nextId=1; private pending=new Map<number,Pending>(); private listeners=new Set<(e:CodexEvent)=>void>();
  constructor(command="codex",args=["app-server"]){
    this.child=spawn(command,args,{stdio:["pipe","pipe","pipe"]});
    const rl=createInterface({input:this.child.stdout});
    rl.on("line",(line:string)=>this.handleLine(line));
    this.child.on("exit",(code:number)=>{for(const p of this.pending.values())p.reject(new Error(`Codex App Server exited: ${code}`));this.pending.clear();});
  }
  private handleLine(line:string){ let msg:any;try{msg=JSON.parse(line)}catch{return;} if(typeof msg.id==="number"&&this.pending.has(msg.id)){const p=this.pending.get(msg.id)!;this.pending.delete(msg.id);if(msg.error)p.reject(new Error(JSON.stringify(msg.error)));else p.resolve(msg.result);return;} if(typeof msg.method==="string")for(const l of this.listeners)l({method:msg.method,params:msg.params}); }
  request<T=unknown>(method:string,params?:unknown):Promise<T>{const id=this.nextId++;return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve:resolve as any,reject});this.child.stdin.write(`${JSON.stringify({id,method,params:params??{}})}\n`);});}
  subscribe(listener:(event:CodexEvent)=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  close(){this.child.kill();}
}
