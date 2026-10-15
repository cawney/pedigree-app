use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;

/// Server settings, read from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// Where the database and stored PDFs live. `PEDIGREE_DATA_DIR`, default `./data`.
    pub data_dir: PathBuf,
    /// Address to listen on. `PEDIGREE_BIND`, default `127.0.0.1:8080`.
    pub bind: SocketAddr,
    /// Largest PDF we will download. `PEDIGREE_MAX_PDF_MB`, default 600.
    pub max_pdf_bytes: u64,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let data_dir = std::env::var("PEDIGREE_DATA_DIR").unwrap_or_else(|_| "data".into());
        let bind = std::env::var("PEDIGREE_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8080".into())
            .parse()
            .context("PEDIGREE_BIND must be an address like 127.0.0.1:8080")?;
        let max_mb: u64 = std::env::var("PEDIGREE_MAX_PDF_MB")
            .unwrap_or_else(|_| "600".into())
            .parse()
            .context("PEDIGREE_MAX_PDF_MB must be a whole number")?;
        Ok(Self {
            data_dir: data_dir.into(),
            bind,
            max_pdf_bytes: max_mb * 1024 * 1024,
        })
    }
}
