export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/rss?q=키워드 경로 처리
    if (url.pathname === '/api/rss') {
      const keyword = url.searchParams.get('q') || '';
      if (!keyword) {
        return new Response(JSON.stringify({ error: 'q 파라미터 필요' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rssUrl =
        `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;

      try {
        const resp = await fetch(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml',
          },
        });

        if (!resp.ok) {
          return new Response(`RSS fetch 실패: ${resp.status}`, { status: resp.status });
        }

        const xml = await resp.text();
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 나머지는 정적 파일 서빙 (Cloudflare Pages)
    return env.ASSETS.fetch(request);
  },
};
