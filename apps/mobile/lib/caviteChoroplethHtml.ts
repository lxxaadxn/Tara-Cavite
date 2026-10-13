import { DIAGNOSTICS_SNIPPET } from './leafletDiagnosticsSnippet';
import type { VendoredLeaflet } from './leafletVendoredAssets';

const LEAFLET_CDN_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_CDN_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

const MASK_FILL = '#F1F7F6';
const VISITED_FILL = '#1B8A70';
const VISITED_STROKE = '#0F5C4C';
const IDLE_FILL = '#E2E8F0';
const IDLE_STROKE = '#94A3B8';

/**
 * Cavite LGU choropleth document — the WebView twin of web `components/CaviteVisitMap.jsx`.
 * Visited cities/municipalities light up teal; everything outside the province is
 * covered by a world polygon with the LGU exteriors punched out as holes.
 *
 * The host sends visit counts with `window.__cavitourUpdateChoropleth({ counts })`,
 * where `counts` maps `foldLguName(city_mun)` to a visit tally.
 */
export function buildCaviteChoroplethHtml(
  leaflet: VendoredLeaflet | null,
  geojsonText: string
): string {
  const styleTag = leaflet
    ? `<style>\n${leaflet.css}\n</style>`
    : `<link rel="stylesheet" href="${LEAFLET_CDN_CSS}" crossorigin="" />`;
  const scriptTag = leaflet
    ? `<script>\n${leaflet.js}\n<\/script>`
    : `<script src="${LEAFLET_CDN_JS}" crossorigin=""><\/script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <script>${DIAGNOSTICS_SNIPPET}<\/script>
  ${styleTag}
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: ${MASK_FILL}; }
    #map { height: 100%; width: 100%; background: ${MASK_FILL}; }
    .leaflet-container { background: ${MASK_FILL}; }
  </style>
</head>
<body>
  <div id="map"></div>
  ${scriptTag}
  <script id="cavite-lgus" type="application/json">${geojsonText}<\/script>
  <script>
    (function () {
      function postToHost(obj) {
        var s = JSON.stringify(obj);
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(s);
            return;
          }
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(s, '*');
          }
        } catch (e) {}
      }

      window.addEventListener('message', function (ev) {
        try {
          var raw = ev.data;
          var d = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (d && d.type === 'cavitourChoroplethUpdate' && d.payload) {
            window.__cavitourUpdateChoropleth(d.payload);
          }
        } catch (e) {}
      });

      try {
        var geo = JSON.parse(document.getElementById('cavite-lgus').textContent);

        /* Same bbox and zoom envelope as web lib/caviteMapBounds.js. */
        var caviteBounds = L.latLngBounds(L.latLng(13.88, 120.44), L.latLng(14.52, 121.08));
        var CAVITE_MIN_ZOOM_FLOOR = 10;
        var CAVITE_MAX_ZOOM = 19;

        var map = L.map('map', {
          zoomControl: false,
          attributionControl: false,
          scrollWheelZoom: false,
          dragging: true,
          touchZoom: true,
          doubleClickZoom: true,
          maxBounds: caviteBounds,
          maxBoundsViscosity: 1.0,
          minZoom: CAVITE_MIN_ZOOM_FLOOR,
          maxZoom: CAVITE_MAX_ZOOM
        }).setView(caviteBounds.getCenter(), 11);

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: CAVITE_MAX_ZOOM
        }).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        function applyViewportZoomLock() {
          map.invalidateSize(true);
          var size = map.getSize();
          if (!size || size.x < 10 || size.y < 10) return false;
          var minZ = map.getBoundsZoom(caviteBounds, false);
          if (!isFinite(minZ) || minZ < 0) return false;
          minZ = Math.max(CAVITE_MIN_ZOOM_FLOOR, Math.min(minZ, map.getMaxZoom()));
          map.setMinZoom(minZ);
          if (map.getZoom() < minZ) map.setZoom(minZ);
          map.panInsideBounds(caviteBounds, { animate: false });
          return true;
        }

        map.whenReady(function () {
          if (!applyViewportZoomLock()) {
            requestAnimationFrame(function () {
              if (!applyViewportZoomLock()) requestAnimationFrame(applyViewportZoomLock);
            });
          }
        });
        map.on('resize', applyViewportZoomLock);
        var mapEl = document.getElementById('map');
        if (typeof ResizeObserver !== 'undefined' && mapEl) {
          new ResizeObserver(function () {
            map.invalidateSize(true);
            applyViewportZoomLock();
          }).observe(mapEl);
        }

        function foldName(name) {
          return String(name == null ? '' : name)
            .normalize('NFD')
            .replace(/[\\u0300-\\u036f]/g, '')
            .toLowerCase()
            .replace(/^city of\\s+/i, '')
            .replace(/\\s+city\\s*$/i, '')
            .replace(/[-\\u2013\\u2014]+/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim();
        }

        function reverseRing(ring) {
          return ring.slice().reverse();
        }

        /* World polygon with each LGU exterior as a hole, so OSM outside Cavite is covered. */
        function buildMask(featureCollection) {
          var worldRing = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
          var holes = [];
          (featureCollection.features || []).forEach(function (feature) {
            var geometry = feature && feature.geometry;
            if (!geometry) return;
            if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
              holes.push(reverseRing(geometry.coordinates[0]));
            } else if (geometry.type === 'MultiPolygon') {
              (geometry.coordinates || []).forEach(function (polygon) {
                if (polygon && polygon[0]) holes.push(reverseRing(polygon[0]));
              });
            }
          });
          return {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [worldRing].concat(holes) }
          };
        }

        var maskLayer = L.geoJSON(buildMask(geo), {
          style: { stroke: false, fillColor: '${MASK_FILL}', fillOpacity: 1, interactive: false }
        }).addTo(map);

        var counts = {};

        function countFor(name, fold) {
          var key = fold || foldName(name);
          if (counts[key] != null) return counts[key];
          for (var other in counts) {
            if (!Object.prototype.hasOwnProperty.call(counts, other)) continue;
            if (other === key || other.indexOf(key) >= 0 || key.indexOf(other) >= 0) {
              return counts[other];
            }
          }
          return 0;
        }

        function featureStyle(feature) {
          var props = (feature && feature.properties) || {};
          var n = countFor(props.name, props.fold);
          var active = n > 0;
          return {
            color: active ? '${VISITED_STROKE}' : '${IDLE_STROKE}',
            weight: active ? 1.5 : 1,
            opacity: 1,
            fillColor: active ? '${VISITED_FILL}' : '${IDLE_FILL}',
            fillOpacity: active ? 0.72 : 0.35
          };
        }

        var lguLayer = L.geoJSON(geo, {
          style: featureStyle,
          onEachFeature: function (feature, layer) {
            var props = (feature && feature.properties) || {};
            var name = props.name || 'Place';
            layer.on('click', function (ev) {
              L.DomEvent.stopPropagation(ev);
              var n = countFor(props.name, props.fold);
              postToHost({ type: 'lguPress', name: name, count: n });
            });
          }
        }).addTo(map);

        /* Mask sits above the LGU layer so province edges stay clean, as on web. */
        maskLayer.bringToFront();

        map.on('click', function () {
          postToHost({ type: 'lguPressEnd' });
        });

        var bounds = lguLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.02), { animate: false });

        window.__cavitourUpdateChoropleth = function (payload) {
          try {
            counts = (payload && payload.counts) || {};
            lguLayer.setStyle(featureStyle);
          } catch (e) {
            if (window.__cavitourDiag) {
              window.__cavitourDiag('error', 'choropleth update failed: ' + (e && e.stack ? e.stack : e));
            }
          }
        };

        postToHost({ type: 'mapReady' });
      } catch (initError) {
        if (window.__cavitourDiag) {
          window.__cavitourDiag('error', 'choropleth init failed: ' + (initError && initError.stack ? initError.stack : initError));
        }
        postToHost({
          type: 'mapInitFailed',
          message: String(initError && initError.message ? initError.message : initError)
        });
      }
    })();
  <\/script>
</body>
</html>`;
}

export function choroplethInjectUpdateScript(counts: Record<string, number>): string {
  return `window.__cavitourUpdateChoropleth(${JSON.stringify({ counts })}); true;`;
}
