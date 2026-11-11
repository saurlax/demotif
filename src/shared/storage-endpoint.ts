/** Local development storage is confined to literal loopback hosts. */
export function isLoopbackStorage(endpoint:string){
  try{const url=new URL(endpoint);return ['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)}catch{return false}
}
