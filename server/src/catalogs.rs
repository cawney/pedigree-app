//! Adding catalogs to the shared store.

use std::path::Path;

use chrono::{NaiveDate, Utc};

use crate::db::{self, Catalog, CatalogEdit};
use crate::error::AppError;
use crate::fetch::{self, Downloaded};
use crate::{pdf, AppState};

#[derive(Debug, Default, Clone)]
pub struct NewCatalog {
    pub title: Option<String>,
    pub sale_company: Option<String>,
    pub sale_date: Option<NaiveDate>,
    /// Show in the shared "Available catalogs" list. User-submitted links are
    /// unlisted; admins list catalogs.
    pub listed: bool,
}

pub struct Ingested {
    pub catalog: Catalog,
    /// False if this exact file was already stored.
    pub created: bool,
}

/// Download a PDF from `url` and add it to the store (or return the existing
/// catalog if the same file is already stored).
pub async fn ingest_url(state: &AppState, url: &str, meta: NewCatalog) -> Result<Ingested, AppError> {
    let _permit = state
        .fetch_permits
        .acquire()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    let download = fetch::download_pdf(url, state.storage.tmp_dir(), state.config.max_pdf_bytes).await?;
    ingest_download(state, download, meta).await
}

pub async fn ingest_download(state: &AppState, download: Downloaded, meta: NewCatalog) -> Result<Ingested, AppError> {
    if let Some(existing) = db::find_by_sha(&state.pool, &download.sha256).await? {
        // `download` is dropped here, which deletes the duplicate temp file.
        let catalog = if meta.listed && !existing.listed {
            let edit = CatalogEdit {
                listed: Some(true),
                ..Default::default()
            };
            db::edit(&state.pool, &existing.id, &edit).await?.unwrap_or(existing)
        } else {
            existing
        };
        return Ok(Ingested { catalog, created: false });
    }

    let title_hint = download.title_hint.clone();
    let source_url = download.source_url.as_ref().map(|u| u.to_string());
    let sha256 = download.sha256.clone();
    let size = download.size;
    let tmp = download.keep();
    let stored = state.storage.put(&tmp, &sha256).await?;
    let info = pdf::inspect(&stored).await;

    let catalog = Catalog {
        id: uuid::Uuid::new_v4().to_string(),
        title: meta
            .title
            .filter(|t| !t.trim().is_empty())
            .or(info.title)
            .or(title_hint)
            .unwrap_or_else(|| "Untitled catalog".into()),
        sale_company: meta.sale_company,
        sale_date: meta.sale_date,
        source_url,
        sha256,
        size_bytes: size as i64,
        page_count: info.page_count.map(i64::from),
        listed: meta.listed,
        created_at: Utc::now(),
    };
    let saved = db::insert(&state.pool, &catalog).await?;
    let created = saved.id == catalog.id;
    Ok(Ingested { catalog: saved, created })
}

/// Path of a catalog's stored PDF, if the catalog exists.
pub async fn file_path(state: &AppState, id: &str) -> Result<(Catalog, std::path::PathBuf), AppError> {
    let catalog = db::get(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let path = state.storage.path(&catalog.sha256);
    if !Path::new(&path).exists() {
        tracing::error!("catalog {id} is missing its file {}", path.display());
        return Err(AppError::NotFound);
    }
    Ok((catalog, path))
}
