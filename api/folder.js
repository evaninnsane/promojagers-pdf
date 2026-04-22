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

  // Stap 1: GET /login → haal CSRF _token op uit HTML + initiële cookies
  const loginPage = await fetch('https://www.promojagers.be/login', {
    headers: { ...BASE_HEADERS, Accept: 'text/html' },
    redirect: 'follow',
  });
  const html = await loginPage.text();
  const cookieHeader = loginPage.headers.get('set-cookie') || '';

  // Laravel CSRF token zit als hidden input in de HTML
  const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/);
  const csrfToken  = tokenMatch ? tokenMatch[1] : '';

  // Pak XSRF-TOKEN cookie (Sanctum) en initiële session cookie
  const xsrfMatch   = cookieHeader.match(/XSRF-TOKEN=([^;]+)/);
  const xsrfToken   = xsrfMatch ? decodeURIComponent(xsrfMatch[1]) : '';
  const sessMatch   = cookieHeader.match(/promojagers_session=([^;]+)/);
  const initSession = sessMatch ? sessMatch[1] : '';

  // Stap 2: POST /login met form-encoded data (standaard Laravel web auth)
  const body = new URLSearchParams({ email, password, _token: csrfToken });

  const loginResp = await fetch('https://www.promojagers.be/login', {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      Cookie: [
        xsrfToken   ? `XSRF-TOKEN=${encodeURIComponent(xsrfToken)}` : '',
        initSession ? `promojagers_session=${initSession}` : '',
      ].filter(Boolean).join('; '),
    },
    body: body.toString(),
    redirect: 'manual', // Niet volgen — 302 redirect is het succesteken
  });

  // Laravel geeft 302 redirect terug bij succes, 200/422 bij fout
  if (loginResp.status !== 302 && loginResp.status !== 200) {
    throw new Error(`Login mislukt (HTTP ${loginResp.status}). Controleer je e-mail/wachtwoord.`);
  }

  // Na succesvolle 302: de initSession IS al geauthenticeerd.
  // Laravel werkt server-side — cookiewaarde verandert niet, alleen de server-state.
  // Gebruik nieuwe session cookie als die er is, anders initSession.
  const sessionCookieLine = setCookieArr.find(c =>
    c.includes('promojagers_session') || c.includes('laravel_session')
  );
  const newSessionMatch = sessionCookieLine?.match(/([a-z_]+session)=([^;]+)/i);

  const finalCookie = newSessionMatch
    ? `${newSessionMatch[1]}=${newSessionMatch[2]}`
    : initSession
      ? `promojagers_session=${initSession}`
      : null;

  if (!finalCookie) {
    throw new Error(`Login mislukt: geen session-cookie beschikbaar. Controleer je e-mail/wachtwoord. Cookies: ${setCookieArr.join(' | ').slice(0, 300)}`);
  }

  cachedCookie = finalCookie;
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
