// Local tangent-plane projection (WGS84) centered on the UT Dallas campus.
// x = meters east of origin, y = meters north of origin. Over the ~2 km campus
// extent the error versus a true ENU transform is well under 0.2 m.

export interface LatLon { lat: number; lon: number }

// Reference point near the Plinth, center of the academic core.
// Matches the commonly cited campus coordinate 32°59′09″N 96°45′01″W.
export const ORIGIN: LatLon = { lat: 32.9858, lon: -96.7503 };

const A = 6378137.0; // WGS84 semi-major axis
const E2 = 6.69437999014e-3; // WGS84 first eccentricity squared
const DEG = Math.PI / 180;

export function radiiAt(latDeg: number) {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - E2 * s * s;
  return {
    meridional: (A * (1 - E2)) / Math.pow(w, 1.5),
    primeVertical: A / Math.sqrt(w),
  };
}

const R0 = radiiAt(ORIGIN.lat);
const M_PER_DEG_LAT = R0.meridional * DEG;
const M_PER_DEG_LON = R0.primeVertical * Math.cos(ORIGIN.lat * DEG) * DEG;

export function project(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, (lat - ORIGIN.lat) * M_PER_DEG_LAT];
}

export function unproject(x: number, y: number): LatLon {
  return { lat: ORIGIN.lat + y / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}

/** Ellipsoidal (WGS84) distance in meters via Vincenty's inverse formula. */
export function vincenty(a: LatLon, b: LatLon): number {
  const f = 1 / 298.257223563, bAxis = A * (1 - f);
  const L = (b.lon - a.lon) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(a.lat * DEG)), U2 = Math.atan((1 - f) * Math.tan(b.lat * DEG));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lambda = L, sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lambda), cl = Math.cos(lambda);
    sinSigma = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sinSigma === 0) return 0;
    cosSigma = sU1 * sU2 + cU1 * cU2 * cl;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cU1 * cU2 * sl) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha ? cosSigma - (2 * sU1 * sU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) break;
  }
  const u2 = (cos2Alpha * (A * A - bAxis * bAxis)) / (bAxis * bAxis);
  const Ac = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bc = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma = Bc * sinSigma * (cos2SigmaM + (Bc / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - (Bc / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return bAxis * Ac * (sigma - dSigma);
}

/** Great-circle distance in meters (haversine on the mean Earth radius). */
export function haversine(a: LatLon, b: LatLon): number {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
