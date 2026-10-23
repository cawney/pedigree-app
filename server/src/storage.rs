//! PDF file storage on local disk, addressed by SHA-256 so each catalog is
//! stored once. Swapping in object storage (S3 etc.) later only touches this
//! module and the file route in `api.rs`.

use std::io;
use std::path::{Path, PathBuf};

pub struct Storage {
    pdf_dir: PathBuf,
    tmp_dir: PathBuf,
}

impl Storage {
    pub async fn open(data_dir: &Path) -> io::Result<Self> {
        let pdf_dir = data_dir.join("pdfs");
        let tmp_dir = data_dir.join("tmp");
        tokio::fs::create_dir_all(&pdf_dir).await?;
        tokio::fs::create_dir_all(&tmp_dir).await?;
        Ok(Self { pdf_dir, tmp_dir })
    }

    /// Directory for in-progress downloads. Same filesystem as the PDFs, so
    /// `put` is a cheap rename.
    pub fn tmp_dir(&self) -> &Path {
        &self.tmp_dir
    }

    pub fn path(&self, sha256: &str) -> PathBuf {
        self.pdf_dir.join(format!("{sha256}.pdf"))
    }

    /// Move a finished download into place. If the same file is already
    /// stored, the temp file is discarded.
    pub async fn put(&self, tmp: &Path, sha256: &str) -> io::Result<PathBuf> {
        let dest = self.path(sha256);
        if tokio::fs::try_exists(&dest).await? {
            tokio::fs::remove_file(tmp).await?;
        } else {
            tokio::fs::rename(tmp, &dest).await?;
        }
        Ok(dest)
    }
}
