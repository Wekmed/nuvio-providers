// ============================================================
//  SezonlukDizi — Nuvio Provider
// ============================================================

var BASE_URL     = 'https://sezonlukdizi8.com';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB dizi bilgisi ─────────────────────────────────────────
function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/tv/' + tmdbId
      + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB hata: ' + r.status);
      return r.json();
    })
    .then(function(data) {
      return {
        titleTr: data.name || '',
        titleEn: data.original_name || '',
        year:    data.first_air_date ? data.first_air_date.slice(0,4) : ''
      };
    });
}

// ── Ana sayfadan session cookie al ───────────────────────────
function fetchSessionCookie() {
  return fetch(BASE_URL + '/', { headers: HEADERS })
    .then(function(r) {
      var cookies = '';
      var sc = r.headers.get('set-cookie');
      if (sc) {
        cookies = sc.split(',').map(function(c) {
          return c.trim().split(';')[0];
        }).join('; ');
      }
      console.log('[SezonlukDizi] Session cookie: ' + (cookies || '(yok)'));
      return cookies;
    })
    .catch(function() { return ''; });
}

// ── ASP endpoint numaralarını site.min.js'den çek ─────────────
function fetchAspData() {
  return fetch(BASE_URL + '/js/site.min.js', { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(js) {
      var altMatch   = js.match(/dataAlternatif(.*?)\.asp/);
      var embedMatch = js.match(/dataEmbed(.*?)\.asp/);
      var alt   = altMatch   ? altMatch[1]   : '';
      var embed = embedMatch ? embedMatch[1] : '';
      console.log('[SezonlukDizi] ASP: alternatif=' + alt + ' embed=' + embed);
      return { alternatif: alt, embed: embed };
    });
}

// ── Normalize ─────────────────────────────────────────────────
function normalizeStr(str) {
  return (str || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,'');
}

// ── Dizi arama ────────────────────────────────────────────────
function searchShow(title) {
  var url = BASE_URL + '/diziler.asp?adi=' + encodeURIComponent(title);
  return fetch(url, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      var re = /href="([^"]+)"[^>]*>\s*<[^>]+>\s*<[^>]+>\s*<[^>]+>([^<]+)/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        if (m[1].indexOf('/dizi/') !== -1 || m[1].match(/\.html/)) {
          results.push({ href: m[1], title: m[2].trim() });
        }
      }
      // Fallback: tüm /dizi/ linklerini topla
      if (results.length === 0) {
        var re2 = /href="(\/dizi\/[^"]+)"[^>]*title="([^"]+)"/g;
        while ((m = re2.exec(html)) !== null) {
          results.push({ href: m[1], title: m[2].trim() });
        }
      }
      console.log('[SezonlukDizi] Arama "' + title + '": ' + results.length + ' sonuç');
      return results;
    });
}

function findBestMatch(results, titleEn, titleTr) {
  var normEn = normalizeStr(titleEn);
  var normTr = normalizeStr(titleTr);
  for (var i = 0; i < results.length; i++) {
    var t = normalizeStr(results[i].title);
    if (t === normEn || t === normTr) return results[i].href;
  }
  for (var j = 0; j < results.length; j++) {
    var t2 = normalizeStr(results[j].title);
    if (t2.indexOf(normEn) !== -1 || t2.indexOf(normTr) !== -1) return results[j].href;
  }
  return results.length > 0 ? results[0].href : null;
}

// ── Bölüm URL oluştur ─────────────────────────────────────────
function buildEpisodeUrl(showUrl, season, episode) {
  // showUrl örn: https://sezonlukdizi8.com/paradise
  // Hedef: https://sezonlukdizi8.com/paradise/2-sezon-5-bolum.html
  var base = showUrl.replace(/\/$/, '').replace(/\.html?$/i, '');
  // Dizi slug: son path parçası
  var slug = base.split('/').pop();
  var url = BASE_URL + '/' + slug + '/' + season + '-sezon-' + episode + '-bolum.html';
  console.log('[SezonlukDizi] Bölüm URL: ' + url);
  return url;
}

// ── Bölüm sayfasından bid al ──────────────────────────────────
function fetchBid(episodeUrl, sessionCookie) {
  var hdrs = Object.assign({}, HEADERS);
  if (sessionCookie) hdrs['Cookie'] = sessionCookie;

  return fetch(episodeUrl, { headers: hdrs })
    .then(function(r) {
      // Yeni cookie gelirse birleştir
      var newCookie = sessionCookie || '';
      var sc = r.headers.get('set-cookie');
      if (sc) {
        var extra = sc.split(',').map(function(c) { return c.trim().split(';')[0]; }).join('; ');
        newCookie = newCookie ? newCookie + '; ' + extra : extra;
      }
      return r.text().then(function(html) { return { html: html, cookies: newCookie }; });
    })
    .then(function(res) {
      var html = res.html;
      var m = html.match(/data-id="([^"]+)"[^>]+id="dilsec"/);
      if (!m) m = html.match(/id="dilsec"[^>]+data-id="([^"]+)"/);
      if (!m) m = html.match(/data-id="([^"]+)"/);
      if (!m) {
        console.log('[SezonlukDizi] bid bulunamadı, HTML snippet: ' + html.slice(0,300));
        return null;
      }
      console.log('[SezonlukDizi] bid: ' + m[1]);
      return { bid: m[1], cookies: res.cookies };
    });
}

// ── Alternatif listesi ─────────────────────────────────────────
function fetchAlternatifler(bid, dil, aspData, cookies) {
  var url  = BASE_URL + '/ajax/dataAlternatif' + aspData.alternatif + '.asp';
  var body = 'bid=' + encodeURIComponent(bid) + '&dil=' + dil;
  var hdrs = Object.assign({}, HEADERS, {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type':     'application/x-www-form-urlencoded',
    'Origin':           BASE_URL
  });
  if (cookies) hdrs['Cookie'] = cookies;

  return fetch(url, { method: 'POST', headers: hdrs, body: body })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      console.log('[SezonlukDizi] Alternatif (dil=' + dil + '): ' + text.slice(0, 300));
      try {
        var json = JSON.parse(text);
        if (json.status === 'success' && Array.isArray(json.data)) return json.data;
      } catch(e) {}
      // HTML yanıt gelirse içindeki linkleri parse et
      var links = [];
      var re = /data-id="([^"]+)"[^>]*data-baslik="([^"]*)"/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        links.push({ id: m[1], baslik: m[2], kalite: '' });
      }
      return links;
    });
}

// ── Embed iframe ──────────────────────────────────────────────
function fetchEmbedIframe(embedId, aspData) {
  var url  = BASE_URL + '/ajax/dataEmbed' + aspData.embed + '.asp';
  var body = 'id=' + encodeURIComponent(embedId);
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type':     'application/x-www-form-urlencoded'
    }),
    body: body
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/<iframe[^>]+src="([^"]+)"/i);
      return m ? m[1] : null;
    });
}

// ── iframe'den video URL ───────────────────────────────────────
function fetchStreamFromIframe(src) {
  return fetch(src, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/["'](https?:[^"']+\.mp4[^"']*)['"]/i);
      if (m) return { url: m[1], type: 'mp4' };
      m = html.match(/["'](https?:[^"']+\.mkv[^"']*)['"]/i);
      if (m) return { url: m[1], type: 'mkv' };
      m = html.match(/["'](https?:[^"']+\.(avi|webm)[^"']*)['"]/i);
      if (m) return { url: m[1], type: m[2] };
      console.log('[SezonlukDizi] Desteklenen format yok (muhtemelen m3u8)');
      return null;
    })
    .catch(function() { return null; });
}

// ── Bir alternatifi işle ──────────────────────────────────────
function processVeri(veri, dilAd, aspData) {
  return fetchEmbedIframe(veri.id, aspData)
    .then(function(src) {
      if (!src) return null;
      console.log('[SezonlukDizi] iframe: ' + src);
      return fetchStreamFromIframe(src);
    })
    .then(function(stream) {
      if (!stream) return null;
      return {
        url:     stream.url,
        quality: veri.kalite ? veri.kalite + 'p' : 'Auto',
        label:   'SezonlukDizi — ' + dilAd + ' ' + (veri.baslik || ''),
        headers: { 'Referer': BASE_URL + '/' }
      };
    })
    .catch(function() { return null; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== 'tv') return Promise.resolve([]);
  console.log('[SezonlukDizi] getStreams → tmdbId=' + tmdbId + ' S' + season + 'E' + episode);

  return Promise.all([fetchTmdbInfo(tmdbId), fetchSessionCookie(), fetchAspData()])
    .then(function(init) {
      var info      = init[0];
      var cookie    = init[1];
      var aspData   = init[2];
      console.log('[SezonlukDizi] TMDB: "' + info.titleEn + '" / "' + info.titleTr + '"');

      return searchShow(info.titleEn)
        .then(function(r1) {
          var url = findBestMatch(r1, info.titleEn, info.titleTr);
          if (url) return url;
          return searchShow(info.titleTr).then(function(r2) {
            return findBestMatch(r2, info.titleEn, info.titleTr);
          });
        })
        .then(function(showUrl) {
          if (!showUrl) throw new Error('Dizi bulunamadı');
          if (showUrl.indexOf('http') !== 0) showUrl = BASE_URL + showUrl;
          console.log('[SezonlukDizi] Dizi URL: ' + showUrl);
          var epUrl = buildEpisodeUrl(showUrl, season, episode);
          return fetchBid(epUrl, cookie).then(function(bidData) {
            return { bidData: bidData, aspData: aspData };
          });
        });
    })
    .then(function(ctx) {
      if (!ctx.bidData || !ctx.bidData.bid) throw new Error('bid alınamadı');
      var bid     = ctx.bidData.bid;
      var cookies = ctx.bidData.cookies;
      var aspData = ctx.aspData;

      return Promise.all([
        fetchAlternatifler(bid, '0', aspData, cookies).then(function(list) {
          return Promise.all(list.map(function(v) { return processVeri(v, 'TR Dublaj', aspData); }));
        }),
        fetchAlternatifler(bid, '1', aspData, cookies).then(function(list) {
          return Promise.all(list.map(function(v) { return processVeri(v, 'TR Altyazı', aspData); }));
        })
      ]);
    })
    .then(function(all) {
      var streams = all[0].concat(all[1]).filter(function(s) { return s !== null; });
      console.log('[SezonlukDizi] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.log('[SezonlukDizi] Hata: ' + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
