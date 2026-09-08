use clash_verge_i18n::t;
use std::borrow::Cow;

macro_rules! define_menu {
    ($($field:ident => $const_name:ident, $id:expr, $text:expr),+ $(,)?) => {
        #[derive(Debug)]
        pub struct MenuTexts {
            $(pub $field: Cow<'static, str>,)+
        }

        pub struct MenuIds;

        impl MenuTexts {
            pub fn new() -> Self {
                Self {
                    $($field: t!($text),)+
                }
            }
        }

        impl MenuIds {
            $(pub const $const_name: &'static str = $id;)+
        }
    };
}

define_menu! {
    dashboard => DASHBOARD, "tray_dashboard", "tray.dashboard",
    rule_mode => RULE_MODE, "tray_rule_mode", "tray.ruleMode",
    global_mode => GLOBAL_MODE, "tray_global_mode", "tray.globalMode",
    direct_mode => DIRECT_MODE, "tray_direct_mode", "tray.directMode",
    outbound_modes => OUTBOUND_MODES, "tray_outbound_modes", "tray.outboundModes",
    proxies => PROXIES, "tray_proxies", "tray.proxies",
    system_proxy => SYSTEM_PROXY, "tray_system_proxy", "tray.systemProxy",
    tun_mode => TUN_MODE, "tray_tun_mode", "tray.tunMode",
    exit => EXIT, "tray_exit", "tray.exit",
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum TrayAction {
    SystemProxy,
    TunMode,
    MainWindow,
    TrayMenu,
    Unknown,
}

impl From<&str> for TrayAction {
    fn from(s: &str) -> Self {
        match s {
            "system_proxy" => Self::SystemProxy,
            "tun_mode" => Self::TunMode,
            "main_window" => Self::MainWindow,
            "tray_menu" => Self::TrayMenu,
            _ => Self::Unknown,
        }
    }
}
