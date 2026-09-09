use crate::{
    config::{Config, IVerge, MixedPort},
    core::{
        handle,
        notification::{self, FailedOperation},
        proxy_control,
    },
    utils::{
        notification::{NotificationEvent, needs_system_notification, notify_event},
        window_manager::WindowManager,
    },
};
use clash_verge_logging::{Type, logging};
use std::env;
use tauri_plugin_clipboard_manager::ClipboardExt as _;

pub async fn toggle_system_proxy() -> Option<bool> {
    let verge = Config::verge().await;
    let current = verge.latest_arc().enable_system_proxy.unwrap_or(false);
    let auto_close_connection = verge.latest_arc().auto_close_connection.unwrap_or(false);

    if current
        && auto_close_connection
        && let Err(err) = handle::Handle::mihomo().close_all_connections().await
    {
        logging!(error, Type::ProxyMode, "Failed to close all connections: {err}");
    }

    let requested = !current;
    let patch = system_proxy_patch(requested);
    let patch_result =
        notification::asking_for(toggle_operation(requested), Box::pin(super::patch_verge(&patch, false))).await;

    match patch_result {
        Ok(_) => Some(requested),
        Err(err) => {
            logging!(error, Type::ProxyMode, "{err:#}");
            report_toggle_failure(&err).await;
            None
        }
    }
}

fn system_proxy_patch(enabled: bool) -> IVerge {
    IVerge {
        enable_system_proxy: Some(enabled),
        // Every entry point (window, tray, hotkey) shares this transition.
        enable_tun_mode: enabled.then_some(false),
        ..IVerge::default()
    }
}

async fn report_toggle_failure(error: &anyhow::Error) {
    let recorded = proxy_control::is_reportable(error);

    if recorded && needs_system_notification(WindowManager::get_main_window_state()) {
        notify_event(NotificationEvent::SystemProxyFailed).await;
    }
}

const fn toggle_operation(requested: bool) -> FailedOperation {
    if requested {
        FailedOperation::SystemProxyEnable
    } else {
        FailedOperation::SystemProxyDisable
    }
}

pub async fn toggle_tun_mode(not_save_file: Option<bool>) -> bool {
    let current = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
    let enable = !current;
    let patch = tun_mode_patch(enable);

    match super::patch_verge(&patch, not_save_file.unwrap_or(false)).await {
        Ok(_) => {
            handle::Handle::refresh_verge();
            // Reconciliation may immediately disable unavailable TUN; report the resulting state.
            Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false)
        }
        Err(err) => {
            logging!(error, Type::ProxyMode, "{err:#}");
            current
        }
    }
}

fn tun_mode_patch(enabled: bool) -> IVerge {
    IVerge {
        enable_tun_mode: Some(enabled),
        enable_system_proxy: enabled.then_some(false),
        ..IVerge::default()
    }
}

pub async fn copy_clash_env() {
    let env_ip = env::var("CLASH_VERGE_REV_IP").ok();
    let verge_cfg = Config::verge().await.latest_arc();
    let ip = env_ip
        .as_deref()
        .unwrap_or_else(|| verge_cfg.proxy_host.as_deref().unwrap_or("127.0.0.1"));

    let app_handle = handle::Handle::app_handle();
    // Clipboard output must use the core's live port, including merge-config overrides.
    let port = MixedPort::effective().await;
    let http_proxy = format!("http://{ip}:{port}");
    let socks5_proxy = format!("socks5://{ip}:{port}");

    let clipboard = app_handle.clipboard();

    let default_env = {
        #[cfg(not(target_os = "windows"))]
        {
            "bash"
        }
        #[cfg(target_os = "windows")]
        {
            "powershell"
        }
    };
    let env_type = verge_cfg.env_type.as_deref().unwrap_or(default_env);

    let export_text = match env_type {
        "bash" => format!("export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}"),
        "cmd" => format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}"),
        "powershell" => {
            format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"")
        }
        "nushell" => {
            format!("load-env {{ http_proxy: \"{http_proxy}\", https_proxy: \"{http_proxy}\" }}")
        }
        "fish" => format!("set -x http_proxy {http_proxy}; set -x https_proxy {http_proxy}"),
        _ => {
            logging!(error, Type::ProxyMode, "copy_clash_env: Invalid env type! {env_type}");
            return;
        }
    };

    if clipboard.write_text(&export_text).is_err() {
        logging!(error, Type::ProxyMode, "Failed to write to clipboard");
    }
}

#[cfg(test)]
mod tests {
    use super::{system_proxy_patch, tun_mode_patch};

    #[test]
    fn enabling_system_proxy_disables_tun() {
        let patch = system_proxy_patch(true);
        assert_eq!(patch.enable_system_proxy, Some(true));
        assert_eq!(patch.enable_tun_mode, Some(false));
    }

    #[test]
    fn enabling_tun_disables_system_proxy() {
        let patch = tun_mode_patch(true);
        assert_eq!(patch.enable_tun_mode, Some(true));
        assert_eq!(patch.enable_system_proxy, Some(false));
    }

    #[test]
    fn disabling_one_mode_does_not_enable_or_disable_the_other() {
        let system_patch = system_proxy_patch(false);
        assert_eq!(system_patch.enable_tun_mode, None);

        let tun_patch = tun_mode_patch(false);
        assert_eq!(tun_patch.enable_system_proxy, None);
    }
}
