// /api/* 요청을 모두 lib/api.js 로 넘긴다 (Cloudflare Pages Functions)
import { handleApi } from '../../lib/api.js';

export const onRequest = (context) => handleApi(context.request, context.env);
