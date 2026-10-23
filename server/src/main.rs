use pedigree_server::config::Config;
use pedigree_server::{api, AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into()))
        .init();

    let config = Config::from_env()?;
    let bind = config.bind;
    let state = AppState::init(config).await?;

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!("pedigree server listening on http://{bind}");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
