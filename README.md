# Promojagers PDF — Vercel deployment

Download elke folder van promojagers.be als PDF, gehost op Vercel.

## Structuur

```
promojagers-pdf/
├── public/
│   └── index.html      ← frontend (jsPDF in browser)
├── api/
│   ├── folder.js       ← haalt folder-metadata op via promojagers.be API
│   └── image.js        ← proxy voor CDN-afbeeldingen (omzeilt CORS)
├── package.json
└── .env.example
```

## Deployen op Vercel

### 1. GitHub repo aanmaken

```bash
cd promojagers-pdf
git init
git add .
git commit -m "init"
# Maak een repo aan op github.com en push
git remote add origin https://github.com/JOUW_NAAM/promojagers-pdf.git
git push -u origin main
```

### 2. Vercel koppelen

1. Ga naar [vercel.com](https://vercel.com) → **New Project**
2. Importeer je GitHub-repo
3. Klik **Deploy** (geen buildstep nodig)

### 3. Cookie instellen als Environment Variable

1. Vercel dashboard → jouw project → **Settings → Environment Variables**
2. Voeg toe:
   - **Name:** `PROMOJAGERS_COOKIE`
   - **Value:** jouw session cookie (zie hieronder hoe je die vindt)
   - **Environment:** Production (en Preview als je wilt)
3. **Redeploy** het project (Deployments → ⋯ → Redeploy)

### Cookie ophalen (eenmalig, duurt ~1 minuut)

1. Log in op [promojagers.be](https://www.promojagers.be) in Chrome
2. Druk **F12** → tabblad **Application**
3. Links: **Cookies → https://www.promojagers.be**
4. Zoek het cookie `promojagers_session`
5. Kopieer de **Value**

> ⚠️ Session cookies verlopen. Als de app opeens 0 pagina's geeft voor beveiligde folders, herhaal bovenstaande stap en update de env var in Vercel.

## Lokaal testen

```bash
npm install -g vercel
vercel dev
# → http://localhost:3000
```

Maak een `.env.local` aan:
```
PROMOJAGERS_COOKIE=jouw_cookie_hier
```

## Hoe het werkt

1. **Browser** stuurt de folder-URL naar `/api/folder`
2. **`/api/folder`** haalt de folder-metadata op bij promojagers.be (met jouw cookie) en geeft de CDN-URLs van alle pagina's terug
3. **Browser** downloadt elke pagina via `/api/image` (proxy om CORS te omzeilen)
4. **jsPDF** combineert alles in de browser tot één PDF
5. Klik **PDF opslaan** → bestand wordt direct gedownload

Geen externe opslag nodig — alles verloopt in memory.
