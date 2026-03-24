// netlify/functions/rss.js
// Netlify 서버에서 직접 구글 뉴스 RSS 를 가져와 브라우저에 전달
// → CORS 문제 없음, 외부 프록시 불필요, 모바일에서도 빠름

exports.handler = async (event) => {
  const keyword = event.queryStringParameters?.q || '';
  if (!keyword) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'q 파라미터 필요' }),
    };
  }

  const rssUrl =
    `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const resp = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      // Node 18+ 내장 fetch 지원 (Netlify Functions 기본 런타임)
    });

    if (!resp.ok) {
      return { statusCode: resp.status, body: `RSS fetch 실패: ${resp.status}` };
    }

    const xml = await resp.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',          // CORS 허용
        'Cache-Control': 'public, max-age=300',       // 5분 캐시 → 동일 키워드 재수집 속도↑
      },
      body: xml,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
