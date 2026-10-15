//! Admin tool for managing the shared catalog list.
//!
//!   cargo run --bin admin -- add <url-or-file> --company Keeneland --date 2026-09-08
//!   cargo run --bin admin -- list --all
//!   cargo run --bin admin -- edit <id> --title "September Yearling Sale, Book 1"
//!   cargo run --bin admin -- unlist <id>

use chrono::NaiveDate;
use clap::{Parser, Subcommand};
use pedigree_server::catalogs::{self, NewCatalog};
use pedigree_server::config::Config;
use pedigree_server::db::{self, CatalogEdit, ListFilter};
use pedigree_server::fetch::Downloaded;
use pedigree_server::AppState;

#[derive(Parser)]
#[command(about = "Manage the shared catalog list")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Add a catalog from a URL or a local PDF file. Listed by default.
    Add {
        source: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        company: Option<String>,
        /// Sale start date, YYYY-MM-DD.
        #[arg(long)]
        date: Option<NaiveDate>,
        /// Store it without showing it in the shared list.
        #[arg(long)]
        unlisted: bool,
    },
    /// Show catalogs. Listed only, unless --all.
    List {
        #[arg(long)]
        all: bool,
    },
    /// Change a catalog's details.
    Edit {
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        company: Option<String>,
        #[arg(long)]
        date: Option<NaiveDate>,
    },
    /// Show a catalog in the shared list.
    #[command(name = "list-catalog")]
    ListCatalog { id: String },
    /// Hide a catalog from the shared list (it stays stored).
    Unlist { id: String },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let state = AppState::init(Config::from_env()?).await?;

    match cli.command {
        Command::Add { source, title, company, date, unlisted } => {
            let meta = NewCatalog {
                title,
                sale_company: company,
                sale_date: date,
                listed: !unlisted,
            };
            let ingested = if source.starts_with("http://") || source.starts_with("https://") {
                catalogs::ingest_url(&state, &source, meta).await?
            } else {
                let dl = Downloaded::from_local_file(source.as_ref(), state.storage.tmp_dir(), state.config.max_pdf_bytes)
                    .await?;
                catalogs::ingest_download(&state, dl, meta).await?
            };
            let verb = if ingested.created { "Added" } else { "Already stored" };
            println!("{verb}:");
            print_row(&ingested.catalog);
        }
        Command::List { all } => {
            let filter = ListFilter { include_unlisted: all, ..Default::default() };
            for c in db::list(&state.pool, &filter).await? {
                print_row(&c);
            }
        }
        Command::Edit { id, title, company, date } => {
            let edit = CatalogEdit { title, sale_company: company, sale_date: date, listed: None };
            edit_and_print(&state, &id, edit).await?;
        }
        Command::ListCatalog { id } => {
            edit_and_print(&state, &id, CatalogEdit { listed: Some(true), ..Default::default() }).await?;
        }
        Command::Unlist { id } => {
            edit_and_print(&state, &id, CatalogEdit { listed: Some(false), ..Default::default() }).await?;
        }
    }
    Ok(())
}

async fn edit_and_print(state: &AppState, id: &str, edit: CatalogEdit) -> anyhow::Result<()> {
    match db::edit(&state.pool, id, &edit).await? {
        Some(c) => print_row(&c),
        None => anyhow::bail!("no catalog with id {id}"),
    }
    Ok(())
}

fn print_row(c: &db::Catalog) {
    println!(
        "{}  {:<8}  {:<10}  {:<14}  {:>4} pages  {}",
        c.id,
        if c.listed { "listed" } else { "unlisted" },
        c.sale_date.map(|d| d.to_string()).unwrap_or_default(),
        c.sale_company.as_deref().unwrap_or(""),
        c.page_count.map(|n| n.to_string()).unwrap_or_else(|| "?".into()),
        c.title,
    );
}
