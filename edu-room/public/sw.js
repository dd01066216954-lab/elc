// 설치(PWA)용 서비스 워커. 저장은 서버(D1)에 하므로 화면·데이터를 오래 담아 두지 않는다.
// 늘 인터넷에서 새로 받아 오고, 인터넷이 끊겼을 때만 안내 화면을 보여 준다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // /api·그림 등은 브라우저가 그대로 처리
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>4층 교육장</title><body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#1D1F23;background:#ECEEF1">' +
    '<h1 style="font-size:20px">인터넷에 연결되어 있지 않아요</h1><p>연결된 뒤 다시 열어 주세요. 모든 부서가 같은 내용을 보도록 서버에 저장해요.</p>' +
    '<button onclick="location.reload()" style="font-size:16px;padding:10px 20px">다시 열기</button></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
