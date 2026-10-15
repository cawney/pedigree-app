use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeFile;
use tower_http::trace::TraceLayer;

use crate::catalogs::{self, NewCatalog};
use crate::db::{self, Catalog, ListFilter};
use crate::error::AppError;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/catalogs", get(list_catalogs))
        .route("/catalogs/fetch", post(fetch_catalog))
        .route("/catalogs/{id}", get(get_catalog))
        .route("/catalogs/{id}/file", get(catalog_file))
        // Public, read-mostly API with no cookies, so any origin (web app,
        // Capacitor's capacitor://localhost, dev server) may call it.
        .layer(CorsLayer::permissive().expose_headers([
            header::CONTENT_LENGTH,
            header::CONTENT_RANGE,
            header::ACCEPT_RANGES,
        ]))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    company: Option<String>,
    year: Option<i32>,
}

/// The shared "Available catalogs" list.
async fn list_catalogs(State(state): State<AppState>, Query(q): Query<ListQuery>) -> Result<Json<Vec<Catalog>>, AppError> {
    let filter = ListFilter {
        company: q.company.filter(|c| !c.is_empty()),
        year: q.year,
        include_unlisted: false,
    };
    Ok(Json(db::list(&state.pool, &filter).await?))
}

async fn get_catalog(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Catalog>, AppError> {
    db::get(&state.pool, &id).await?.map(Json).ok_or(AppError::NotFound)
}

#[derive(Debug, Deserialize)]
struct FetchBody {
    url: String,
    title: Option<String>,
}

/// Download a catalog from a link the user pasted. Stored unlisted: the
/// person who added it gets its id back, but it doesn't appear in the
/// shared list until an admin lists it.
async fn fetch_catalog(State(state): State<AppState>, Json(body): Json<FetchBody>) -> Result<Response, AppError> {
    if body.url.trim().is_empty() {
        return Err(AppError::BadRequest("a url is required".into()));
    }
    let meta = NewCatalog {
        title: body.title,
        ..Default::default()
    };
    let ingested = catalogs::ingest_url(&state, &body.url, meta).await?;
    let status = if ingested.created { StatusCode::CREATED } else { StatusCode::OK };
    Ok((status, Json(ingested.catalog)).into_response())
}

/// The PDF itself. Supports range requests so the viewer can open large
/// catalogs without downloading the whole file first.
async fn catalog_file(State(state): State<AppState>, Path(id): Path<String>, req: Request) -> Result<Response, AppError> {
    let (catalog, path) = catalogs::file_path(&state, &id).await?;
    let mut res = ServeFile::new_with_mime(path, &"application/pdf".parse().unwrap())
        .oneshot(req)
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .into_response();

    let headers = res.headers_mut();
    // Content-addressed: a catalog id always serves the same bytes.
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    if let Ok(v) = HeaderValue::from_str(&format!("inline; filename=\"{}.pdf\"", safe_file_name(&catalog.title))) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(res)
}

fn safe_file_name(title: &str) -> String {
    let name: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || " -_.".contains(c) { c } else { '_' })
        .collect();
    let name = name.trim();
    if name.is_empty() { "catalog".into() } else { name.into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::fetch::Downloaded;
    use crate::pdf::tests::sample_pdf;
    use axum::body::Body;
    use http_body_util::BodyExt;

    async fn test_state(dir: &std::path::Path) -> AppState {
        AppState::init(Config {
            data_dir: dir.to_owned(),
            bind: "127.0.0.1:0".parse().unwrap(),
            max_pdf_bytes: 10 * 1024 * 1024,
        })
        .await
        .unwrap()
    }

    async fn add(state: &AppState, pdf: &[u8], name: &str, meta: NewCatalog) -> catalogs::Ingested {
        let src = state.config.data_dir.join(name);
        std::fs::write(&src, pdf).unwrap();
        let dl = Downloaded::from_local_file(&src, state.storage.tmp_dir(), state.config.max_pdf_bytes)
            .await
            .unwrap();
        catalogs::ingest_download(state, dl, meta).await.unwrap()
    }

    async fn call(state: &AppState, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
        let res = router(state.clone()).oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        (status, headers, body)
    }

    #[tokio::test]
    async fn stores_each_file_once_and_lists_only_listed() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path()).await;
        let pdf = sample_pdf(4, "");

        let first = add(&state, &pdf, "Keeneland-September-Book1.pdf", NewCatalog::default()).await;
        assert!(first.created);
        assert_eq!(first.catalog.title, "Keeneland September Book1");
        assert_eq!(first.catalog.page_count, Some(4));
        assert!(!first.catalog.listed);

        // Unlisted catalogs don't show in the shared list.
        let (status, _, body) = call(&state, Request::get("/catalogs").body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(serde_json::from_slice::<Vec<Catalog>>(&body).unwrap().len(), 0);

        // Adding the same bytes again (as an admin) reuses the stored copy and lists it.
        let listed = NewCatalog { listed: true, ..Default::default() };
        let second = add(&state, &pdf, "copy.pdf", listed).await;
        assert!(!second.created);
        assert_eq!(second.catalog.id, first.catalog.id);
        assert!(second.catalog.listed);
        let pdfs: Vec<_> = std::fs::read_dir(dir.path().join("pdfs")).unwrap().collect();
        assert_eq!(pdfs.len(), 1);
        assert_eq!(std::fs::read_dir(dir.path().join("tmp")).unwrap().count(), 0);

        let (_, _, body) = call(&state, Request::get("/catalogs").body(Body::empty()).unwrap()).await;
        assert_eq!(serde_json::from_slice::<Vec<Catalog>>(&body).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn filters_by_company_and_year() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path()).await;
        for (i, (company, date)) in [("Keeneland", "2026-09-08"), ("Fasig-Tipton", "2026-08-10"), ("Keeneland", "2025-09-08")]
            .into_iter()
            .enumerate()
        {
            let meta = NewCatalog {
                sale_company: Some(company.into()),
                sale_date: Some(date.parse().unwrap()),
                listed: true,
                ..Default::default()
            };
            add(&state, &sample_pdf(i as u32 + 1, ""), &format!("{i}.pdf"), meta).await;
        }
        let get_len = |uri: &'static str| {
            let state = state.clone();
            async move {
                let (_, _, body) = call(&state, Request::get(uri).body(Body::empty()).unwrap()).await;
                serde_json::from_slice::<Vec<Catalog>>(&body).unwrap().len()
            }
        };
        assert_eq!(get_len("/catalogs").await, 3);
        assert_eq!(get_len("/catalogs?company=keeneland").await, 2);
        assert_eq!(get_len("/catalogs?company=Keeneland&year=2026").await, 1);
        assert_eq!(get_len("/catalogs?year=2025").await, 1);
    }

    #[tokio::test]
    async fn serves_pdf_with_ranges() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path()).await;
        let pdf = sample_pdf(2, "Fall Sale");
        let added = add(&state, &pdf, "x.pdf", NewCatalog::default()).await;
        let uri = format!("/catalogs/{}/file", added.catalog.id);

        let (status, headers, body) = call(&state, Request::get(&uri).body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(body, pdf);

        let req = Request::get(&uri).header(header::RANGE, "bytes=0-4").body(Body::empty()).unwrap();
        let (status, _, body) = call(&state, req).await;
        assert_eq!(status, StatusCode::PARTIAL_CONTENT);
        assert_eq!(body, b"%PDF-");

        let (status, _, _) = call(&state, Request::get("/catalogs/nope/file").body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn fetch_rejects_internal_urls() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path()).await;
        let req = Request::post("/catalogs/fetch")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"url":"http://169.254.169.254/latest/meta-data"}"#))
            .unwrap();
        let (status, _, body) = call(&state, req).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(String::from_utf8(body).unwrap().contains("private or internal"));
    }
}
