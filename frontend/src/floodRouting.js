function pointInRing([x, y], ring) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(point, rings) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

function orientation(a, b, c) {
  const cross = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(cross) < 1e-10) return 0;
  return cross > 0 ? 1 : 2;
}

function onSegment(a, b, point) {
  return (
    point[0] >= Math.min(a[0], b[0]) - 1e-10 &&
    point[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-10 &&
    point[1] <= Math.max(a[1], b[1]) + 1e-10
  );
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);

  if (first !== second && third !== fourth) return true;
  if (first === 0 && onSegment(a, b, c)) return true;
  if (second === 0 && onSegment(a, b, d)) return true;
  if (third === 0 && onSegment(c, d, a)) return true;
  if (fourth === 0 && onSegment(c, d, b)) return true;
  return false;
}

function segmentHitsPolygon(start, end, rings) {
  if (pointInPolygon(start, rings) || pointInPolygon(end, rings)) return true;

  return rings.some((ring) =>
    ring.some((point, index) => {
      const next = ring[(index + 1) % ring.length];
      return segmentsIntersect(start, end, point, next);
    }),
  );
}

function getPolygons(feature) {
  const { type, coordinates } = feature.geometry ?? {};
  if (type === "Polygon") return [coordinates];
  if (type === "MultiPolygon") return coordinates;
  return [];
}

/** Checks route coordinates in [longitude, latitude] against GeoJSON hazards.
 * If the route starts inside a zone, its initial exit from that source zone is
 * allowed; re-entry and intersections with every other zone are rejected.
 */
export function routeTouchesEndpointZone(features, origin, destination) {
  return features.some((feature) =>
    getPolygons(feature).some(
      (rings) =>
        pointInPolygon(origin, rings) || pointInPolygon(destination, rings),
    ),
  );
}

export function routeIntersectsHazards(route, features, origin, destination) {
  if (!Array.isArray(route) || route.length < 2) return true;

  for (const feature of features) {
    for (const rings of getPolygons(feature)) {
      if (!rings?.[0]?.length) continue;
      const originInside = pointInPolygon(origin, rings);
      const destinationInside = pointInPolygon(destination, rings);
      if (originInside && destinationInside) continue;
      let exitedOriginZone = !originInside;

      for (let index = 0; index < route.length - 1; index += 1) {
        const start = route[index];
        const end = route[index + 1];

        if (originInside && !exitedOriginZone) {
          if (!pointInPolygon(end, rings)) exitedOriginZone = true;
          continue;
        }

        if (
          destinationInside &&
          index === route.length - 2 &&
          pointInPolygon(end, rings)
        ) {
          continue;
        }

        if (segmentHitsPolygon(start, end, rings)) return true;
      }
    }
  }

  return false;
}
