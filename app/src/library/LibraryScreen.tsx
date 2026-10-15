import { useEffect, useMemo, useState } from "react";
import { listAvailable, type ServerCatalog } from "../api";
import { catalogSubtitle, formatBytes, percent } from "../format";
import { openCatalog } from "../router";
import { listItems, removeItem, subscribe, type LibraryItem } from "../store/library";
import { AddCatalogSheet } from "./AddCatalogSheet";
import { addFromServer } from "./addCatalog";

type Tab = "mine" | "available";

export function useLibraryItems(): LibraryItem[] | undefined {
  const [items, setItems] = useState<LibraryItem[]>();
  useEffect(() => {
    const load = () => void listItems().then(setItems);
    load();
    return subscribe(load);
  }, []);
  return items;
}

export function LibraryScreen() {
  const items = useLibraryItems();
  const [tab, setTab] = useState<Tab>("mine");
  const [adding, setAdding] = useState(false);

  return (
    <div className="screen library">
      <header className="topbar">
        <h1 className="brand">Pedigree</h1>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
            My Catalogs
          </button>
          <button role="tab" aria-selected={tab === "available"} onClick={() => setTab("available")}>
            Available
          </button>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Add
        </button>
      </header>

      <main className="library-body">
        {tab === "mine" ? (
          <MyCatalogs items={items} onAdd={() => setAdding(true)} />
        ) : (
          <AvailableCatalogs items={items ?? []} />
        )}
      </main>

      {adding && <AddCatalogSheet onClose={() => setAdding(false)} onAdded={(item) => openCatalog(item.id)} />}
    </div>
  );
}

function MyCatalogs({ items, onAdd }: { items: LibraryItem[] | undefined; onAdd: () => void }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items || !q) return items;
    return items.filter((i) => `${i.title} ${i.saleCompany ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  if (!items) return null;
  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>No catalogs yet</h2>
        <p>Add a sale catalog from a link, a PDF on this device, or the Available list. It stays on this device so it opens without internet.</p>
        <button className="btn primary large" onClick={onAdd}>
          Add a catalog
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        className="search"
        type="search"
        placeholder="Search catalogs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="catalog-grid">
        {shown?.map((item) => (
          <li key={item.id} className="catalog-card">
            <button className="card-main" onClick={() => openCatalog(item.id)}>
              <span className="card-title">{item.title}</span>
              <span className="card-sub">{catalogSubtitle(item)}</span>
              <span className="card-meta">
                {item.lastPage && item.lastPage > 1 ? `Continue at page ${item.lastPage}` : formatBytes(item.sizeBytes)}
              </span>
            </button>
            <button
              className="icon-btn danger"
              aria-label={`Remove ${item.title}`}
              title="Remove from this device"
              onClick={() => {
                if (confirm(`Remove “${item.title}” from this device?`)) void removeItem(item.id);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {shown?.length === 0 && <p className="hint">No catalogs match “{query}”.</p>}
    </>
  );
}

type DownloadState = { loaded: number; total?: number } | { error: string };

function AvailableCatalogs({ items }: { items: LibraryItem[] }) {
  const [catalogs, setCatalogs] = useState<ServerCatalog[]>();
  const [error, setError] = useState<string>();
  const [company, setCompany] = useState<string>();
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  const load = () => {
    setError(undefined);
    listAvailable()
      .then(setCatalogs)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const companies = useMemo(
    () => [...new Set(catalogs?.map((c) => c.sale_company).filter((c): c is string => !!c))].sort(),
    [catalogs],
  );
  const byServerId = useMemo(() => new Map(items.filter((i) => i.serverId).map((i) => [i.serverId!, i])), [items]);

  const download = async (cat: ServerCatalog) => {
    setDownloads((d) => ({ ...d, [cat.id]: { loaded: 0, total: cat.size_bytes } }));
    try {
      await addFromServer(cat, (loaded, total) =>
        setDownloads((d) => ({ ...d, [cat.id]: { loaded, total: total ?? cat.size_bytes } })),
      );
      setDownloads(({ [cat.id]: _, ...rest }) => rest);
    } catch (e) {
      setDownloads((d) => ({ ...d, [cat.id]: { error: (e as Error).message } }));
    }
  };

  if (error) {
    return (
      <div className="empty">
        <h2>Can’t load the catalog list</h2>
        <p>{error}</p>
        <p className="hint">Catalogs already in My Catalogs still work offline.</p>
        <button className="btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!catalogs) return <p className="hint">Loading catalogs…</p>;
  if (catalogs.length === 0) return <p className="hint">No sale catalogs are available yet.</p>;

  const shown = company ? catalogs.filter((c) => c.sale_company === company) : catalogs;
  return (
    <>
      {companies.length > 1 && (
        <div className="chips">
          <button className="chip" aria-pressed={!company} onClick={() => setCompany(undefined)}>
            All
          </button>
          {companies.map((c) => (
            <button key={c} className="chip" aria-pressed={company === c} onClick={() => setCompany(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <ul className="available-list">
        {shown.map((cat) => {
          const local = byServerId.get(cat.id);
          const dl = downloads[cat.id];
          return (
            <li key={cat.id} className="available-row">
              <div className="row-text">
                <span className="card-title">{cat.title}</span>
                <span className="card-sub">
                  {catalogSubtitle({
                    saleCompany: cat.sale_company ?? undefined,
                    saleDate: cat.sale_date ?? undefined,
                    pageCount: cat.page_count ?? undefined,
                  })}
                  {" · "}
                  {formatBytes(cat.size_bytes)}
                </span>
                {dl && "error" in dl && <span className="error-text">{dl.error}</span>}
              </div>
              {local ? (
                <button className="btn" onClick={() => openCatalog(local.id)}>
                  Open
                </button>
              ) : dl && "loaded" in dl ? (
                <span className="progress-label">{percent(dl.loaded, dl.total)}</span>
              ) : (
                <button className="btn primary" onClick={() => void download(cat)}>
                  {dl ? "Retry" : "Download"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
