export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL parameter vereist' });

  const cookie = process.env.PROMOJAGERS_COOKIE || '';
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json',
    'Accept-Language': 'nl-BE,nl;q=0.9',
    Referer: 'https://www.promojagers.be/',
  };
  if (cookie) headers['Cookie'] = `promojagers_session=${cookie}`;

  try {
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
    res.status(500).json({ error: err.message });
  }
}
