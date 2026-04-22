/**
 * Auto-login: gebruikt PROMOJAGERS_EMAIL + PROMOJAGERS_PASSWORD uit env vars.
 * Valt terug op PROMOJAGERS_COOKIE als die aanwezig is (legacy).
 */

let cachedCookie = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuten

const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'nl-BE,nl;q=0.9',
  Referer: 'https://www.promojagers.be/',
};

async function getSessionCookie() {
  if (cachedCookie && Date.now() - cacheTime < CACHE_TTL_MS) return cachedCookie;

  if (process.env.PROMOJAGERS_COOKIE) {
    return `promojagers_session=${process.env.PROMOJAGERS_COOKIE}`;
  }

  const email    = process.env.PROMOJAGERS_EMAIL;
  const password = process.env.PROMOJAGERS_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Geen inloggegevens gevonden. Stel PROMOJAGERS_EMAIL en PROMOJAGERS_PASSWORD in als Environment Variables in Vercel.'
    );
  }

  // Helper: alle Set-Cookie headers correct uitlezen
  const getCookies = (resp) =>
    resp.headers.getSetCookie?.() ||
    [resp.headers.get('set-cookie')].filter(Boolean);

  const pickCookiePair = (cookies, namePart) => {
    const line = cookies.find(c => c.toLowerCase().includes(namePart.toLowerCase() + '='));
    return line ? line.split(';')[0] : null; // "name=value"
  };

  // Stap 1: /sanctum/csrf-cookie haalt XSRF-TOKEN + session op (Sanctum SPA flow)
  const csrfResp = await fetch('https://www.promojagers.be/sanctum/csrf-cookie', {
    headers: { ...BASE_HEADERS, Accept: 'application/json' },
    redirect: 'follow',
  });
  const csrfCookies = getCookies(csrfResp);

  // Fallback: haal cookies op van de /login pagina als sanctum niets geeft
  let allInitCookies = csrfCookies;
  if (!csrfCookies.some(c => c.toLowerCase().includes('xsrf'))) {
    const lpResp = await fetch('https://www.promojagers.be/login', {
      headers: { ...BASE_HEADERS, Accept: 'text/html' },
      redirect: 'follow',
    });
    allInitCookies = getCookies(lpResp);
  }

  const xsrfPair    = pickCookiePair(allInitCookies, 'XSRF-TOKEN');
  const sessionPair = allInitCookies.map(c => c.split(';')[0])
                        .find(c => c.toLowerCase().includes('session'));

  const xsrfRaw     = xsrfPair?.split('=').slice(1).join('=') || '';
  const xsrfDecoded = decodeURIComponent(xsrfRaw);
  const cookieStr   = [xsrfPair, sessionPair].filter(Boolean).join('; ');

  // Stap 2: POST /login met JSON (Sanctum SPA)
  const loginResp = await fetch('https://www.promojagers.be/login', {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'X-XSRF-TOKEN': xsrfDecoded,
      Cookie: cookieStr,
    },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });

  if (loginResp.status === 422) {
    const body = await loginResp.json().catch(() => ({}));
    throw new Error(`Login mislukt: ${body.message || 'e-mail of wachtwoord klopt niet'}`);
  }
  if (loginResp.status >= 400) {
    throw new Error(`Login mislukt (HTTP ${loginResp.status}).`);
  }

  // Combineer cookies van init + login response; neem de meest recente session
  const loginCookies = getCookies(loginResp);
  const finalSession = [...loginCookies, ...allInitCookies]
    .map(c => c.split(';')[0])
    .find(c => c.toLowerCase().includes('session'));

  if (!finalSession) {
    const names = [...loginCookies, ...allInitCookies].map(c => c.split('=')[0]).join(', ');
    throw new Error(`Geen session-cookie gevonden. Beschikbare cookies: ${names}`);
  }

  cachedCookie = finalSession;
  cacheTime = Date.now();
  return cachedCookie;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL parameter vereist' });

  try {
    const cookie = await getSessionCookie();
    const headers = { ...BASE_HEADERS, Accept: 'application/json', Cookie: cookie };
    let folderData;
    const idMatch = url.match(/[?&]id=(\d+)/);

    if (idMatch) {
      const apiUrl = `https://www.promojagers.be/api/folders/${idMatch[1]}?include=pages`;
      const resp = await fetch(apiUrl, { headers });
      if (!resp.ok) throw new Error(`API gaf HTTP ${resp.status} terug`);
      const json = await resp.json();
      folderData = json.data;
    } else {
      // HTML fallback: extract folder ID from page source
      const htmlResp = await fetch(url, {
        headers: { ...headers, Accept: 'text/html' },
      });
      if (!htmlResp.ok) throw new Error(`Pagina gaf HTTP ${htmlResp.status} terug`);
      const html = await htmlResp.text();

      const patterns = [
        /\/api\/folders\/(\d+)\?include/,
        /"id":(\d+),"iso":"\d{4}/,
        /\/folders\/(\d+)/,
      ];
      let folderId = null;
      for (const p of patterns) {
        const m = html.match(p);
        if (m) { folderId = m[1]; break; }
      }
      if (!folderId) throw new Error('Kon geen folder-ID vinden. Voeg ?id=XXXXX toe aan de URL.');

      const apiUrl = `https://www.promojagers.be/api/folders/${folderId}?include=pages`;
      const apiResp = await fetch(apiUrl, { headers });
      if (!apiResp.ok) throw new Error(`API gaf HTTP ${apiResp.status} terug`);
      const json = await apiResp.json();
      folderData = json.data;
    }

    const store =
      folderData.store && typeof folderData.store === 'object'
        ? folderData.store.name || 'folder'
        : 'folder';

    const pages = (folderData.pages || [])
      .sort((a, b) => (a.page || 0) - (b.page || 0))
      .map(p => p.image_url.replace(/\/\d+x\d+\//, '/0x1600/'));

    res.json({
      store,
      validFrom: folderData.valid_from || '',
      pageCount: pages.length,
      pages,
    });
  } catch (err) {
    if (err.message.includes('Login') || err.message.includes('session')) cachedCookie = null;
    res.status(500).json({ error: err.message });
  }
}
