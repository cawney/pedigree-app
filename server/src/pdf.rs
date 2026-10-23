//! Reading basic facts out of a stored PDF.

use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct PdfInfo {
    pub page_count: Option<u32>,
    pub title: Option<String>,
}

/// Read page count and embedded title. Some PDFs (e.g. encrypted ones) can't
/// be parsed here even though viewers open them fine, so failure is not fatal:
/// it just leaves the fields empty.
pub async fn inspect(path: &Path) -> PdfInfo {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || match lopdf::Document::load(&path) {
        Ok(doc) => PdfInfo {
            page_count: Some(doc.get_pages().len() as u32),
            title: info_title(&doc),
        },
        Err(e) => {
            tracing::warn!("couldn't inspect {}: {e}", path.display());
            PdfInfo::default()
        }
    })
    .await
    .unwrap_or_default()
}

fn info_title(doc: &lopdf::Document) -> Option<String> {
    let info = doc.trailer.get(b"Info").ok()?;
    let info = match info {
        lopdf::Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    let bytes = info.as_dict().ok()?.get(b"Title").ok()?.as_str().ok()?;
    let title = decode_pdf_text(bytes);
    let title = title.trim();
    (!title.is_empty()).then(|| title.to_string())
}

/// PDF text strings are UTF-16BE when they start with a byte-order mark,
/// otherwise (close enough to) Latin-1.
fn decode_pdf_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object, Stream};

    /// Build a small valid PDF with `pages` blank pages.
    pub fn sample_pdf(pages: u32, title: &str) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Stream::new(dictionary! {}, b"".to_vec()));
        let kids: Vec<Object> = (0..pages)
            .map(|_| {
                doc.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "Contents" => content_id,
                    "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                })
                .into()
            })
            .collect();
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => pages }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        let info_id = doc.add_object(dictionary! { "Title" => Object::string_literal(title) });
        doc.trailer.set("Root", catalog_id);
        doc.trailer.set("Info", info_id);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[tokio::test]
    async fn reads_pages_and_title() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.pdf");
        std::fs::write(&path, sample_pdf(3, "Fall Mixed Sale")).unwrap();
        let info = inspect(&path).await;
        assert_eq!(info.page_count, Some(3));
        assert_eq!(info.title.as_deref(), Some("Fall Mixed Sale"));
    }

    #[tokio::test]
    async fn unreadable_pdf_is_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.pdf");
        std::fs::write(&path, b"%PDF-1.4 garbage").unwrap();
        assert_eq!(inspect(&path).await, PdfInfo::default());
    }

    #[test]
    fn decodes_utf16_titles() {
        assert_eq!(decode_pdf_text(&[0xFE, 0xFF, 0x00, 0x48, 0x00, 0x69]), "Hi");
    }
}
