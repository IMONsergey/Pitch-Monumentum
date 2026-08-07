export interface CodexEvent { method:string; params?:unknown; }
export interface CodexRequestTransport { request<T=unknown>(method:string,params?:unknown):Promise<T>; subscribe(listener:(event:CodexEvent)=>void):()=>void; }
export interface ThreadHandle { threadId:string; parentThreadId?:string; }

export interface CodexGateway {
  startThread(params?:Record<string,unknown>):Promise<ThreadHandle>;
  resumeThread(threadId:string):Promise<ThreadHandle>;
  forkThread(threadId:string):Promise<ThreadHandle>;
  startTurn(threadId:string,input:string):Promise<unknown>;
  onEvent(listener:(event:CodexEvent)=>void):()=>void;
}

function threadIdFrom(result:unknown):string {
  const r=result as any; const id=r?.thread?.id ?? r?.threadId ?? r?.id;
  if(typeof id!=="string"||!id) throw new Error("Codex App Server response did not contain a thread id");
  return id;
}

export class AppServerCodexGateway implements CodexGateway {
  constructor(private readonly transport:CodexRequestTransport) {}
  async startThread(params:Record<string,unknown>={}):Promise<ThreadHandle> { const result=await this.transport.request("thread/start",params); return {threadId:threadIdFrom(result)}; }
  async resumeThread(threadId:string):Promise<ThreadHandle> { const result=await this.transport.request("thread/resume",{threadId}); return {threadId:threadIdFrom(result)}; }
  async forkThread(threadId:string):Promise<ThreadHandle> { const result=await this.transport.request("thread/fork",{threadId}); return {threadId:threadIdFrom(result),parentThreadId:threadId}; }
  async startTurn(threadId:string,input:string):Promise<unknown> { return this.transport.request("turn/start",{threadId,input:[{type:"text",text:input}]}); }
  onEvent(listener:(event:CodexEvent)=>void):()=>void { return this.transport.subscribe(listener); }
}
