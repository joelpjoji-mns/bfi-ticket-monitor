const fetch = require('node-fetch');
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};
const articleId = 'A0A2A7B6-689F-40DA-A1E4-22F7A5B3E99A';
const url = 'https://whatson.bfi.org.uk/imax/Online/default.asp?doWork::WScontent::loadArticle=Load&BOparam::WScontent::loadArticle::article_id=' + articleId;

fetch(url, { headers }).then(async function(r) {
  console.log('HTTP Status:', r.status);
  const html = await r.text();
  console.log('Page length:', html.length, 'bytes');
  
  const hasSearchResults = html.indexOf('searchResults') !== -1;
  const hasArticleContext = html.indexOf('articleContext') !== -1;
  const sTokenIdx = html.indexOf('sToken');
  const totalPagesIdx = html.indexOf('total_pages');
  
  console.log('Has searchResults:', hasSearchResults);
  console.log('Has articleContext:', hasArticleContext);
  console.log('sToken at index:', sTokenIdx);
  console.log('total_pages at index:', totalPagesIdx);
  
  if (sTokenIdx !== -1) {
    console.log('sToken snippet:', html.substring(sTokenIdx, sTokenIdx + 60));
  }
  if (totalPagesIdx !== -1) {
    console.log('total_pages snippet:', html.substring(totalPagesIdx, totalPagesIdx + 40));
  }
  
  const hasOdyssey = html.toLowerCase().indexOf('odyssey') !== -1;
  console.log('Contains Odyssey:', hasOdyssey);
  
  if (hasSearchResults) {
    const srIdx = html.indexOf('searchResults');
    console.log('searchResults snippet:', html.substring(srIdx, srIdx + 300));
  }
  
}).catch(function(e) { console.error('Error:', e.message); });
