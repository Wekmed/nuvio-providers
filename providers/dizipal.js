// ============================================================
//  DiziPal — Nuvio Provider
//  CloudStream (Kotlin) → Nuvio (JavaScript) port
//  Kaynak: DiziPal.kt by @keyiflerolsun / @KekikAkademi
//  Film ve Dizi destekler
//  NOT: DiziPal URL'i sık değişir (dizipal1540.com gibi)
//       Çalışmazsa BASE_URL'i güncelle
// ============================================================

var BASE_URL     = 'https://dizipal1540.com';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB'den içerik bilgisi çek ──────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
    + '?api_key=' + TMDB_API_KEY + '&language=tr-TR';

  return fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB hata: ' + r.status);
      return r.json();
    })
    .then(function(data) {
      return {
        titleTr: (mediaType === 'tv' ? data.name : data.title) || '',
        titleEn: (mediaType === 'tv' ? data.original_name : data.original_title) || '',
        year:    (data.first_air_date || data.release_date || '').slice(0, 4)
      };
    });
}

// ── Arama ────────────────────────────────────────────────────
function searchDiziPal(query) {
  return fetch(BASE_URL + '/api/search-autocomplete', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: 'query=' + encodeURIComponent(query)
  })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      try {
        var map = JSON.parse(text);
        // Obje → array dönüştür
        return Object.keys(map).map(function(k) { return map[k]; });
      } catch(e) {
        console.log('[DiziPal] Arama parse hatası: ' + e.message);
        return [];
      }
    });
}

// ── En iyi eşleşmeyi bul ─────────────────────────────────────
function normalizeStr(str) {
  return (str || '')
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function findBestMatch(items, titleEn, titleTr, year, mediaType) {
  var normEn = normalizeStr(titleEn);
  var normTr = normalizeStr(titleTr);
  var typeStr = mediaType === 'tv' ? 'series' : 'movie';

  // 1. Tam başlık + doğru tür + yıl
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.type !== typeStr) continue;
    var normTitle    = normalizeStr(item.title);
    var normTrTitle  = normalizeStr(item.tr_title);
    if ((normTitle === normEn || normTrTitle === normTr) && item.year === year) {
      return item;
    }
  }

  // 2. Tam başlık + doğru tür
  for (var j = 0; j < items.length; j++) {
    var item2 = items[j];
    if (item2.type !== typeStr) continue;
    var normTitle2   = normalizeStr(item2.title);
    var normTrTitle2 = normalizeStr(item2.tr_title);
    if (normTitle2 === normEn || normTrTitle2 === normTr) return item2;
  }

  // 3. İçeriyor + doğru tür
  for (var k = 0; k < items.length; k++) {
    var item3 = items[k];
    if (item3.type !== typeStr) continue;
    var normTitle3 = normalizeStr(item3.title);
    if (normTitle3.indexOf(normEn) !== -1) return item3;
  }

  // 4. İlk sonuç
  if (items.length > 0) return items[0];
  return null;
}

// ── İçerik sayfasından iframe src al ─────────────────────────
function fetchIframeSrc(pageUrl) {
  return fetch(pageUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // .series-player-container iframe veya div#vast_new iframe
      var m = html.match(/series-player-container[\s\S]{0,200}?<iframe[^>]+src=["']([^"']+)["']/i);
      if (!m) m = html.match(/vast_new[\s\S]{0,200}?<iframe[^>]+src=["']([^"']+)["']/i);
      if (!m) m = html.match(/<iframe[^>]+src=["'](https?[^"']+)["'][^>]*>/i);

      if (!m) {
        console.log('[DiziPal] iframe bulunamadı');
        return null;
      }

      var src = m[1];
      if (src.indexOf('http') !== 0) src = BASE_URL + src;
      console.log('[DiziPal] iframe: ' + src);
      return src;
    });
}

// ── iframe'den stream ve altyazı çek ─────────────────────────
function fetchStreamFromIframe(iframeSrc) {
  return fetch(iframeSrc, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // file:"..." veya file:'...'
      var fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
      var videoUrl  = fileMatch ? fileMatch[1] : null;

      // Altyazı: "subtitle":"[Türkçe]https://..."
      var subtitles = [];
      var subMatch  = html.match(/"subtitle"\s*:\s*"([^"]+)"/);
      if (subMatch && subMatch[1]) {
        var subRaw = subMatch[1];
        // Virgülle ayrılmış birden fazla altyazı olabilir
        subRaw.split(',').forEach(function(sub) {
          sub = sub.trim();
          var langMatch = sub.match(/^\[([^\]]+)\]/);
          var lang      = langMatch ? langMatch[1] : 'Türkçe';
          var subUrl    = langMatch ? sub.replace('[' + lang + ']', '') : sub;
          if (subUrl && subUrl.indexOf('http') === 0) {
            subtitles.push({ url: subUrl, lang: lang });
          }
        });
      }

      if (!videoUrl) {
        // Doğrudan mp4/mkv linki ara
        var directMatch = html.match(/["'](https?:[^"']+\.(mp4|mkv)[^"']{0,50})["']/i);
        if (directMatch) videoUrl = directMatch[1];
      }

      if (!videoUrl) {
        console.log('[DiziPal] Video URL bulunamadı');
        return null;
      }

      var isM3u8 = videoUrl.indexOf('.m3u8') !== -1;
      if (isM3u8) {
        console.log('[DiziPal] m3u8 atlanıyor: ' + videoUrl.slice(0, 80));
        return null;
      }

      return { url: videoUrl, subtitles: subtitles };
    });
}

// ── Film için stream al ───────────────────────────────────────
function getMovieStreams(item) {
  var pageUrl = BASE_URL + item.url;
  console.log('[DiziPal] Film sayfası: ' + pageUrl);

  return fetchIframeSrc(pageUrl)
    .then(function(iframeSrc) {
      if (!iframeSrc) return [];
      return fetchStreamFromIframe(iframeSrc);
    })
    .then(function(stream) {
      if (!stream) return [];
      return [{
        url:       stream.url,
        quality:   'Auto',
        label:     'DiziPal',
        subtitles: stream.subtitles,
        headers:   { 'Referer': BASE_URL + '/' }
      }];
    });
}

// ── Dizi için bölüm URL'i oluştur ────────────────────────────
// DiziPal bölüm URL formatı: /dizi/breaking-bad/1-sezon/1-bolum
function buildEpisodeUrl(item, season, episode) {
  // item.url = /dizi/breaking-bad
  var base = item.url.replace(/\/$/, '');
  return BASE_URL + base + '/' + season + '-sezon/' + episode + '-bolum';
}

// ── Dizi için stream al ───────────────────────────────────────
function getSeriesStreams(item, season, episode) {
  var pageUrl = buildEpisodeUrl(item, season, episode);
  console.log('[DiziPal] Bölüm sayfası: ' + pageUrl);

  return fetchIframeSrc(pageUrl)
    .then(function(iframeSrc) {
      if (!iframeSrc) return [];
      return fetchStreamFromIframe(iframeSrc);
    })
    .then(function(stream) {
      if (!stream) return [];
      return [{
        url:       stream.url,
        quality:   'Auto',
        label:     'DiziPal',
        subtitles: stream.subtitles,
        headers:   { 'Referer': BASE_URL + '/' }
      }];
    });
}

// ── Ana fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[DiziPal] getStreams → tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      console.log('[DiziPal] TMDB: "' + info.titleEn + '" / "' + info.titleTr + '" (' + info.year + ')');

      // Önce İngilizce ara
      return searchDiziPal(info.titleEn)
        .then(function(results) {
          console.log('[DiziPal] Arama sonucu (' + info.titleEn + '): ' + results.length);
          var match = findBestMatch(results, info.titleEn, info.titleTr, info.year, mediaType);
          if (match) return match;

          // Türkçe fallback
          return searchDiziPal(info.titleTr).then(function(r2) {
            console.log('[DiziPal] Arama sonucu (' + info.titleTr + '): ' + r2.length);
            return findBestMatch(r2, info.titleEn, info.titleTr, info.year, mediaType);
          });
        });
    })
    .then(function(item) {
      if (!item) throw new Error('İçerik bulunamadı');
      console.log('[DiziPal] Eşleşme: "' + item.title + '" type=' + item.type + ' url=' + item.url);

      if (mediaType === 'movie') {
        return getMovieStreams(item);
      } else {
        return getSeriesStreams(item, season, episode);
      }
    })
    .then(function(streams) {
      console.log('[DiziPal] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.log('[DiziPal] Hata: ' + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
