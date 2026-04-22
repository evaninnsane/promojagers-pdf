const ALLOWED_HOSTS = [
  'promojagers.be',
  'imgix.net',
  'imgproxy',
  'cloudfront.net',
  'cdn.',
];

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL vereist');

  const allowed = ALLOWED_HOSTS.some(h => url.includes(h));
  if (!allowed) return res.status(403).send('Domein niet toegestaan');

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.promojagers.be/',
      },
    });

    if (!resp.ok) return res.status(resp.status).send(`Upstream HTTP ${resp.status}`);

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = await resp.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
}
