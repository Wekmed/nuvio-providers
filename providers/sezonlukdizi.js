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

// ── Title → slug ──────────────────────────────────────────────
function titleToSlug(title) {
  return (title || '').toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}

// ── Dizi sayfasını doğrula ve gerçek slug'ı al ───────────────
function validateShowPage(slug) {
  var url = BASE_URL + '/diziler/' + slug + '.html';
  return fetch(url, { headers: HEADERS })
    .then(function(r) {
      console.log('[SezonlukDizi] Slug dene: ' + url + ' → ' + r.status);
      if (r.status === 404) return null;
      return r.text().then(function(html) {
        if (html.indexOf('Sayfa Bulunamad') !== -1 || html.indexOf('Haydaaa') !== -1) {
          console.log('[SezonlukDizi] 404 içeriği: ' + url);
          return null;
        }
        // Bölüm linklerinden gerçek slug'ı çıkar
        // örn: href="/Invincible/1-sezon-1-bolum.html" veya href="/breaking-bad/1-sezon-1-bolum.html"
        var m = html.match(/href="\/([^\/]+)\/\d+-sezon-\d+-bolum\.html"/i);
        if (m) {
          var realSlug = m[1];
          console.log('[SezonlukDizi] Gerçek slug: ' + realSlug);
          return realSlug;
        }
        console.log('[SezonlukDizi] Dizi sayfası doğrulandı (bölüm linki yok): ' + slug);
        return slug;
      });
    })
    .catch(function(e) { console.log('[SezonlukDizi] validateShowPage hata: ' + e.message); return null; });
}

// ── Bölüm URL oluştur ─────────────────────────────────────────
function buildEpisodeUrl(showHref, season, episode) {
  // showHref örn: /diziler/breaking-bad.html veya https://sezonlukdizi.cc/diziler/breaking-bad.html
  var slug = showHref.replace(BASE_URL, '').replace('/diziler/', '').replace('.html', '');
  var url = BASE_URL + '/' + slug + '/' + season + '-sezon-' + episode + '-bolum.html';
  console.log('[SezonlukDizi] Bölüm URL: ' + url);
  return url;
}

// ── Bölüm sayfasından bid + Sibnet linkleri al ───────────────
function fetchBid(episodeUrl, sessionCookie) {
  var hdrs = Object.assign({}, HEADERS);
  if (sessionCookie) hdrs['Cookie'] = sessionCookie;

  return fetch(episodeUrl, { headers: hdrs })
    .then(function(r) {
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

      // bid bul
      var m = html.match(/data-id="([^"]+)"[^>]+id="dilsec"/);
      if (!m) m = html.match(/id="dilsec"[^>]+data-id="([^"]+)"/);
      if (!m) m = html.match(/data-id="([^"]+)"/);
      var bid = m ? m[1] : null;
      if (bid) console.log('[SezonlukDizi] bid: ' + bid);
      else {
        console.log('[SezonlukDizi] bid bulunamadı — HTML snippet: ' + html.slice(0, 300).replace(/\s+/g, ' '));
      }

      // Sibnet linklerini direkt HTML'den topla (fallback için)
      var sibnetLinks = [];
      var sibRe = /(?:src|href)="(https?:\/\/video\.sibnet\.ru\/[^"]+)"/gi;
      var sm;
      while ((sm = sibRe.exec(html)) !== null) {
        sibnetLinks.push(sm[1]);
      }
      // iframe içinde de ara
      var iframeRe = /<iframe[^>]+src="([^"]*sibnet[^"]*)"/gi;
      while ((sm = iframeRe.exec(html)) !== null) {
        if (sibnetLinks.indexOf(sm[1]) === -1) sibnetLinks.push(sm[1]);
      }
      console.log('[SezonlukDizi] Sayfada Sibnet link: ' + sibnetLinks.length);

      return { bid: bid, cookies: res.cookies, sibnetLinks: sibnetLinks };
    });
}

// ── Alternatif listesi ─────────────────────────────────────────
function fetchAlternatifler(bid, dil, aspData, cookies, refererUrl) {
  var url  = BASE_URL + '/ajax/dataAlternatif' + aspData.alternatif + '.asp';
  var body = 'bid=' + encodeURIComponent(bid) + '&dil=' + dil;
  var hdrs = Object.assign({}, HEADERS, {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type':     'application/x-www-form-urlencoded',
    'Origin':           BASE_URL,
    'Referer':          refererUrl || (BASE_URL + '/')
  });
  if (cookies) hdrs['Cookie'] = cookies;

  return fetch(url, { method: 'POST', headers: hdrs, body: body })
    .then(function(r) {
      console.log('[SezonlukDizi] Alternatif HTTP status (dil=' + dil + '): ' + r.status);
      return r.text();
    })
    .then(function(text) {
      console.log('[SezonlukDizi] Alternatif yanit (dil=' + dil + '): ' + (text || '(bos)').slice(0, 500));
      try {
        var json = JSON.parse(text);
        if (json.status === 'success' && Array.isArray(json.data)) return json.data;
        if (Array.isArray(json)) return json;
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

// ── Sibnet extractor ──────────────────────────────────────────
function fetchSibnetStream(sibnetUrl) {
  var videoId = (sibnetUrl.match(/videoid=(\d+)/) || sibnetUrl.match(/video(\d+)/) || [])[1];
  if (!videoId) { console.log('[SezonlukDizi] Sibnet videoId bulunamadı: ' + sibnetUrl); return Promise.resolve(null); }
  var shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + videoId;
  console.log('[SezonlukDizi] Sibnet shell: ' + shellUrl);

  return fetch(shellUrl, {
    headers: Object.assign({}, HEADERS, { 'Referer': 'https://video.sibnet.ru/' })
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
      if (!m) m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
      if (!m) { console.log('[SezonlukDizi] Sibnet /v/ URL bulunamadı'); return null; }
      var vUrl = 'https://video.sibnet.ru' + m[1];
      console.log('[SezonlukDizi] Sibnet /v/ URL: ' + vUrl);

      // /v/ URL'ye follow redirect ile istek at, son URL'yi al
      return fetch(vUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': HEADERS['User-Agent'],
          'Referer': shellUrl,
          'Range': 'bytes=0-'
        }
      }).then(function(r2) {
        var finalUrl = r2.url || vUrl;
        if (finalUrl && finalUrl !== vUrl) {
          console.log('[SezonlukDizi] Sibnet CDN (follow): ' + finalUrl);
          return { url: finalUrl, type: 'mp4', quality: '1080p' };
        }
        // response.url gelmediyse manuel redirect dene
        return fetch(vUrl, {
          redirect: 'manual',
          headers: {
            'User-Agent': HEADERS['User-Agent'],
            'Referer': shellUrl,
            'Range': 'bytes=0-'
          }
        }).then(function(r3) {
          var loc = r3.headers.get('location');
          if (loc) {
            if (loc.indexOf('//') === 0) loc = 'https:' + loc;
            console.log('[SezonlukDizi] Sibnet CDN (manual): ' + loc);
            return { url: loc, type: 'mp4', quality: '1080p' };
          }
          console.log('[SezonlukDizi] Sibnet redirect alınamadı, /v/ döndürülüyor');
          return { url: vUrl, type: 'mp4', quality: '1080p', referer: shellUrl };
        });
      });
    })
    .catch(function(e) {
      console.log('[SezonlukDizi] Sibnet hata: ' + e.message);
      return null;
    });
}

// ── iframe'den video URL ───────────────────────────────────────
function fetchStreamFromIframe(src) {
  // Sibnet özel işlem
  if (src.indexOf('sibnet.ru') !== -1) {
    return fetchSibnetStream(src);
  }

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
  // Sadece Sibnet işle (mp4 garantili), diğerleri m3u8 veya erişilemiyor
  var baslik = (veri.baslik || '').toLowerCase();
  if (baslik !== 'sibnet') {
    return Promise.resolve(null);
  }
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
        quality: stream.quality || (veri.kalite ? veri.kalite + 'p' : 'Auto'),
        label:   'SezonlukDizi — ' + dilAd + ' ' + (veri.baslik || ''),
        headers: { 'Referer': stream.referer || 'https://video.sibnet.ru/' }
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

      var slugEn = titleToSlug(info.titleEn);
      var slugTr = titleToSlug(info.titleTr);
      console.log('[SezonlukDizi] Slug EN: ' + slugEn + ' | TR: ' + slugTr);

      return validateShowPage(slugEn)
        .then(function(found) {
          if (found) return found;
          if (slugTr !== slugEn) return validateShowPage(slugTr);
          return null;
        })
        .then(function(slug) {
          if (!slug) throw new Error('Dizi bulunamadı: ' + slugEn);
          var epUrl = BASE_URL + '/' + slug + '/' + season + '-sezon-' + episode + '-bolum.html';
          console.log('[SezonlukDizi] Bölüm URL: ' + epUrl);
          return fetchBid(epUrl, cookie).then(function(bidData) {
            return { bidData: bidData, aspData: aspData, epUrl: epUrl };
          });
        });
    })
    .then(function(ctx) {
      var bidData  = ctx.bidData;
      var aspData  = ctx.aspData;
      var epUrl    = ctx.epUrl;

      // Alternatif AJAX'tan stream dene
      var ajaxPromise = (bidData && bidData.bid)
        ? Promise.all([
            fetchAlternatifler(bidData.bid, '0', aspData, bidData.cookies, epUrl).then(function(list) {
              console.log('[SezonlukDizi] Dublaj alternatif: ' + list.length);
              return Promise.all(list.map(function(v) { return processVeri(v, 'TR Dublaj', aspData); }));
            }),
            fetchAlternatifler(bidData.bid, '1', aspData, bidData.cookies, epUrl).then(function(list) {
              console.log('[SezonlukDizi] Altyazı alternatif: ' + list.length);
              return Promise.all(list.map(function(v) { return processVeri(v, 'TR Altyazı', aspData); }));
            })
          ]).then(function(all) { return all[0].concat(all[1]).filter(Boolean); })
        : Promise.resolve([]);

      return ajaxPromise.then(function(streams) {
        // AJAX boş geldiyse sayfadaki Sibnet linklerini kullan
        if (streams.length === 0 && bidData && bidData.sibnetLinks && bidData.sibnetLinks.length > 0) {
          console.log('[SezonlukDizi] AJAX boş, Sibnet fallback: ' + bidData.sibnetLinks.length + ' link');
          return Promise.all(bidData.sibnetLinks.map(function(url) {
            return fetchSibnetStream(url).then(function(s) {
              if (!s) return null;
              return {
                url:     s.url,
                quality: '1080p',
                label:   'SezonlukDizi — Sibnet',
                headers: { 'Referer': 'https://video.sibnet.ru/' }
              };
            });
          })).then(function(results) { return results.filter(Boolean); });
        }
        return streams;
      });
    })
    .then(function(streams) {
      console.log('[SezonlukDizi] Toplam stream: ' + streams.length);
      return streams;
    })
    .catch(function(err) {
      console.log('[SezonlukDizi] Hata: ' + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
