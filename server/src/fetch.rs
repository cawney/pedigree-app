//! Safe PDF downloader.
//!
//! URLs come from users, so every hop (including redirects) is checked:
//! only http/https, only public IP addresses (no localhost or internal
//! networks), a size cap, and timeouts. The connection is pinned to the
//! addresses we checked so DNS can't be switched underneath us.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use url::Url;

const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str = concat!("PedigreeApp/", env!("CARGO_PKG_VERSION"), " (catalog fetcher)");
/// The PDF spec allows the `%PDF-` header anywhere in the first 1024 bytes.
const PDF_HEADER_WINDOW: usize = 1024;

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error("that doesn't look like a valid web address")]
    InvalidUrl,
    #[error("only http and https links are supported")]
    UnsupportedScheme,
    #[error("that address points to a private or internal network")]
    BlockedAddress,
    #[error("couldn't find the website: {0}")]
    Resolve(String),
    #[error("the link redirected too many times")]
    TooManyRedirects,
    #[error("the website answered with HTTP {0}")]
    Status(u16),
    #[error("the file is larger than the {max_mb} MB limit")]
    TooLarge { max_mb: u64 },
    #[error("the link didn't return a PDF")]
    NotPdf,
    #[error("download failed: {0}")]
    Network(String),
    #[error("couldn't save the download: {0}")]
    Io(#[from] std::io::Error),
}

impl From<reqwest::Error> for FetchError {
    fn from(e: reqwest::Error) -> Self {
        FetchError::Network(e.to_string())
    }
}

/// A PDF saved to a temp file. The file is deleted on drop unless
/// [`Downloaded::keep`] is called.
#[derive(Debug)]
pub struct Downloaded {
    pub tmp_path: PathBuf,
    pub sha256: String,
    pub size: u64,
    /// Where it was downloaded from (after redirects), if from the web.
    pub source_url: Option<Url>,
    /// A readable title guessed from the file name, e.g.
    /// `2026-September-Yearling-Book1.pdf` → "2026 September Yearling Book1".
    pub title_hint: Option<String>,
    keep: bool,
}

impl Downloaded {
    /// Stop the temp file from being deleted (it has been moved elsewhere).
    pub fn keep(mut self) -> PathBuf {
        self.keep = true;
        self.tmp_path.clone()
    }

    /// Copy a PDF from local disk into `tmp_dir`, with the same checks as a
    /// download. Used by the admin tool.
    pub async fn from_local_file(src: &Path, tmp_dir: &Path, max_bytes: u64) -> Result<Self, FetchError> {
        use tokio::io::AsyncReadExt;

        let mut file = tokio::fs::File::open(src).await?;
        let mut writer = PdfWriter::create(tmp_dir, max_bytes).await?;
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            writer.write(&buf[..n]).await?;
        }
        let title_hint = src.file_name().and_then(|n| title_from_file_name(&n.to_string_lossy()));
        writer.finish(None, title_hint).await
    }
}

impl Drop for Downloaded {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_file(&self.tmp_path);
        }
    }
}

/// Streams bytes to a temp file while hashing, enforcing the size cap and
/// checking the PDF header. The temp file is removed if this is dropped
/// before `finish`.
struct PdfWriter {
    out: Downloaded,
    file: tokio::fs::File,
    hasher: Sha256,
    head: Vec<u8>,
    header_checked: bool,
    max_bytes: u64,
}

impl PdfWriter {
    async fn create(tmp_dir: &Path, max_bytes: u64) -> Result<Self, FetchError> {
        let tmp_path = tmp_dir.join(format!("{}.part", uuid::Uuid::new_v4()));
        let file = tokio::fs::File::create(&tmp_path).await?;
        Ok(Self {
            out: Downloaded {
                tmp_path,
                sha256: String::new(),
                size: 0,
                source_url: None,
                title_hint: None,
                keep: false,
            },
            file,
            hasher: Sha256::new(),
            head: Vec::with_capacity(PDF_HEADER_WINDOW),
            header_checked: false,
            max_bytes,
        })
    }

    fn too_large(&self) -> FetchError {
        FetchError::TooLarge {
            max_mb: self.max_bytes / (1024 * 1024),
        }
    }

    async fn write(&mut self, chunk: &[u8]) -> Result<(), FetchError> {
        self.out.size += chunk.len() as u64;
        if self.out.size > self.max_bytes {
            return Err(self.too_large());
        }
        if !self.header_checked {
            let take = (PDF_HEADER_WINDOW - self.head.len()).min(chunk.len());
            self.head.extend_from_slice(&chunk[..take]);
            if self.head.len() == PDF_HEADER_WINDOW {
                if !has_pdf_header(&self.head) {
                    return Err(FetchError::NotPdf);
                }
                self.header_checked = true;
            }
        }
        self.hasher.update(chunk);
        self.file.write_all(chunk).await?;
        Ok(())
    }

    async fn finish(mut self, source_url: Option<Url>, title_hint: Option<String>) -> Result<Downloaded, FetchError> {
        if !self.header_checked && !has_pdf_header(&self.head) {
            return Err(FetchError::NotPdf);
        }
        self.file.flush().await?;
        self.file.sync_all().await?;
        self.out.sha256 = hex::encode(self.hasher.finalize());
        self.out.source_url = source_url;
        self.out.title_hint = title_hint;
        Ok(self.out)
    }
}

pub async fn download_pdf(raw_url: &str, tmp_dir: &Path, max_bytes: u64) -> Result<Downloaded, FetchError> {
    let mut url = Url::parse(raw_url.trim()).map_err(|_| FetchError::InvalidUrl)?;

    for _ in 0..=MAX_REDIRECTS {
        let client = pinned_client(&url).await?;
        let resp = client.get(url.clone()).send().await?;

        if resp.status().is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or(FetchError::Status(resp.status().as_u16()))?;
            url = url.join(location).map_err(|_| FetchError::InvalidUrl)?;
            continue;
        }
        if !resp.status().is_success() {
            return Err(FetchError::Status(resp.status().as_u16()));
        }
        return save_body(resp, url, tmp_dir, max_bytes).await;
    }
    Err(FetchError::TooManyRedirects)
}

/// Build a client that can only connect to `url`'s host at addresses we have
/// verified are public.
async fn pinned_client(url: &Url) -> Result<reqwest::Client, FetchError> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(FetchError::UnsupportedScheme);
    }
    let host = url.host_str().ok_or(FetchError::InvalidUrl)?;
    let port = url.port_or_known_default().ok_or(FetchError::InvalidUrl)?;

    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .user_agent(USER_AGENT);

    match url.host() {
        Some(url::Host::Ipv4(ip)) => check_ip(IpAddr::V4(ip))?,
        Some(url::Host::Ipv6(ip)) => check_ip(IpAddr::V6(ip))?,
        Some(url::Host::Domain(domain)) => {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((domain, port))
                .await
                .map_err(|e| FetchError::Resolve(e.to_string()))?
                .collect();
            if addrs.is_empty() {
                return Err(FetchError::Resolve(format!("no addresses for {host}")));
            }
            for addr in &addrs {
                check_ip(addr.ip())?;
            }
            builder = builder.resolve_to_addrs(domain, &addrs);
        }
        None => return Err(FetchError::InvalidUrl),
    }
    builder.build().map_err(FetchError::from)
}

async fn save_body(
    resp: reqwest::Response,
    final_url: Url,
    tmp_dir: &Path,
    max_bytes: u64,
) -> Result<Downloaded, FetchError> {
    if resp.content_length().is_some_and(|len| len > max_bytes) {
        return Err(FetchError::TooLarge {
            max_mb: max_bytes / (1024 * 1024),
        });
    }
    let mut writer = PdfWriter::create(tmp_dir, max_bytes).await?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        writer.write(&chunk?).await?;
    }
    let title_hint = title_from_url(&final_url);
    writer.finish(Some(final_url), title_hint).await
}

pub fn has_pdf_header(bytes: &[u8]) -> bool {
    bytes.windows(5).any(|w| w == b"%PDF-")
}

pub fn title_from_url(url: &Url) -> Option<String> {
    let name = url.path_segments()?.next_back()?;
    title_from_file_name(&percent_encoding::percent_decode_str(name).decode_utf8_lossy())
}

pub fn title_from_file_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".pdf").or_else(|| name.strip_suffix(".PDF")).unwrap_or(name);
    let title = stem.replace(['-', '_', '+'], " ");
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    (!title.is_empty()).then_some(title)
}

fn check_ip(ip: IpAddr) -> Result<(), FetchError> {
    if is_public(ip) {
        Ok(())
    } else {
        Err(FetchError::BlockedAddress)
    }
}

/// True if `ip` is a normal internet address (not loopback, private,
/// link-local, carrier NAT, multicast, documentation, etc.).
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b)) // carrier-grade NAT
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || (a == 198 && (b == 18 || b == 19)) // benchmarking
        || a >= 240) // reserved
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let seg = ip.segments();
    // NAT64 (64:ff9b::/96) embeds an IPv4 address in the last 32 bits.
    if seg[0] == 0x64 && seg[1] == 0xff9b && seg[2..6] == [0, 0, 0, 0] {
        let v4 = Ipv4Addr::new((seg[6] >> 8) as u8, seg[6] as u8, (seg[7] >> 8) as u8, seg[7] as u8);
        return is_public_v4(v4);
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (seg[0] & 0xfe00) == 0xfc00 // unique local
        || (seg[0] & 0xffc0) == 0xfe80 // link local
        || (seg[0] == 0x2001 && seg[1] == 0x0db8)) // documentation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_internal_addresses() {
        for ip in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
            "0.0.0.0", "255.255.255.255", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1",
            "64:ff9b::a00:1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip} should be blocked");
        }
    }

    #[test]
    fn allows_public_addresses() {
        for ip in ["8.8.8.8", "151.101.1.69", "2606:4700::6810:85e5", "::ffff:8.8.8.8"] {
            assert!(is_public(ip.parse().unwrap()), "{ip} should be allowed");
        }
    }

    #[tokio::test]
    async fn rejects_bad_urls() {
        let dir = tempfile::tempdir().unwrap();
        let max = 10 * 1024 * 1024;
        assert!(matches!(download_pdf("not a url", dir.path(), max).await, Err(FetchError::InvalidUrl)));
        assert!(matches!(
            download_pdf("file:///etc/passwd", dir.path(), max).await,
            Err(FetchError::UnsupportedScheme)
        ));
        assert!(matches!(
            download_pdf("http://127.0.0.1/x.pdf", dir.path(), max).await,
            Err(FetchError::BlockedAddress)
        ));
        assert!(matches!(
            download_pdf("http://localhost:8080/x.pdf", dir.path(), max).await,
            Err(FetchError::BlockedAddress)
        ));
    }

    #[test]
    fn detects_pdf_header() {
        assert!(has_pdf_header(b"%PDF-1.7\n..."));
        assert!(has_pdf_header(b"\xef\xbb\xbf  %PDF-1.4"));
        assert!(!has_pdf_header(b"<!DOCTYPE html><html>"));
    }

    #[test]
    fn titles_from_urls() {
        let t = |u: &str| title_from_url(&Url::parse(u).unwrap());
        assert_eq!(
            t("https://example.com/catalogs/2026-September_Yearling%20Book1.pdf").as_deref(),
            Some("2026 September Yearling Book1")
        );
        assert_eq!(t("https://example.com/").as_deref(), None);
    }
}
