// ============================================================
//  JetFilmizle — Nuvio Provider
//  CloudStream (Kotlin) → Nuvio (JavaScript) port
//  Kaynak: JetFilmizle.kt by @keyiflerolsun / @KekikAkademi
//  Sadece Film (movie) destekler
// ============================================================

var BASE_URL     = 'https://jetfilmizle.net';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB'den film bilgisi çek ─────────────────────────────────
function fetchTmdbInfo(tmdbId) {
  var url = 'https://api.themoviedb.org/3/movie/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR';

  return fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB hata: ' + r.status);
      return r.json();
    })
    .then(function(data) {
      return {
        titleTr: data.title || '',
        titleEn: data.original_title || '',
        year:    (data.release_date || '').slice(0, 4)
      };
    });
}

// ── Normalize ────────────────────────────────────────────────
function normalizeStr(str) {
  return (str || '')
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

// ── Arama: POST /filmara.php ──────────────────────────────────
function searchJet(query) {
  return fetch(BASE_URL + '/filmara.php', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: 's=' + encodeURIComponent(query)
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // article.movie → h2/h3/... a href
      var results = [];
      var re = /<article[^>]+class="[^"]*movie[^"]*"[\s\S]*?<a\s+href="([^"]+)"[^>]*>[\s\S]*?<(?:h2|h3|h4|h5|h6)[^>]*>\s*<a[^>]*>([^<]+)</g;
      var m;
      while ((m = re.exec(html)) !== null) {
        results.push({
          href:  m[1],
          title: m[2].replace(/ izle$/i, '').trim()
        });
      }
      // Alternatif parse - önce tüm article.movie bloklarını bul
      if (results.length === 0) {
        var articleRe = /<article[^>]*class="[^"]*movie[^"]*"([\s\S]*?)<\/article>/g;
        while ((m = articleRe.exec(html)) !== null) {
          var block = m[1];
          var hrefM  = block.match(/href="([^"]+)"/);
          var titleM = block.match(/<(?:h2|h3|h4|h5|h6)[^>]*>[^<]*<a[^>]*>([^<]+)<\/a>/);
          if (hrefM && titleM) {
            results.push({
              href:  hrefM[1],
              title: titleM[1].replace(/ izle$/i, '').trim()
            });
          }
        }
      }
      return results;
    });
}

// ── En iyi eşleşmeyi bul ─────────────────────────────────────
function findBestMatch(results, titleEn, titleTr, year) {
  var normEn = normalizeStr(titleEn);
  var normTr = normalizeStr(titleTr);

  // 1. Tam başlık + yıl URL'de
  if (year) {
    for (var i = 0; i < results.length; i++) {
      var normHref = normalizeStr(results[i].href);
      var normTitle = normalizeStr(results[i].title);
      if ((normTitle === normEn || normTitle === normTr) && results[i].href.indexOf(year) !== -1) {
        return results[i].href;
      }
    }
  }

  // 2. Tam başlık eşleşmesi
  for (var j = 0; j < results.length; j++) {
    var t = normalizeStr(results[j].title);
    if (t === normEn || t === normTr) return results[j].href;
  }

  // 3. Başlık içeriyor
  for (var k = 0; k < results.length; k++) {
    var t2 = normalizeStr(results[k].title);
    if (t2.indexOf(normEn) !== -1 || normEn.indexOf(t2) !== -1) return results[k].href;
  }

  if (results.length > 0) return results[0].href;
  return null;
}

// ── Film sayfasından iframe ve pixeldrain linklerini al ───────
function fetchFilmLinks(filmUrl) {
  return fetch(filmUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var links = [];

      // Pixeldrain download linkleri — direkt mp4
      var dlRe = /class="[^"]*download-btn[^"]*"[^>]*href="([^"]+)"/g;
      var m;
      while ((m = dlRe.exec(html)) !== null) {
        var href = m[1];
        if (href.indexOf('pixeldrain.com') !== -1) {
          links.push({ type: 'pixeldrain', url: href });
          console.log('[JetFilmizle] Pixeldrain: ' + href);
        }
      }

      // Ana iframe (data-litespeed-src veya src)
      var iframeM = html.match(/div#movie[\s\S]{0,500}?<iframe[^>]+(?:data-litespeed-src|src)="([^"]+)"/i);
      if (!iframeM) iframeM = html.match(/<div[^>]+id="movie"[\s\S]{0,500}?<iframe[^>]+(?:data-litespeed-src|src)="([^"]+)"/i);
      if (iframeM) {
        links.push({ type: 'iframe', url: iframeM[1] });
        console.log('[JetFilmizle] iframe: ' + iframeM[1]);
      }

      return links;
    });
}

// ── Pixeldrain linkini direkt stream'e çevir ──────────────────
// pixeldrain.com/u/XXXX → pixeldrain.com/api/file/XXXX?download
function pixeldrainToStream(pdUrl) {
  var fileId = pdUrl.split('/').pop().split('?')[0];
  var directUrl = 'https://pixeldrain.com/api/file/' + fileId + '?download';
  return {
    url:     directUrl,
    quality: 'Auto',
    label:   'JetFilmizle — Pixeldrain',
    headers: { 'Referer': 'https://pixeldrain.com/' }
  };
}

// ── iframe'den stream çek (d2rs / jetv / diğer) ───────────────
function fetchIframeStream(iframeUrl) {
  return fetch(iframeUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // jetv.xyz: "sources": [{file:'...', type:'...', label:'...'}]
      var sourcesM = html.match(/"sources"\s*:\s*\[([\s\S]*?)\]/);
      if (sourcesM) {
        var fileM  = sourcesM[1].match(/file['":\s]+['"]([^'"]+)['"]/);
        var labelM = sourcesM[1].match(/label['":\s]+['"]([^'"]+)['"]/);
        if (fileM) {
          var url = fileM[1];
          var isM3u8 = url.indexOf('.m3u8') !== -1;
          if (isM3u8) {
            console.log('[JetFilmizle] m3u8 atlanıyor: ' + url.slice(0, 80));
            return null;
          }
          return {
            url:     url,
            quality: labelM ? labelM[1] : 'Auto',
            label:   'JetFilmizle — Jetv'
          };
        }
      }

      // d2rs: içinde başka iframe var
      var innerM = html.match(/<iframe[^>]+src="([^"]+)"/i);
      if (innerM) {
        return fetchIframeStream(innerM[1]);
      }

      // Direkt mp4
      var mp4M = html.match(/["'](https?:[^"']+\.mp4[^"']{0,50})["']/i);
      if (mp4M) {
        return {
          url:     mp4M[1],
          quality: 'Auto',
          label:   'JetFilmizle — Direct'
        };
      }

      console.log('[JetFilmizle] iframe stream bulunamadı');
      return null;
    })
    .catch(function(e) {
      console.log('[JetFilmizle] iframe hata: ' + e.message);
      return null;
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== 'movie') return Promise.resolve([]);

  console.log('[JetFilmizle] getStreams → tmdbId=' + tmdbId);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      console.log('[JetFilmizle] TMDB: "' + info.titleEn + '" / "' + info.titleTr + '" (' + info.year + ')');

      return searchJet(info.titleEn)
        .then(function(results) {
          console.log('[JetFilmizle] Arama sonucu (' + info.titleEn + '): ' + results.length);
          var url = findBestMatch(results, info.titleEn, info.titleTr, info.year);
          if (url) return url;

          return searchJet(info.titleTr).then(function(r2) {
            console.log('[JetFilmizle] Arama sonucu (' + info.titleTr + '): ' + r2.length);
            return findBestMatch(r2, info.titleEn, info.titleTr, info.year);
          });
        });
    })
    .then(function(filmUrl) {
      if (!filmUrl) throw new Error('Film bulunamadı');
      if (filmUrl.indexOf('http') !== 0) filmUrl = BASE_URL + filmUrl;
      console.log('[JetFilmizle] Film URL: ' + filmUrl);
      return fetchFilmLinks(filmUrl);
    })
    .then(function(links) {
      console.log('[JetFilmizle] Bulunan link sayısı: ' + links.length);

      var streams = [];
      var promises = [];

      links.forEach(function(link) {
        if (link.type === 'pixeldrain') {
          streams.push(pixeldrainToStream(link.url));
        } else if (link.type === 'iframe') {
          promises.push(
            fetchIframeStream(link.url).then(function(s) {
              if (s) streams.push(s);
            })
          );
        }
      });

      return Promise.all(promises).then(function() { return streams; });
    })
    .then(function(streams) {
      console.log('[JetFilmizle] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.log('[JetFilmizle] Hata: ' + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
