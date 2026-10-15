//! Pedigree catalog server: downloads sale catalog PDFs once, stores them,
//! and serves them to the app.

pub mod api;
pub mod catalogs;
pub mod config;
pub mod db;
pub mod error;
pub mod fetch;
pub mod pdf;
pub mod storage;

use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::Semaphore;

use crate::config::Config;
use crate::storage::Storage;

/// How many catalog downloads may run at once.
const MAX_CONCURRENT_FETCHES: usize = 4;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pool: SqlitePool,
    pub storage: Arc<Storage>,
    pub fetch_permits: Arc<Semaphore>,
}

impl AppState {
    pub async fn init(config: Config) -> anyhow::Result<Self> {
        let storage = Storage::open(&config.data_dir).await?;
        let pool = db::connect(&config.data_dir).await?;
        Ok(Self {
            config: Arc::new(config),
            pool,
            storage: Arc::new(storage),
            fetch_permits: Arc::new(Semaphore::new(MAX_CONCURRENT_FETCHES)),
        })
    }
}
