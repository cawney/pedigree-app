use std::path::Path;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

pub async fn connect(data_dir: &Path) -> anyhow::Result<SqlitePool> {
    tokio::fs::create_dir_all(data_dir).await?;
    let options = SqliteConnectOptions::new()
        .filename(data_dir.join("pedigree.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new().connect_with(options).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Catalog {
    pub id: String,
    pub title: String,
    pub sale_company: Option<String>,
    pub sale_date: Option<NaiveDate>,
    pub source_url: Option<String>,
    pub sha256: String,
    pub size_bytes: i64,
    pub page_count: Option<i64>,
    /// Shown in the shared "Available catalogs" list.
    pub listed: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn get(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Catalog>> {
    sqlx::query_as("SELECT * FROM catalogs WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_sha(pool: &SqlitePool, sha256: &str) -> sqlx::Result<Option<Catalog>> {
    sqlx::query_as("SELECT * FROM catalogs WHERE sha256 = ?")
        .bind(sha256)
        .fetch_optional(pool)
        .await
}

/// Insert a catalog. If one with the same file hash already exists (e.g. two
/// people added the same URL at once), the existing row is returned instead.
pub async fn insert(pool: &SqlitePool, c: &Catalog) -> sqlx::Result<Catalog> {
    sqlx::query(
        "INSERT INTO catalogs
           (id, title, sale_company, sale_date, source_url, sha256, size_bytes, page_count, listed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (sha256) DO NOTHING",
    )
    .bind(&c.id)
    .bind(&c.title)
    .bind(&c.sale_company)
    .bind(c.sale_date)
    .bind(&c.source_url)
    .bind(&c.sha256)
    .bind(c.size_bytes)
    .bind(c.page_count)
    .bind(c.listed)
    .bind(c.created_at)
    .execute(pool)
    .await?;
    find_by_sha(pool, &c.sha256)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

#[derive(Debug, Default)]
pub struct ListFilter {
    pub company: Option<String>,
    pub year: Option<i32>,
    /// Include unlisted catalogs (admin only).
    pub include_unlisted: bool,
}

pub async fn list(pool: &SqlitePool, f: &ListFilter) -> sqlx::Result<Vec<Catalog>> {
    let year = f.year.map(|y| format!("{y:04}"));
    sqlx::query_as(
        "SELECT * FROM catalogs
         WHERE (? OR listed)
           AND (? IS NULL OR sale_company = ? COLLATE NOCASE)
           AND (? IS NULL OR strftime('%Y', sale_date) = ?)
         ORDER BY sale_date IS NULL, sale_date DESC, created_at DESC",
    )
    .bind(f.include_unlisted)
    .bind(&f.company)
    .bind(&f.company)
    .bind(&year)
    .bind(&year)
    .fetch_all(pool)
    .await
}

/// Fields an admin can change after a catalog is stored. `None` leaves the
/// field unchanged.
#[derive(Debug, Default)]
pub struct CatalogEdit {
    pub title: Option<String>,
    pub sale_company: Option<String>,
    pub sale_date: Option<NaiveDate>,
    pub listed: Option<bool>,
}

pub async fn edit(pool: &SqlitePool, id: &str, e: &CatalogEdit) -> sqlx::Result<Option<Catalog>> {
    sqlx::query(
        "UPDATE catalogs SET
           title        = COALESCE(?, title),
           sale_company = COALESCE(?, sale_company),
           sale_date    = COALESCE(?, sale_date),
           listed       = COALESCE(?, listed)
         WHERE id = ?",
    )
    .bind(&e.title)
    .bind(&e.sale_company)
    .bind(e.sale_date)
    .bind(e.listed)
    .bind(id)
    .execute(pool)
    .await?;
    get(pool, id).await
}
