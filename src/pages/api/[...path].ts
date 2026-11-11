import type { NextApiRequest, NextApiResponse } from 'next';
import { serveAPI } from '@/server/node-handler';

export const config = { api: { bodyParser: false, responseLimit: false, externalResolver: true } };
export default function api(request: NextApiRequest, response: NextApiResponse) {
  return serveAPI(request, response);
}
