import cheerio from 'cheerio';

export async function webSearch(query, num = 5) {
  // Ưu tiên dùng Google Custom Search nếu có key
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) {
    const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CX}&q=${encodeURIComponent(query)}&num=${num}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.items) {
      return data.items.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet
      }));
    }
  }

  // Fallback: DuckDuckGo HTML (có thể bị chặn, dùng tạm)
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(ddgUrl);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];
  $('.result').each((i, el) => {
    if (i >= num) return false;
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const link = $(el).find('.result__url').attr('href') || '';
    results.push({ title, link, snippet });
  });
  return results;
}
