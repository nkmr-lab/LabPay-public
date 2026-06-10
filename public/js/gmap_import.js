// v504 #122 Google Maps の保存リスト (KML / GeoJSON) のパーサ。
// places (食べある記) とグループのスケジュール両方から使う共通ユーティリティ。
//
// 戻り値: [{title, description, address, lat, lng}, ...]
// 緯度経度が無い場合は lat=null, lng=null で返す。

export function parseGmapFile(fileName, text) {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.kml')) return parseKml(text);
  return parseGeoJson(text);
}

export function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const placemarks = doc.getElementsByTagName('Placemark');
  const out = [];
  for (const pm of placemarks) {
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || '';
    if (!name) continue;
    const desc = pm.getElementsByTagName('description')[0]?.textContent?.trim() || '';
    const addr = pm.getElementsByTagName('address')[0]?.textContent?.trim() || '';
    const coords = pm.getElementsByTagName('coordinates')[0]?.textContent?.trim() || '';
    let lat = null, lng = null;
    if (coords) {
      const parts = coords.split(',').map(s => Number(s.trim()));
      if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) {
        // KML は lng, lat, [alt] の順
        lng = parts[0]; lat = parts[1];
      }
    }
    out.push({ title: name, description: desc, address: addr, lat, lng });
  }
  return out;
}

export function parseGeoJson(text) {
  const j = JSON.parse(text);
  const features = j.type === 'FeatureCollection' ? (j.features || [])
                  : j.type === 'Feature' ? [j] : [];
  const out = [];
  for (const f of features) {
    const p = f.properties || {};
    const name = (p.name || p.Title || p.title || '').toString().trim();
    if (!name) continue;
    const desc = (p.description || p.Description || '').toString().trim();
    const addr = (p.address || p.Address || '').toString().trim();
    let lat = null, lng = null;
    if (f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      lng = Number(f.geometry.coordinates[0]);
      lat = Number(f.geometry.coordinates[1]);
      if (!isFinite(lat) || !isFinite(lng)) { lat = null; lng = null; }
    }
    out.push({ title: name, description: desc, address: addr, lat, lng });
  }
  return out;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 既存リスト ([{title, lat, lng, ...}]) との重複判定。 タイトル一致 (大小無視) +
// 緯度経度 50m 以内なら同じ場所とみなす。 緯度経度が無い場合はタイトル一致のみ。
export function isDupOf(existing, candidate) {
  return existing.some(e => {
    if (!e.title || !candidate.title) return false;
    if (e.title.trim().toLowerCase() !== candidate.title.trim().toLowerCase()) return false;
    if (e.lat == null || e.lng == null || candidate.lat == null || candidate.lng == null) return true;
    return haversineMeters(e.lat, e.lng, candidate.lat, candidate.lng) < 50;
  });
}
