import {randomUUID} from '@/shared/id';
// A fresh page instance owns its live controls. Reloading cannot replay old requests.
let client:string|undefined;
export function studioClientId(){return client??=randomUUID()}
