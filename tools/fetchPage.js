import * as cheerio from 'cheerio';

export async function fetchPageText(url) {
  const res = await fetch(url, { timeout: 8000 });
  const html = await res.text();
  const $ = cheerio.load(html);
  // Lấy text từ body, bỏ script, style
  $('script, style, nav, footer, header').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000);
  return { text };
}
