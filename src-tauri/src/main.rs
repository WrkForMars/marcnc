// App de escritorio: la misma interfaz web dentro de una ventana nativa (WebView2 en Windows).
// Sin consola extra en Windows al compilar en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Escribe el código G en la ruta que el usuario eligió en el diálogo de "Guardar como".
#[tauri::command]
fn guardar_texto(ruta: String, texto: String) -> Result<(), String> {
    std::fs::write(&ruta, texto).map_err(|e| format!("{ruta}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![guardar_texto])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar MarCNC");
}
