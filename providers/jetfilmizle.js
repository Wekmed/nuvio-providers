// ============================================================
//  JetFilmizle — Nuvio Provider
// ============================================================

var BASE_URL     = 'https://jetfilmizle.net';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

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

function titleToSlug(title) {
  return (title || '')
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isFilmPage(html) {
  return html.indexOf('film_id') !== -1 ||
         html.indexOf('pixeldrain.com') !== -1 ||
         html.indexOf('player-source-btn') !== -1;
}

function findFilmUrl(titleTr, titleEn) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);
  var candidates = [];
  if (slugTr) candidates.push(BASE_URL + '/film/' + slugTr);
  if (slugEn && slugEn !== slugTr) candidates.push(BASE_URL + '/film/' + slugEn);
  console.log('[JetFilmizle] Slug adayları: ' + candidates.join(', '));

  function tryNext(i) {
    if (i >= candidates.length) return searchFallback(titleTr, titleEn);
    var url = candidates[i];
    return fetch(url, { headers: HEADERS })
      .then(function(r) {
        if (!r.ok) {
          console.log('[JetFilmizle] ' + url + ' → ' + r.status);
          return tryNext(i + 1);
        }
        return r.text().then(function(html) {
          var valid = isFilmPage(html);
          console.log('[JetFilmizle] ' + url + ' → 200, geçerli: ' + valid);
          if (valid) return url;
          return tryNext(i + 1);
        });
      })
      .catch(function(e) {
        console.log('[JetFilmizle] Fetch hatası: ' + e.message);
        return tryNext(i + 1);
      });
  }
  return tryNext(0);
}

function searchFallback(titleTr, titleEn) {
  var query = titleTr || titleEn;
  console.log('[JetFilmizle] Arama: ' + query);
  return fetch(BASE_URL + '/arama?q=' + encodeURIComponent(query), { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      console.log('[JetFilmizle] Arama HTML: ' + html.length + ' byte');
      var cardRe = /href="(https?:\/\/jetfilmizle\.net\/film\/[^"?#]+)"/g;
      var m, seen = {}, links = [];
      while ((m = cardRe.exec(html)) !== null) {
        if (!seen[m[1]]) { seen[m[1]] = true; links.push(m[1]); }
      }
      console.log('[JetFilmizle] Arama sonucu: ' + links.length);
      if (links.length === 0) throw new Error('Film bulunamadı');
      var normTr = titleToSlug(titleTr);
      var normEn = titleToSlug(titleEn);
      for (var i = 0; i < links.length; i++) {
        var s = (links[i].split('/film/')[1] || '').split('/')[0];
        if (s === normTr || s === normEn) return links[i];
      }
      return links[0];
    });
}

function fetchFilmLinks(filmUrl) {
  return fetch(filmUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var links = [];
      var dlRe = /href="(https?:\/\/pixeldrain\.com\/u\/[^"]+)"/g;
      var m;
      while ((m = dlRe.exec(html)) !== null) {
        links.push({ type: 'pixeldrain', url: m[1] });
        console.log('[JetFilmizle] Pixeldrain: ' + m[1]);
      }
      var ifRe = /<iframe[^>]+(?:src|data-src)="([^"]*(?:jetv|d2rs|vidmoly|mlycdn)[^"]*)"/gi;
      var im;
      while ((im = ifRe.exec(html)) !== null) {
        links.push({ type: 'iframe', url: im[1] });
        console.log('[JetFilmizle] iframe: ' + im[1]);
      }
      console.log('[JetFilmizle] Toplam link: ' + links.length);
      return links;
    });
}

function pixeldrainToStream(pdUrl) {
  var fileId = pdUrl.split('/u/').pop().split('?')[0];
  var directUrl = 'https://pixeldrain.com/api/file/' + fileId + '?download';
  var infoUrl   = 'https://pixeldrain.com/api/file/' + fileId + '/info';

  return fetch(infoUrl)
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(info) {
      var name  = (info && info.name)  || '';
      var size  = (info && info.size)  || 0;  // bytes
      var quality;
      // Önce dosya adına bak
      if      (/2160p|4k/i.test(name))  quality = '4K';
      else if (/1080p/i.test(name))     quality = '1080p';
      else if (/720p/i.test(name))      quality = '720p';
      else if (/480p/i.test(name))      quality = '480p';
      // Dosya adında bilgi yoksa boyuta göre tahmin et
      else if (size > 3 * 1024 * 1024 * 1024) quality = '1080p'; // >3GB
      else if (size > 1 * 1024 * 1024 * 1024) quality = '720p';  // >1GB
      else if (size > 0)                       quality = '480p';
      else                                     quality = 'Auto';
      console.log('[JetFilmizle] Pixeldrain: ' + quality + ' | ' + name + ' | ' + Math.round(size/1024/1024) + 'MB');
      return {
        url:     directUrl,
        quality: quality,
        label:   'JetFilmizle — TR Dublaj ' + quality,
        headers: { 'Referer': 'https://pixeldrain.com/' }
      };
    })
    .catch(function() {
      return {
        url:     directUrl,
        quality: 'Auto',
        label:   'JetFilmizle — TR Dublaj',
        headers: { 'Referer': 'https://pixeldrain.com/' }
      };
    });
}

function fetchIframeStream(iframeUrl) {
  return fetch(iframeUrl, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var vm = /(https?:\/\/[^\s"'<>]+\.(?:mp4|mkv|webm|avi)(?:\?[^"'\s<>]*)?)/gi.exec(html);
      if (vm) return { url: vm[1], quality: 'Auto', label: 'JetFilmizle — Player' };
      return null;
    })
    .catch(function() { return null; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== 'movie') return Promise.resolve([]);
  console.log('[JetFilmizle] getStreams → tmdbId=' + tmdbId);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      console.log('[JetFilmizle] TMDB: "' + info.titleEn + '" / "' + info.titleTr + '" (' + info.year + ')');
      return findFilmUrl(info.titleTr, info.titleEn);
    })
    .then(function(filmUrl) {
      console.log('[JetFilmizle] Film URL: ' + filmUrl);
      return fetchFilmLinks(filmUrl);
    })
    .then(function(links) {
      var pdLinks = links.filter(function(l) { return l.type === 'pixeldrain'; });
      var otherLinks = links.filter(function(l) { return l.type !== 'pixeldrain'; });

      // Tüm pixeldrain linklerinin boyutunu çek, büyükten küçüğe sırala
      var pdPromise = Promise.all(pdLinks.map(function(link) {
        var fileId = link.url.split('/u/').pop().split('?')[0];
        return fetch('https://pixeldrain.com/api/file/' + fileId + '/info')
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(info) {
            return {
              url:  link.url,
              size: (info && info.size) || 0,
              name: (info && info.name) || ''
            };
          })
          .catch(function() { return { url: link.url, size: 0, name: '' }; });
      })).then(function(pdInfos) {
        // Boyuta göre büyükten küçüğe sırala
        pdInfos.sort(function(a, b) { return b.size - a.size; });
        var qualities = ['1080p', '720p', '480p', '360p'];
        return pdInfos.map(function(info, idx) {
          var fileId = info.url.split('/u/').pop().split('?')[0];
          // Dosya adında kalite bilgisi varsa onu kullan, yoksa sıraya göre ata
          var quality;
          if      (/2160p|4k/i.test(info.name))  quality = '4K';
          else if (/1080p/i.test(info.name))      quality = '1080p';
          else if (/720p/i.test(info.name))       quality = '720p';
          else if (/480p/i.test(info.name))       quality = '480p';
          else quality = qualities[idx] || 'Auto';
          console.log('[JetFilmizle] #' + (idx+1) + ' ' + quality + ' | ' + Math.round(info.size/1024/1024) + 'MB | ' + info.name);
          return {
            url:     'https://pixeldrain.com/api/file/' + fileId + '?download',
            quality: quality,
            label:   'JetFilmizle — TR Dublaj ' + quality,
            headers: { 'Referer': 'https://pixeldrain.com/' }
          };
        });
      });

      var streams = [], promises = [pdPromise.then(function(ss) { ss.forEach(function(s) { streams.push(s); }); })];
      otherLinks.forEach(function(link) {
        if (link.type === 'iframe') {
          promises.push(fetchIframeStream(link.url).then(function(s) { if (s) streams.push(s); }));
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
