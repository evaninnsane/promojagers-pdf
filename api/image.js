const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '169.254', '10.', '192.168.', '172.'];

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL vereist');

  // Blokkeer interne/lokale adressen; sta alle externe HTTPS toe
  const isBlocked = !url.startsWith('https://') ||
    BLOCKED_HOSTS.some(h => url.includes(h));
  if (isBlocked) return res.status(403).send('URL niet toegestaan');

  try {
    const cookie = process.env.PROMOJAGERS_COOKIE
      ? `promojagers_session=${process.env.PROMOJAGERS_COOKIE}`
      : '';

    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.promojagers.be/',
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    if (!resp.ok) return res.status(resp.status).send(`Upstream HTTP ${resp.status} voor: ${url}`);

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = await resp.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
}

