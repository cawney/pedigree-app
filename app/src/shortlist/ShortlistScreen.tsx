import { useMemo, useState } from "react";
import { buildPagesPdf } from "../export/buildPdf";
import { shortlistCsv } from "../export/csv";
import { ExportSheet, type ExportChoice } from "../export/ExportSheet";
import { fileName } from "../export/share";
import { readPref, writePref } from "../prefs";
import { openCatalog } from "../router";
import { newId } from "../store/db";
import type { LibraryItem } from "../store/library";
import { allTags, EMPTY_FILTER, isFiltered, matches, sortEntries, type ShortlistFilter, type SmartFilter, type SortKey } from "./filters";
import { useEntries } from "./store";
import { hipLabel, PRESET_TAGS } from "./types";

const SMART_KEY = "pedigree.smartFilters";
const VIEW_KEY = "pedigree.shortlistView";

/** Ready-made smart filters. Users can save their own next to these. */
const BUILT_IN: SmartFilter[] = [
  { id: "top", name: "4★ and up", filter: { ...EMPTY_FILTER, minRating: 4 }, sort: "rating" },
  { id: "vet", name: "To vet", filter: { ...EMPTY_FILTER, tags: ["Vet"] }, sort: "catalog" },
  { id: "inspect", name: "To inspect", filter: { ...EMPTY_FILTER, tags: ["Inspect"] }, sort: "catalog" },
  { id: "bids", name: "Has bid limit", filter: { ...EMPTY_FILTER, onlyWithBidLimit: true }, sort: "catalog" },
];

const sameFilter = (a: ShortlistFilter, b: ShortlistFilter) => JSON.stringify(a) === JSON.stringify(b);

export function ShortlistScreen({ items }: { items: LibraryItem[] }) {
  const entries = useEntries();
  const [view, setViewState] = useState<{ filter: ShortlistFilter; sort: SortKey }>(() => ({
    filter: EMPTY_FILTER,
    sort: "catalog",
    ...readPref(VIEW_KEY, {}),
  }));
  const [saved, setSaved] = useState<SmartFilter[]>(() => readPref(SMART_KEY, []));
  const [sharing, setSharing] = useState(false);
  const { filter, sort } = view;

  const setView = (next: { filter: ShortlistFilter; sort: SortKey }) => {
    setViewState(next);
    writePref(VIEW_KEY, next);
  };
  const setFilter = (patch: Partial<ShortlistFilter>) => setView({ filter: { ...filter, ...patch }, sort });

  const titles = useMemo(() => new Map(items.map((i) => [i.id, i.title])), [items]);
  // Catalogs in sale order (newest sale first, then title), for grouping.
  const catalogOrder = useMemo(() => {
    const sorted = [...items].sort((a, b) => (b.saleDate ?? "").localeCompare(a.saleDate ?? "") || a.title.localeCompare(b.title));
    return new Map(sorted.map((i, n) => [i.id, n]));
  }, [items]);

  const known = useMemo(() => (entries ?? []).filter((e) => titles.has(e.itemId)), [entries, titles]);
  const shown = useMemo(() => sortEntries(known.filter((e) => matches(e, filter)), sort, catalogOrder), [known, filter, sort, catalogOrder]);
  const tags = allTags(known, PRESET_TAGS);
  const catalogsInList = items.filter((i) => known.some((e) => e.itemId === i.id));

  const saveCurrent = () => {
    const name = prompt("Name this smart filter", "")?.trim();
    if (!name) return;
    const next = [...saved, { id: newId(), name, filter, sort }];
    setSaved(next);
    writePref(SMART_KEY, next);
  };
  const deleteSaved = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    writePref(SMART_KEY, next);
  };

  if (!entries) return null;
  if (known.length === 0) {
    return (
      <div className="empty">
        <h2>Your short list is empty</h2>
        <p>Open a catalog and tap ☆ on a horse’s page. Add a rating, tags, a bid limit and notes, then find them all here.</p>
      </div>
    );
  }

  return (
    <div className="shortlist">
      <div className="smart-filters" aria-label="Smart filters">
        <button className="chip" aria-pressed={!isFiltered(filter)} onClick={() => setView({ filter: EMPTY_FILTER, sort })}>
          All ({known.length})
        </button>
        {[...BUILT_IN, ...saved].map((s) => (
          <span key={s.id} className="chip-wrap">
            <button className="chip" aria-pressed={sameFilter(filter, s.filter)} onClick={() => setView({ filter: s.filter, sort: s.sort })}>
              {s.name}
            </button>
            {!BUILT_IN.includes(s) && (
              <button className="chip-x" aria-label={`Delete smart filter ${s.name}`} onClick={() => deleteSaved(s.id)}>
                ✕
              </button>
            )}
          </span>
        ))}
        {isFiltered(filter) && ![...BUILT_IN, ...saved].some((s) => sameFilter(s.filter, filter)) && (
          <button className="chip add" onClick={saveCurrent}>
            + Save as smart filter
          </button>
        )}
      </div>

      <div className="filter-bar">
        <input
          className="search"
          type="search"
          placeholder="Search hip, notes, tags…"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
        />
        {catalogsInList.length > 1 && (
          <select aria-label="Catalog" value={filter.itemIds[0] ?? ""} onChange={(e) => setFilter({ itemIds: e.target.value ? [e.target.value] : [] })}>
            <option value="">All catalogs</option>
            {catalogsInList.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Rating" value={filter.minRating} onChange={(e) => setFilter({ minRating: Number(e.target.value) })}>
          <option value={0}>Any rating</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)} and up
            </option>
          ))}
          <option value={5}>★★★★★ only</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setView({ filter, sort: e.target.value as SortKey })}>
          <option value="catalog">By hip</option>
          <option value="rating">Best rated</option>
          <option value="recent">Recently changed</option>
        </select>
        <button className="btn primary" disabled={!shown.length} onClick={() => setSharing(true)}>
          Share {shown.length}
        </button>
      </div>

      <div className="chips tag-filter" aria-label="Filter by tag">
        {tags.map((t) => (
          <button
            key={t}
            className="chip small"
            aria-pressed={filter.tags.includes(t)}
            onClick={() => setFilter({ tags: filter.tags.includes(t) ? filter.tags.filter((x) => x !== t) : [...filter.tags, t] })}
          >
            {t}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="hint">
          No horses match.{" "}
          <button className="link" onClick={() => setView({ filter: EMPTY_FILTER, sort })}>
            Clear filters
          </button>
        </p>
      ) : (
        <ul className="hip-list">
          {shown.map((e) => (
            <li key={e.key}>
              <button className="hip-row" onClick={() => openCatalog(e.itemId, e.page)}>
                <span className="hip-row-main">
                  <strong className="hip-row-label">{hipLabel(e)}</strong>
                  <span className="card-sub">
                    {titles.get(e.itemId)}
                    {e.hip ? ` · page ${e.page}` : ""}
                  </span>
                  {e.note && <span className="hip-row-note">{e.note}</span>}
                </span>
                <span className="hip-row-side">
                  {e.rating > 0 && (
                    <span className="row-stars" aria-label={`${e.rating} stars`}>
                      {"★".repeat(e.rating)}
                    </span>
                  )}
                  {e.tags.length > 0 && (
                    <span className="row-tags">
                      {e.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                  {e.bidLimit && <span className="row-bid">≤ ${e.bidLimit.toLocaleString("en-US")}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {sharing && <ExportSheet title="Short list" choices={listChoices(shown, titles)} onClose={() => setSharing(false)} />}
    </div>
  );
}

function listChoices(entries: ReturnType<typeof sortEntries>, titles: Map<string, string>): ExportChoice[] {
  const name = `Short list ${new Date().toISOString().slice(0, 10)}`;
  return [
    {
      id: "pdf",
      label: "PDF of these horses",
      detail: `${entries.length} catalog ${entries.length === 1 ? "page" : "pages"}`,
      options: { markup: true, summary: true, bids: true },
      build: async (o) => ({
        name: fileName(name, "pdf"),
        type: "application/pdf",
        data: await buildPagesPdf(
          entries.map((e) => ({ itemId: e.itemId, page: e.page })),
          {
            includeMarkup: o.includeMarkup,
            onProgress: o.onProgress,
            summary: o.includeSummary ? { title: "Short list", entries, catalogTitles: titles, includeBids: o.includeBids } : undefined,
          },
        ),
      }),
    },
    {
      id: "csv",
      label: "Spreadsheet (CSV)",
      detail: "Opens in Excel, Numbers or Google Sheets",
      options: { bids: true },
      build: async (o) => ({
        name: fileName(name, "csv"),
        type: "text/csv",
        data: new Blob([shortlistCsv(entries, titles, o.includeBids)], { type: "text/csv" }),
      }),
    },
  ];
}
