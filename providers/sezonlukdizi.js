// ============================================================
//  SezonlukDizi — Nuvio Provider
//  CloudStream (Kotlin) → Nuvio (JavaScript) port
//  Kaynak: SezonlukDizi.kt by @keyiflerolsun / @KekikAkademi
//  Sadece Dizi (tv) destekler
// ============================================================

var BASE_URL    = 'https://sezonlukdizi8.com';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB'den dizi bilgisi çek ────────────────────────────────
function fetchTmdbInfo(tmdbId) {
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId
    + '?api_key=' + TMDB_API_KEY
    + '&language=tr-TR';

  return fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB yanıt vermedi: ' + r.status);
      return r.json();
    })
    .then(function(data) {
      return {
        titleTr:  data.name || '',
        titleEn:  data.original_name || '',
        year:     data.first_air_date ? data.first_air_date.slice(0, 4) : ''
      };
    });
}

// ── ASP endpoint numaralarını site.min.js'den çek ────────────
function fetchAspData() {
  return fetch(BASE_URL + '/js/site.min.js', { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(js) {
      var alternatifMatch = js.match(/dataAlternatif(.*?)\.asp/);
      var embedMatch      = js.match(/dataEmbed(.*?)\.asp/);
      return {
        alternatif: alternatifMatch ? alternatifMatch[1] : '',
        embed:      embedMatch      ? embedMatch[1]      : ''
      };
    });
}

// ── Başlığı URL karşılaştırması için normalize et ────────────
function normalizeStr(str) {
  return str
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

// ── Arama: başlık ile dizi sayfasını bul ─────────────────────
function searchShow(title) {
  var url = BASE_URL + '/diziler.asp?adi=' + encodeURIComponent(title);
  return fetch(url, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      // div.afis a  →  href + başlık
      var re = /<div[^>]+class=["'][^"']*afis[^"']*["'][^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>[\s\S]*?<div[^>]+class=["'][^"']*description[^"']*["'][^>]*>([^<]+)</g;
      var m;
      while ((m = re.exec(html)) !== null) {
        results.push({ href: m[1], title: m[2].trim() });
      }
      return results;
    });
}

// ── En iyi eşleşmeyi bul ─────────────────────────────────────
function findBestMatch(results, searchTitle) {
  var norm = normalizeStr(searchTitle);
  for (var i = 0; i < results.length; i++) {
    if (normalizeStr(results[i].title) === norm) return results[i].href;
  }
  for (var j = 0; j < results.length; j++) {
    if (normalizeStr(results[j].title).indexOf(norm) !== -1) return results[j].href;
  }
  if (results.length > 0) return results[0].href;
  return null;
}

// ── Dizi sayfasından endpoint al ─────────────────────────────
// URL formatı: https://sezonlukdizi8.com/dizi/inception-hd  → "inception-hd"
function getEndpoint(showUrl) {
  var parts = showUrl.replace(/\/$/, '').split('/');
  return parts[parts.length - 1];
}

// ── Bölüm sayfasını çek, season+episode'a uyan linki bul ─────
function fetchEpisodeUrl(showUrl, season, episode) {
  var endpoint = getEndpoint(showUrl);
  var url = BASE_URL + '/bolumler/' + endpoint;

  return fetch(url, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // table.unstackable içinde  tbody tr  satırları
      // Sütun düzeni: #, Sezon, Bölüm, Bölüm Adı (link)
      // <td>1.Sezon</td> <td>1.Bölüm</td> <td><a href="...">...</a></td>
      var rowRe = /<tr[\s\S]*?<\/tr>/g;
      var tdRe  = /<td[^>]*>([\s\S]*?)<\/td>/g;
      var rows  = html.match(rowRe) || [];

      for (var i = 0; i < rows.length; i++) {
        var row  = rows[i];
        var tds  = [];
        var m;
        while ((m = tdRe.exec(row)) !== null) tds.push(m[1]);
        tdRe.lastIndex = 0;

        if (tds.length < 4) continue;

        // tds[1] = "1.Sezon", tds[2] = "1.Bölüm"
        var epSezon = parseInt((tds[1] || '').replace(/\.Sezon.*/i, '').trim());
        var epBolum = parseInt((tds[2] || '').replace(/\.Bölüm.*/i, '').trim());

        if (epSezon === season && epBolum === episode) {
          var linkMatch = tds[3].match(/href=["']([^"']+)["']/);
          if (linkMatch) {
            var href = linkMatch[1];
            if (href.indexOf('http') !== 0) href = BASE_URL + href;
            console.log('[SezonlukDizi] Bölüm bulundu: ' + href);
            return href;
          }
        }
      }
      return null;
    });
}

// ── Bölüm sayfasından bid (data-id) çek ──────────────────────
function fetchBid(episodeUrl) {
  return fetch(episodeUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/id=["']dilsec["'][^>]+data-id=["']([^"']+)["']/);
      if (!m) m = html.match(/data-id=["']([^"']+)["'][^>]+id=["']dilsec["']/);
      if (!m) {
        console.log('[SezonlukDizi] bid bulunamadı');
        return null;
      }
      console.log('[SezonlukDizi] bid: ' + m[1]);
      return m[1];
    });
}

// ── Alternatif listesi çek (dil: 0=dublaj, 1=altyazı) ────────
function fetchAlternatifler(bid, dil, aspData) {
  var url = BASE_URL + '/ajax/dataAlternatif' + aspData.alternatif + '.asp';
  var body = 'bid=' + encodeURIComponent(bid) + '&dil=' + dil;

  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: body
  })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      try {
        var json = JSON.parse(text);
        if (json.status === 'success' && Array.isArray(json.data)) {
          return json.data; // [{baslik, id, kalite}]
        }
      } catch(e) {}
      return [];
    });
}

// ── Embed iframe src çek ──────────────────────────────────────
function fetchEmbedIframe(embedId, aspData) {
  var url = BASE_URL + '/ajax/dataEmbed' + aspData.embed + '.asp';
  var body = 'id=' + encodeURIComponent(embedId);

  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: body
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      return m ? m[1] : null;
    });
}

// ── iframe sayfasından doğrudan video URL çek (m3u8 desteklenmiyor) ──
function fetchStreamFromIframe(iframeSrc) {
  return fetch(iframeSrc, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // mp4
      var m = html.match(/["'](https?:[^"']+\.mp4[^"']*)['"]/i);
      if (m) return { url: m[1], type: 'mp4' };

      // mkv
      m = html.match(/["'](https?:[^"']+\.mkv[^"']*)['"]/i);
      if (m) return { url: m[1], type: 'mkv' };

      // avi, webm
      m = html.match(/["'](https?:[^"']+\.(avi|webm)[^"']*)['"]/i);
      if (m) return { url: m[1], type: m[2] };

      console.log('[SezonlukDizi] Desteklenen format bulunamadı (muhtemelen m3u8)');
      return null;
    });
}

// ── Tek bir alternatif kaynaktan stream üret ─────────────────
function processVeri(veri, dilAd, aspData) {
  return fetchEmbedIframe(veri.id, aspData)
    .then(function(iframeSrc) {
      if (!iframeSrc) return null;
      console.log('[SezonlukDizi] iframe: ' + iframeSrc);
      return fetchStreamFromIframe(iframeSrc);
    })
    .then(function(stream) {
      if (!stream) return null;
      return {
        url:      stream.url,
        quality:  veri.kalite ? veri.kalite + 'p' : 'Auto',
        label:    dilAd + ' — ' + veri.baslik,
        type:     stream.type,
        headers:  { 'Referer': BASE_URL + '/' }
      };
    })
    .catch(function(e) {
      console.log('[SezonlukDizi] processVeri hata: ' + e.message);
      return null;
    });
}

// ── Bir dil için tüm alternatifleri işle ─────────────────────
function processLanguage(bid, dil, dilAd, aspData) {
  return fetchAlternatifler(bid, dil, aspData)
    .then(function(veriList) {
      console.log('[SezonlukDizi] ' + dilAd + ' alternatif sayısı: ' + veriList.length);
      var promises = veriList.map(function(veri) {
        return processVeri(veri, dilAd, aspData);
      });
      return Promise.all(promises);
    })
    .then(function(results) {
      return results.filter(function(s) { return s !== null; });
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  // Sadece dizi
  if (mediaType !== 'tv') return Promise.resolve([]);

  console.log('[SezonlukDizi] getStreams → tmdbId=' + tmdbId + ' S' + season + 'E' + episode);

  var aspDataCache = null;

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      console.log('[SezonlukDizi] TMDB: ' + info.titleEn + ' / ' + info.titleTr);

      // Önce İngilizce ara, sonra Türkçe
      return searchShow(info.titleEn)
        .then(function(results) {
          var url = findBestMatch(results, info.titleEn);
          if (url) return url;
          return searchShow(info.titleTr).then(function(r2) {
            return findBestMatch(r2, info.titleTr);
          });
        });
    })
    .then(function(showUrl) {
      if (!showUrl) throw new Error('Dizi bulunamadı');
      console.log('[SezonlukDizi] Dizi URL: ' + showUrl);
      return fetchEpisodeUrl(showUrl, season, episode);
    })
    .then(function(episodeUrl) {
      if (!episodeUrl) throw new Error('Bölüm bulunamadı: S' + season + 'E' + episode);
      console.log('[SezonlukDizi] Bölüm URL: ' + episodeUrl);

      return Promise.all([
        fetchBid(episodeUrl),
        fetchAspData()
      ]);
    })
    .then(function(results) {
      var bid     = results[0];
      aspDataCache = results[1];

      if (!bid) throw new Error('bid alınamadı');
      console.log('[SezonlukDizi] ASP: alternatif=' + aspDataCache.alternatif + ' embed=' + aspDataCache.embed);

      return Promise.all([
        processLanguage(bid, '0', 'Dublaj',   aspDataCache),
        processLanguage(bid, '1', 'Altyazılı', aspDataCache)
      ]);
    })
    .then(function(allStreams) {
      var streams = allStreams[0].concat(allStreams[1]);
      console.log('[SezonlukDizi] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.log('[SezonlukDizi] Hata: ' + err.message);
      return [];
    });
}
-e 
module.exports = { getStreams: getStreams };
