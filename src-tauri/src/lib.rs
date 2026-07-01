const KEYCHAIN_SERVICE: &str = "com.drawassistant.mobile";
const KEYCHAIN_ACCOUNT: &str = "openai-api-key";

#[tauri::command]
fn keychain_set_api_key(key: String) -> Result<(), String> {
  #[cfg(target_vendor = "apple")]
  {
    use security_framework::passwords::{delete_generic_password, set_generic_password};
    if key.is_empty() {
      // Treat clearing as a delete; ignore "not found".
      let _ = delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      return Ok(());
    }
    set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key.as_bytes()).map_err(|e| e.to_string())
  }
  #[cfg(not(target_vendor = "apple"))]
  {
    let _ = key;
    Err("keychain unavailable on this platform".into())
  }
}

#[tauri::command]
fn keychain_get_api_key() -> Result<String, String> {
  #[cfg(target_vendor = "apple")]
  {
    use security_framework::passwords::get_generic_password;
    match get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
      Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
      // Not found (or any read error) -> empty; the frontend falls back to its
      // local store, which is also the migration source on the first native run.
      Err(_) => Ok(String::new()),
    }
  }
  #[cfg(not(target_vendor = "apple"))]
  {
    Err("keychain unavailable on this platform".into())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_deep_link::init())
    .invoke_handler(tauri::generate_handler![keychain_get_api_key, keychain_set_api_key])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
