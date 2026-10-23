// Fotos de banco de imagens para os criativos da agência, pelo Pexels (fotos livres para uso comercial).
// A chave é grátis em https://www.pexels.com/api/ e vai em motor/.env: PEXELS_API_KEY=...
// Sem chave, a arte sai só no template da marca, como antes.

// busca → { id, src, alt, author, authorUrl, page, query } ou null; `skip` são os ids já usados em outras peças
export function createStock({ key, warn }) {
  let lastError = null;
  async function photo(query, { portrait = false, skip = new Set() } = {}) {
    if (!key || !query) return null;
    // sem filtro de formato: ele derruba a relevância (busca por veterinário volta só cachorro solto). O criativo
    // recorta a foto (cover), e o src.portrait do Pexels já vem recortado em pé para o vídeo
    const params = new URLSearchParams({ query, per_page: '20' });
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?${params}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(res.status === 401 ? 'chave do Pexels recusada (confira PEXELS_API_KEY)' : `o Pexels respondeu ${res.status}`);
      const { photos = [] } = await res.json();
      // o Pexels nem sempre põe a mais fiel primeiro: vence a foto cuja descrição tem mais palavras da busca
      const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const score = (x) => words.filter((w) => (x.alt || '').toLowerCase().includes(w)).length;
      const fresh = photos.filter((x) => !skip.has(x.id));
      const p = (fresh.length ? fresh : photos).reduce((best, x) => (score(x) > score(best) ? x : best), (fresh.length ? fresh : photos)[0]);
      lastError = null;
      if (!p) return null;
      return { id: p.id, src: portrait ? p.src.portrait : p.src.large, alt: p.alt || query, author: p.photographer, authorUrl: p.photographer_url, page: p.url, query };
    } catch (err) {
      // avisa uma vez por erro, não a cada peça
      if (err.message !== lastError) warn(`Banco de imagens: ${err.message}`);
      lastError = err.message;
      return null;
    }
  }
  return { enabled: !!key, photo };
}
