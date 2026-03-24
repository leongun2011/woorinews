'use strict';

// ══════════════════════════════════════════════════════════
//  설정 (bank_news_scraper.py 동일)
// ══════════════════════════════════════════════════════════
const DEFAULT_KEYWORDS   = ["금융","은행","핀테크","디지털금융","글로벌금융","연준","국제금융"];
const MAX_RSS            = 300;
const SIMILARITY_THRESH  = 0.6;
const RECENT_COMPARE     = 30;
const MAX_WORKERS        = 5;
const PAGE_SIZE          = 20;

// ★ Netlify Functions 자체 프록시 (외부 프록시 불필요 → 빠르고 안정적)
const RSS_ENDPOINT = '/api/rss?q=';

// iOS 15 이하 AbortSignal.timeout 폴리필
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

// ══════════════════════════════════════════════════════════
//  키워드 중요도 (bank_news_scraper.py 동일)
// ══════════════════════════════════════════════════════════
const SCORE_KEYWORDS = {
  5: ["파산","부도","파탄","뱅크런","금융위기","영업정지","영업취소",
      "기준금리","금리인상","금리인하","긴급조치","긴급",
      "제재","제재금","과징금","검찰","수사","구속","기소",
      "횡령","사기","불법","위반","리콜","해킹","정보유출","개인정보 유출"],
  4: ["인수합병","M&A","상장","IPO","유상증자","무상증자",
      "실적","영업이익","순이익","적자","흑자","손실",
      "배당","금리","환율","주가","코스피","코스닥","나스닥",
      "규제","법안","정책","개정","도입","시행","폐지",
      "인플레이션","경기침체","디폴트","구조조정","감원","희망퇴직"],
  3: ["협약","업무협약","MOU","투자","펀드","대출","금융",
      "은행","핀테크","디지털","블록체인","AI","인공지능",
      "혁신","성장","확대","강화","출시","개시","론칭",
      "파트너십","제휴","협력"],
  2: ["채용","인사","승진","임명","선임","취임","퇴임",
      "수상","표창","인증","행사","세미나","포럼","컨퍼런스",
      "캠페인","이벤트","봉사","기부","후원"],
};

function keywordScore(title) {
  for (const score of [5,4,3,2]) {
    for (const kw of SCORE_KEYWORDS[score]) {
      if (title.includes(kw)) return score;
    }
  }
  return 1;
}

// ══════════════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════════════
function cleanText(t) {
  return t.replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#[0-9]+;/g,' ')
    .replace(/\s{2,}/g,' ').trim();
}

function parseDate(str) {
  if (!str) return new Date();
  const d = new Date(str);
  return isNaN(d) ? new Date() : d;
}

function formatDate(d) {
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 유사도 (SequenceMatcher 근사)
function isSimilar(t1, t2) {
  const a = t1.replace(/\s/g,'').toLowerCase();
  const b = t2.replace(/\s/g,'').toLowerCase();
  const longer  = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) return true;
  let matches = 0;
  const used  = new Array(longer.length).fill(false);
  for (let i = 0; i < shorter.length; i++) {
    const idx = longer.indexOf(shorter[i]);
    if (idx !== -1 && !used[idx]) { matches++; used[idx] = true; }
  }
  return (matches / longer.length) > SIMILARITY_THRESH;
}

function deduplicate(list) {
  const unique = [], seen = [];
  for (const n of list) {
    if (seen.includes(n.title)) continue;
    if (seen.slice(-RECENT_COMPARE).some(t => isSimilar(n.title, t))) continue;
    unique.push(n);
    seen.push(n.title);
  }
  return unique;
}

// ══════════════════════════════════════════════════════════
//  RSS 수집
// ══════════════════════════════════════════════════════════
async function fetchRSS(keyword) {
  try {
    const url  = RSS_ENDPOINT + encodeURIComponent(keyword);
    const resp = await fetch(url, { signal: timeoutSignal(15000) });
    if (!resp.ok) return [];
    const text = await resp.text();
    const xml  = new DOMParser().parseFromString(text, 'text/xml');
    const items = Array.from(xml.querySelectorAll('item')).slice(0, MAX_RSS);
    return items.map(item => {
      const title = cleanText(item.querySelector('title')?.textContent || '');
      return {
        title,
        link:  item.querySelector('link')?.textContent?.trim() || '#',
        date:  parseDate(item.querySelector('pubDate')?.textContent),
        score: keywordScore(title),
      };
    }).filter(n => n.title);
  } catch {
    return [];
  }
}

async function collectNews(searchTerm, onProgress) {
  const keywords = searchTerm ? [searchTerm] : DEFAULT_KEYWORDS;
  const results  = [];
  let   done     = 0;

  // ★ 전체 동시 병렬 수집 (allSettled → 일부 실패해도 나머지 결과 사용)
  await Promise.allSettled(keywords.map(async kw => {
    const items = await fetchRSS(kw);
    results.push(...items);
    done++;
    onProgress(done / keywords.length);
  }));

  let all = results;
  if (searchTerm) {
    const norm = searchTerm.replace(/\s/g,'').toLowerCase();
    all = all.filter(n => n.title.replace(/\s/g,'').toLowerCase().includes(norm));
  }
  all.sort((a,b) => b.date - a.date);
  return deduplicate(all);
}

// ══════════════════════════════════════════════════════════
//  UI 상태
// ══════════════════════════════════════════════════════════
let allNews      = [];
let activeFilter = new Set();
let currentPage  = 1;
let isLoading    = false;
let pollFailCount= 0;

const $searchInput  = document.getElementById('search_term');
const $searchBtn    = document.getElementById('search-btn');
const $progressWrap = document.getElementById('progress-wrap');
const $progressBar  = document.getElementById('progress-bar');
const $progressPct  = document.getElementById('progress-pct');
const $filterBar    = document.getElementById('filter-bar');
const $filterCount  = document.getElementById('filter-count');
const $newsList     = document.getElementById('news-list');
const $pagination   = document.getElementById('pagination');
const $emptyState   = document.getElementById('empty-state');
const $toast        = document.getElementById('toast');

// 검색 이벤트
$searchBtn.addEventListener('click', startSearch);
$searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') startSearch(); });

// 필터 이벤트
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const score = parseInt(btn.dataset.score);
    if (score === 0) {
      activeFilter = new Set();
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    } else {
      document.querySelector('.filter-btn[data-score="0"]').classList.remove('active');
      if (activeFilter.has(score)) {
        activeFilter.delete(score);
        btn.classList.remove('active');
      } else {
        activeFilter.add(score);
        btn.classList.add('active');
      }
      if (activeFilter.size === 0) {
        document.querySelector('.filter-btn[data-score="0"]').classList.add('active');
      }
    }
    currentPage = 1;
    applyFilter();
  });
});

function showToast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  setTimeout(() => $toast.classList.remove('show'), 2800);
}

function setProgress(pct, label) {
  const p = Math.min(100, Math.round(pct * 100));
  $progressBar.style.width = p + '%';
  $progressPct.textContent = p + '%';
}

// ── 뉴스 수집 시작 ────────────────────────────────────────
async function startSearch() {
  if (isLoading) return;
  isLoading    = true;
  allNews      = [];
  activeFilter = new Set();
  currentPage  = 1;

  $searchBtn.disabled    = true;
  $searchBtn.textContent = '수집 중...';
  $emptyState.style.display  = 'none';
  $filterBar.style.display   = 'none';
  $newsList.innerHTML        = '';
  $pagination.innerHTML      = '';
  $filterCount.textContent   = '';
  $progressWrap.style.display = 'block';
  $progressPct.style.display  = 'inline';
  setProgress(0.03);

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.filter-btn[data-score="0"]').classList.add('active');

  const term = $searchInput.value.trim();

  try {
    const results = await collectNews(term, pct => {
      setProgress(0.05 + pct * 0.9);
    });

    setProgress(1);
    await new Promise(r => setTimeout(r, 400));
    $progressWrap.style.display = 'none';
    $progressPct.style.display  = 'none';

    allNews = results;

    if (!allNews.length) {
      showToast('검색 결과가 없습니다');
      $emptyState.style.display = 'block';
    } else {
      $filterBar.style.display = 'block';
      applyFilter();
    }
  } catch {
    $progressWrap.style.display = 'none';
    showToast('수집 중 오류가 발생했습니다');
    $emptyState.style.display = 'block';
  }

  isLoading = false;
  $searchBtn.disabled    = false;
  $searchBtn.textContent = '뉴스 수집 시작';
}

// ── 필터 적용 ─────────────────────────────────────────────
function setFilter(score) {
  activeFilter = new Set();
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.filter-btn[data-score="0"]').classList.add('active');
  applyFilter();
}

function toggleFilter(score) {
  document.querySelector('.filter-btn[data-score="0"]').classList.remove('active');
  if (activeFilter.has(score)) {
    activeFilter.delete(score);
    document.querySelector(`.filter-btn[data-score="${score}"]`).classList.remove('active');
  } else {
    activeFilter.add(score);
    document.querySelector(`.filter-btn[data-score="${score}"]`).classList.add('active');
  }
  if (activeFilter.size === 0) {
    document.querySelector('.filter-btn[data-score="0"]').classList.add('active');
  }
  currentPage = 1;
  applyFilter();
}

function applyFilter() {
  const filtered = activeFilter.size === 0
    ? allNews
    : allNews.filter(n => activeFilter.has(n.score));
  $filterCount.textContent = `${filtered.length}건`;
  renderNews(filtered, currentPage);
}

// ── 뉴스 렌더링 ──────────────────────────────────────────
function renderNews(list, page) {
  const total      = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p          = Math.min(page, totalPages);
  const start      = (p - 1) * PAGE_SIZE;
  const slice      = list.slice(start, start + PAGE_SIZE);

  $newsList.innerHTML = '';

  if (!slice.length) {
    $newsList.innerHTML = "<p class='no-result'>해당 조건의 뉴스가 없습니다.</p>";
    $pagination.innerHTML = '';
    return;
  }

  slice.forEach((item, i) => {
    const div   = document.createElement('div');
    div.className = 'news-item';
    const stars = renderStars(item.score);
    div.innerHTML = `
      <a href="${encodeURI(item.link||'#')}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>
      ${stars ? `<div class="news-score" title="중요도 ${item.score}/5">${stars}</div>` : ''}
      <div class="news-meta">${escapeHTML(typeof item.date === 'string' ? item.date : formatDate(item.date))}</div>
    `;
    $newsList.appendChild(div);
    setTimeout(() => div.classList.add('show'), 70 * i);
  });

  displayPagination(p, totalPages, list);
  if (page > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goPage(page) {
  currentPage = page;
  const filtered = activeFilter.size === 0
    ? allNews
    : allNews.filter(n => activeFilter.has(n.score));
  renderNews(filtered, page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function displayPagination(page, totalPages, list) {
  $pagination.innerHTML = '';
  if (totalPages <= 1) return;

  const mk = (label, disabled, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled    = disabled;
    btn.onclick     = onClick;
    $pagination.appendChild(btn);
  };

  mk('◀◀ 맨앞', page <= 1,          () => goPage(1));
  mk('◀ 이전',  page <= 1,          () => goPage(page - 1));

  const info = document.createElement('span');
  info.textContent = ` ${page} / ${totalPages} `;
  $pagination.appendChild(info);

  mk('다음 ▶',  page >= totalPages, () => goPage(page + 1));
  mk('맨뒤 ▶▶', page >= totalPages, () => goPage(totalPages));
}

function escapeHTML(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function renderStars(score) {
  if (!score || score < 1) return '';
  const s = Math.min(5, Math.max(1, parseInt(score)));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}

// ── PWA 설치 배너 ─────────────────────────────────────────
(function () {
  const ua           = navigator.userAgent || '';
  const isIOS        = /iphone|ipad|ipod/i.test(ua);
  const isSafari     = /safari/i.test(ua) && !/crios|fxios|chrome/i.test(ua);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
  // 카카오 인앱브라우저 감지 (다양한 UA 패턴 대응)
  const isKakao      = /kakaotalk|kakaobrowser/i.test(ua)
                    || ua.toLowerCase().includes('kakao');

  // 이미 설치된 앱 모드면 표시 안 함
  if (isStandalone) return;

  // ── 카카오 인앱브라우저 감지 ─────────────────────────────
  if (isKakao) {
    const currentUrl = location.href;
    const banner = document.createElement('div');
    banner.id = 'kakao-banner';
    banner.style.cssText = `
      position:fixed; bottom:0; left:0; right:0; z-index:99999;
      background:linear-gradient(135deg,#1a3a5c,#1e4a78);
      color:#fff; padding:16px;
      box-shadow:0 -4px 20px rgba(0,0,0,0.3);
      font-family:'Noto Sans KR',sans-serif;
    `;

    if (isIOS) {
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="icon-192.png" style="width:44px;height:44px;border-radius:10px;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.92em;margin-bottom:4px;">Safari에서 열어주세요</div>
            <div style="font-size:0.76em;color:rgba(255,255,255,0.8);line-height:1.6;">
              앱 설치는 Safari에서만 가능해요.<br>
              우측 하단 <b style="color:#f39c12;">⋯ → Safari로 열기</b> 후<br>
              하단 <b style="color:#f39c12;">공유 □↑ → 홈 화면에 추가</b>를 눌러주세요.
            </div>
          </div>
          <button id="kakao-x" style="flex-shrink:0;background:rgba(255,255,255,0.15);color:#fff;
            border:none;border-radius:50%;width:30px;height:30px;font-size:0.82em;
            cursor:pointer;align-self:flex-start;">✕</button>
        </div>
      `;
      document.body.appendChild(banner);
      document.getElementById('kakao-x').addEventListener('click', () => banner.remove());
    } else {
      const braveIntent  = 'intent://' + currentUrl.replace(/https?:\/\//, '') + '#Intent;scheme=https;package=com.brave.browser;end';
      const chromeIntent = 'intent://' + currentUrl.replace(/https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';

      function openBrave() {
        location.href = braveIntent;
        setTimeout(() => { location.href = chromeIntent; }, 1500);
      }

      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="icon-192.png" style="width:44px;height:44px;border-radius:10px;flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.92em;margin-bottom:4px;">브라우저에서 열기</div>
            <div style="font-size:0.76em;color:rgba(255,255,255,0.8);line-height:1.5;">앱 설치는 Chrome / Brave에서 가능해요.</div>
          </div>
          <button id="kakao-x" style="flex-shrink:0;background:rgba(255,255,255,0.15);color:#fff;
            border:none;border-radius:50%;width:30px;height:30px;font-size:0.82em;
            cursor:pointer;align-self:flex-start;">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="open-brave" style="flex:1;height:40px;background:#fb542b;color:#fff;
            border:none;border-radius:8px;font-weight:700;font-size:0.84em;font-family:inherit;cursor:pointer;">
            🦁 Brave로 열기
          </button>
          <button id="open-chrome" style="flex:1;height:40px;background:#4285f4;color:#fff;
            border:none;border-radius:8px;font-weight:700;font-size:0.84em;font-family:inherit;cursor:pointer;">
            Chrome으로 열기
          </button>
        </div>
      `;
      document.body.appendChild(banner);
      document.getElementById('kakao-x').addEventListener('click', () => banner.remove());
      document.getElementById('open-brave').addEventListener('click', openBrave);
      document.getElementById('open-chrome').addEventListener('click', () => { location.href = chromeIntent; });
    }
    return;
  }

  let deferredPrompt = null;

  function buildBanner(type) {
    const old = document.getElementById('pwa-banner');
    if (old) old.remove();

    const b = document.createElement('div');
    b.id = 'pwa-banner';

    if (type === 'android') {
      b.innerHTML = `
        <div class="pwa-inner">
          <img src="icon-192.png" class="pwa-icon" alt="">
          <div class="pwa-text">
            <strong>앱으로 설치하기</strong>
            <span>홈 화면에 추가하면 앱처럼 빠르게 실행돼요</span>
          </div>
          <button class="pwa-ok" id="pwa-ok">설치</button>
          <button class="pwa-x" id="pwa-x">✕</button>
        </div>`;
    } else {
      // iOS (Safari & Chrome 모두)
      b.innerHTML = `
        <div class="pwa-inner">
          <img src="icon-192.png" class="pwa-icon" alt="">
          <div class="pwa-text">
            <strong>홈 화면에 추가하기</strong>
            <span>${isSafari
              ? '하단 <b>공유 □↑</b> 버튼 → <b>홈 화면에 추가</b>'
              : '브라우저 메뉴 → <b>홈 화면에 추가</b>'
            }</span>
          </div>
          <button class="pwa-x" id="pwa-x">✕</button>
        </div>
        ${isSafari ? '<div class="pwa-arrow">▼</div>' : ''}`;
    }

    document.body.appendChild(b);
    // 두 프레임 뒤에 show → CSS 트랜지션 확실히 발동
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('show')));

    document.getElementById('pwa-x').addEventListener('click', () => {
      b.classList.remove('show');
      setTimeout(() => b.remove(), 400);
    });

    const okBtn = document.getElementById('pwa-ok');
    if (okBtn) {
      okBtn.addEventListener('click', () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
          b.classList.remove('show');
          setTimeout(() => b.remove(), 400);
          deferredPrompt = null;
        });
      });
    }
  }

  // Android/Chrome → beforeinstallprompt 대기
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    buildBanner('android');
  });

  // iOS → 무조건 표시 (beforeinstallprompt 없음)
  if (isIOS) {
    setTimeout(() => buildBanner('ios'), 800);
  }

  // 헤더 설치 버튼
  const $btn = document.getElementById('install-btn');
  if ($btn) {
    $btn.style.display = 'block';
    $btn.addEventListener('click', () => {
      if (deferredPrompt) deferredPrompt.prompt();
      else buildBanner(isIOS ? 'ios' : 'android');
    });
  }
})();

// ── 서비스 워커 등록 ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
