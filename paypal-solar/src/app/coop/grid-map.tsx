"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { FeatureCollection } from "geojson";
import "leaflet/dist/leaflet.css";
import type { HouseStatus, HouseTone } from "../../lib/coop/house-status";
import { OUTLIER_RULE } from "../../lib/coop/house-status";
import gridArea from "../../data/grid-area-frankfurt.json";
import { HOUSE_SLOTS, POOL_POINT } from "./map-layout";
import { TONE } from "./tone";
import styles from "./workbench.module.css";

/** One household on the map. `tone: "none"` = not calculated yet (rehearsal preview). */
export interface MapHouse {
  key: string;
  name: string;
  role: "producer" | "consumer";
  tone: HouseTone | "none";
  reason: string;
  outlier: boolean;
  outlierReason?: string;
}

export const toMapHouses = (statuses: HouseStatus[]): MapHouse[] =>
  statuses.map((h) => ({
    key: h.draftId,
    name: h.name,
    role: h.kind === "payout" ? "producer" : "consumer",
    tone: h.tone,
    reason: h.reason,
    outlier: h.outlier,
    outlierReason: h.outlierReason,
  }));

/** Accessible name of a household marker. */
export const houseLabel = (h: MapHouse) =>
  `${h.name} · ${h.role} · ${TONE[h.tone].label}: ${h.reason}${h.outlier ? `. Outlier: ${h.outlierReason}` : ""}`;

const NRM_LABEL =
  "NRM grid area (approximation from Mainova price sheet 01.05.2024: Frankfurt without Höchst, Nied, Sindlingen, Sossenheim, Unterliederbach, Zeilsheim) · not an official balancing-area boundary";
const SYNA_LABEL = "Syna GmbH area (Nied, Sossenheim: transfer to NRM agreed, date not confirmed)";

/** Spread producers evenly over the slots so sharing lines cross the neighbourhood. */
function arrange(houses: MapHouse[]): MapHouse[] {
  const producers = houses.filter((h) => h.role === "producer");
  const consumers = houses.filter((h) => h.role === "consumer");
  const n = houses.length;
  const slots = new Set(producers.map((_, k) => Math.round(((k + 0.5) * n) / producers.length - 0.5)));
  const out: MapHouse[] = [];
  let p = 0;
  let c = 0;
  for (let i = 0; i < n; i++) out.push(slots.has(i) && p < producers.length ? producers[p++] : (consumers[c++] ?? producers[p++]));
  return out;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function iconHtml(h: MapHouse, selected: boolean) {
  const t = TONE[h.tone];
  return `<span class="${styles.pin}${selected ? ` ${styles.pinSelected}` : ""}${h.outlier ? ` ${styles.pinOutlier}` : ""}" style="--fill:${t.fill};--stroke:${t.stroke}">
    <span class="${styles.pinHouse}"></span>
    ${h.role === "producer" ? `<span class="${styles.pinSun}" title="PV"></span>` : ""}
    ${h.outlier ? `<span class="${styles.pinBang}">!</span>` : ""}
    <span class="${styles.pinName}">${escape(h.name)}</span>
  </span>`;
}

export default function GridMap({ houses, selected, onSelect }: {
  houses: MapHouse[];
  selected?: string;
  onSelect?: (key: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layers = useRef<Leaflet.LayerGroup | null>(null);
  const bounds = useRef<{ houses: Leaflet.LatLngBounds; area: Leaflet.LatLngBounds } | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"houses" | "area">("houses");

  // Leaflet needs `window`, so it is loaded only in the browser.
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !box.current) return;
      const lf = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as typeof Leaflet);
      const m = lf.map(box.current, { scrollWheelZoom: false, zoomSnap: 0.5 });
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      const area = lf.geoJSON(gridArea as FeatureCollection, {
        style: (f) =>
          f?.properties?.id === "syna"
            ? { color: "#6f8290", weight: 1.5, dashArray: "4 4", fillColor: "#8a9ba6", fillOpacity: 0.35 }
            : { color: "#0068db", weight: 2, fillColor: "#0068db", fillOpacity: 0.05 },
        onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.id === "syna" ? SYNA_LABEL : NRM_LABEL, { sticky: true }),
      }).addTo(m);
      layers.current = lf.layerGroup().addTo(m);
      bounds.current = { houses: lf.latLngBounds([...HOUSE_SLOTS, POOL_POINT]), area: area.getBounds() };
      m.fitBounds(bounds.current.houses, { padding: [36, 36] });
      L.current = lf;
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const lf = L.current;
    const group = layers.current;
    if (!ready || !lf || !group) return;
    group.clearLayers();
    const placed = arrange(houses).map((h, i) => ({ h, at: HOUSE_SLOTS[i % HOUSE_SLOTS.length] }));
    for (const { h, at } of placed)
      lf.polyline([at, POOL_POINT], h.role === "producer"
        ? { color: "#d39a00", weight: 3, opacity: 0.85, interactive: false }
        : { color: "#5f8aa3", weight: 1.5, dashArray: "4 4", opacity: 0.85, interactive: false }).addTo(group);
    lf.circleMarker(POOL_POINT, { radius: 7, color: "#d39a00", weight: 2.5, fillColor: "#fff", fillOpacity: 1 })
      .bindTooltip("Shared pool · drawn point, the split is by allocation key")
      .addTo(group);
    for (const { h, at } of placed) {
      const marker = lf
        .marker(at, {
          icon: lf.divIcon({ className: styles.pinWrap, html: iconHtml(h, h.key === selected), iconSize: [34, 34], iconAnchor: [17, 17] }),
          keyboard: true,
          riseOnHover: true,
          zIndexOffset: h.key === selected ? 1000 : 0,
        })
        .bindTooltip(`${h.name} · ${h.reason}`, { direction: "top", offset: [0, -16] })
        .on("click", () => select.current?.(h.key))
        .addTo(group);
      const el = marker.getElement();
      if (el) {
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", houseLabel(h));
        el.setAttribute("aria-pressed", String(h.key === selected));
        // Leaflet makes the icon focusable (keyboard: true) but only opens popups on Enter.
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select.current?.(h.key);
          }
        });
      }
    }
  }, [ready, houses, selected]);

  function show(next: "houses" | "area") {
    if (!map.current || !bounds.current) return;
    map.current.fitBounds(bounds.current[next], { padding: next === "houses" ? [36, 36] : [12, 12] });
    setView(next);
  }

  return (
    <div className={styles.mapWrap}>
      <div className={styles.mapFrame}>
        <div ref={box} className={styles.leaflet} role="region" aria-label="Map of the grid area with fictional households" />
        <button className={styles.mapToggle} disabled={!ready} onClick={() => show(view === "houses" ? "area" : "houses")}>
          {view === "houses" ? "Show whole grid area" : "Show households"}
        </button>
      </div>
      <ul className={styles.legend} aria-label="Map legend">
        {(["green", "amber", "red"] as const).map((t) => (
          <li key={t}>
            <i style={{ background: TONE[t].fill, borderColor: TONE[t].stroke }} />
            {t === "green" ? "Reconciled / matched" : t === "amber" ? "Pending / awaiting" : "Settlement problem"}
          </li>
        ))}
        {houses.some((h) => h.tone === "none") && (
          <li>
            <i style={{ background: TONE.none.fill, borderColor: TONE.none.stroke }} />
            Not calculated yet
          </li>
        )}
        <li>
          <i className={styles.legendOutlier} />
          Outlier <b className={styles.bang}>!</b>
        </li>
        <li>
          <i className={styles.legendSun} />
          Producer (PV) · shares via the pool
        </li>
        <li>
          <i className={styles.legendNrm} />
          NRM grid area (approximation, not an official boundary)
        </li>
        <li>
          <i className={styles.legendSyna} />
          Syna GmbH area
        </li>
      </ul>
      <p className={styles.mapCaption}>
        Fictional households · illustrative positions, not real addresses. § 42c EnWG Abs. 4: sharing within one
        distribution operator&apos;s balancing area (from 1 June 2026); from 1 June 2028 also a directly adjacent
        operator&apos;s area in the same control zone.{" "}
        <a href="https://www.gesetze-im-internet.de/enwg_2005/__42c.html" target="_blank" rel="noreferrer">Source</a>
      </p>
      <details className={styles.fold}>
        <summary>ⓘ How colours, outliers and the map work</summary>
        <p>
          Green: reconciled, amount and reference matched. Amber: pending or awaiting (draft, approval, execution or a
          provider check). Red: a settlement problem (open customer case, reconciliation mismatch, rejected or failed,
          or an out-of-date investigation). Colours are computed in code from the saved records.
        </p>
        <p>{OUTLIER_RULE}</p>
        <p>Click a house or a bar to open its statement.</p>
        <p>
          Blue outline: {NRM_LABEL}. Source sentence:{" "}
          <a href="https://mainova.de/resource/blob/137504/ae75493a6122c1c4ceedb1a9b5b481fc/preisblatt-bsv-01-05-2024-data.pdf" target="_blank" rel="noreferrer">
            Mainova price sheet
          </a>
          . Grey: {SYNA_LABEL};{" "}
          <a href="https://mainova.de/resource/blob/147230/c2bb9581986a66d2383323a980339cd7/20250214-pm-mainova-suewag-kooperation-data.pdf" target="_blank" rel="noreferrer">
            Mainova/Süwag press release, 14 Feb 2025
          </a>
          . No other operators are drawn.
        </p>
        <p>
          Households are fictional and placed on street centre lines in Frankfurt-Bornheim; the pool is a drawn point.
          The real allocation is a pool split by key, not a physical line. Boundaries: © OpenStreetMap contributors,
          ODbL 1.0 (OSM relation 62400 minus six district relations, simplified). Map tiles: OpenStreetMap, loaded
          only for the visible view.
        </p>
      </details>
    </div>
  );
}
