// Rules for turning OSM tags into dimensions. Every value that is not read
// directly from a tag is flagged as estimated so it can be verified later.

const LEVEL_HEIGHT = 3.6; // m per storey for UTD academic/residential buildings

const DEFAULT_HEIGHT: Record<string, number> = {
  university: 16, school: 10, dormitory: 13, apartments: 10, residential: 9,
  commercial: 8, office: 14, house: 6.5, detached: 6.5, terrace: 7.5, garage: 3,
  shed: 3, roof: 4.5, parking: 15, church: 10, grandstand: 6, carport: 3,
  greenhouse: 4, public: 10, service: 5, industrial: 8,
};

export function parseMeters(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*([\d.]+)\s*(m|ft)?\s*$/.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return m[2] === 'ft' ? n * 0.3048 : n;
}

export function estimateBuildingHeight(tags: Record<string, string>) {
  const minHeight = parseMeters(tags.min_height) ?? (tags['building:min_level'] ? +tags['building:min_level'] * LEVEL_HEIGHT : 0);
  const h = parseMeters(tags.height);
  if (h !== undefined) return { height: h, minHeight, estimated: false };
  const levels = parseFloat(tags['building:levels']);
  if (!isNaN(levels)) return { height: levels * LEVEL_HEIGHT + 1, minHeight, estimated: false };
  return { height: DEFAULT_HEIGHT[tags.building] ?? 8, minHeight, estimated: true };
}

// Defaults follow typical North Texas campus and city design dimensions: two 3.6 m
// lanes plus gutters for collectors, 7.3 m (24 ft) two-way parking aisles,
// 1.5-1.8 m city sidewalks and wider 3-4 m campus walks.
const DEFAULT_WIDTH: Record<string, number> = {
  primary: 14, secondary: 13, secondary_link: 6.5, tertiary: 10, tertiary_link: 6,
  unclassified: 8, residential: 9, service: 6, footway: 3, cycleway: 3,
  path: 2.4, pedestrian: 6, steps: 3, construction: 6, track: 3, living_street: 6,
};

export function estimateRoadWidth(tags: Record<string, string>) {
  const w = parseMeters(tags.width);
  if (w !== undefined) return { width: w, estimated: false };
  const lanes = parseInt(tags.lanes);
  if (!isNaN(lanes) && ['primary', 'secondary', 'tertiary', 'unclassified', 'residential'].includes(tags.highway))
    return { width: lanes * 3.4 + 1, estimated: false };
  if (tags.highway === 'service' && tags.service === 'parking_aisle') return { width: 7.3, estimated: true };
  if (tags.highway === 'service' && (tags.service === 'driveway' || tags.service === 'drive-through')) return { width: 4, estimated: true };
  if (tags.highway === 'service' && tags.service === 'alley') return { width: 5, estimated: true };
  if (tags.highway === 'footway' && tags.footway === 'sidewalk') return { width: 1.8, estimated: true };
  if (tags.highway === 'footway' && tags.footway === 'crossing') return { width: 3, estimated: true };
  if (tags.highway === 'footway' && tags.footway === 'access_aisle') return { width: 2.4, estimated: true };
  return { width: DEFAULT_WIDTH[tags.highway] ?? 4, estimated: true };
}

export function areaKind(t: Record<string, string>): string | undefined {
  if (t.amenity === 'parking' && (!t.parking || t.parking === 'surface')) return 'parking';
  if (t.natural === 'water' || t.water) return 'water';
  if (t.leisure === 'swimming_pool') return 'pool';
  if (t.leisure === 'pitch' || t.leisure === 'track') return t.leisure;
  if (t.leisure === 'garden' && /Rock Garden/i.test(t.name ?? '')) return 'rockGarden';
  if (['park', 'garden', 'dog_park', 'playground'].includes(t.leisure)) return 'park';
  if (['grass', 'recreation_ground', 'meadow', 'village_green'].includes(t.landuse)) return 'grass';
  if (t.landuse === 'construction') return 'construction';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub' || t.natural === 'grassland') return 'scrub';
  if (t.amenity === 'parking' && t.parking === 'multi-storey') return undefined;
  return undefined;
}

/**
 * Facade/roof style. OSM has almost no material or roof tags here, so the
 * style comes from the building type and, for named campus buildings, from
 * the architecture visible in reference photos (tan precast 1970s-80s core
 * buildings, white and glass post-2000 buildings, pitched-roof housing).
 */
const MODERN = /Engineering and Computer Science West|Sciences Building|Science Learning|Natural Science|Bioengineering|Arts & Technology|Jindal|Student Services|Athenaeum|Davidson|Waterview Academic|Dining Hall|Recreation Center|Comets|Callier Center Richardson Addition|Visitor/i;
const PRECAST = /Founders|Green Hall|Jonsson|Administration|Berkner|McDermott|Activity Center|Student Union|Hoblitzelle|Classroom|Physics|Callier|Computer Science North|Computer Science South|Energy Plant|Theatre|Conference|Satellite Utility|Synergy|Research and Operations|Reasearch/i;
/** Named buildings whose facades are distinctive enough for their own look (reference photos). */
const NAMED_STYLES: [RegExp, string][] = [
  [/^Founders/i, 'finsWhite'],
  [/Green Hall|Jonsson Academic|Administration Building|Berkner|^Physics|^Classroom Building|University Theatre/i, 'precastPunched'],
  [/McDermott Library|Hoblitzelle|^Activity Center|^Student Union$|Student Union Food Court|Callier Center Richardson$|Computer Science (North|South)/i, 'precast'],
  [/Natural Science and Engineering/i, 'nserl'],
  [/Bioengineering/i, 'glassStone'],
  [/Arts & Technology/i, 'atec'],
  [/^Sciences Building/i, 'sciences'],
  [/Science Learning Center/i, 'slc'],
  [/Student Services Building Addition/i, 'ssbAdd'],
  [/^Student Services Building$/i, 'ssb'],
  [/Callier Center Richardson Addition/i, 'callierAdd'],
  [/^Facilities Management$|Facilities Management Shop/i, 'metalDark'],
  [/Parking Structure 4/i, 'garageFins'],
  [/Waterview Science/i, 'brickRed'],
  [/Synergy Park|Research and Operations|Reasearch Operations/i, 'officeBands'],
  [/Dining Hall|Davidson-Gundy|Athenaeum|Comets LANding/i, 'glassPavilion'],
  // OSM still tags it as a construction site; the October 2026 reference photo shows it finished.
  [/Student Union \/ Student Success Center/i, 'modern'],
];

export function buildingStyle(t: Record<string, string>): string {
  const n = t.name ?? '', k = t.building;
  for (const [re, style] of NAMED_STYLES) if (re.test(n)) return style;
  if (k === 'construction') return 'construction';
  if (k === 'roof') return 'canopy';
  if (k === 'parking' || (k === 'garage' && /Parking Structure/i.test(n))) return 'garage';
  if (k === 'greenhouse') return 'greenhouse';
  if (k === 'dormitory') return /Canyon Creek/i.test(n) ? 'canyonBrick' : 'hallTan';
  if (/^Northside/i.test(n)) return 'canyonBrick';
  if (k === 'apartments' || /Clubhouse|Laundry|Leasing/i.test(n)) return 'villageStone';
  if (['house', 'detached', 'terrace', 'semidetached_house', 'residential'].includes(k)) return 'house';
  if (['garage', 'shed', 'carport'].includes(k)) return 'shed';
  if (MODERN.test(n)) return 'modern';
  if (PRECAST.test(n)) return 'precast';
  if (/Facilities|Service|Surplus|Warehouse|Modular|North Lab|Maintenance|Safety|Police|Storage|Pole Barn|Shop/i.test(n)) return 'metal';
  if (k === 'university') return 'precast';
  if (['commercial', 'office', 'retail', 'industrial', 'school', 'hospital'].includes(k)) return 'office';
  return 'precast';
}
