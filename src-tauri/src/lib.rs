
mod bot;
mod commands;
mod db;

use bot::BotManager;
use std::sync::Arc;
use tauri::Manager;

pub struct BotManagerState {
    pub manager: Arc<BotManager>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            db::init_db(app.handle())?;
            let bot_manager = Arc::new(BotManager::new());
            app.manage(BotManagerState {
                manager: bot_manager,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platforms,
            commands::save_platforms,
            commands::get_conversations,
            commands::save_conversations,
            commands::delete_conversation,
            commands::get_emotion_records,
            commands::save_emotion_records,
            commands::migrate_from_local_storage,
            commands::get_characters,
            commands::save_characters,
            commands::delete_character,
            commands::get_memories,
            commands::save_memories,
            commands::get_reflections,
            commands::save_reflections,
            commands::clear_all_data,
            commands::clear_conversations,
            commands::clear_emotion_records,
            commands::clear_memories,
            commands::clear_reflections,
            commands::get_memory_entries,
            commands::search_memory_entries,
            commands::save_memory_entries,
            commands::delete_memory_entry,
            commands::clear_memory_entries,
            commands::get_debug_logs,
            commands::save_debug_logs,
            commands::batch_insert_debug_logs,
            commands::delete_debug_logs_by_character,
            commands::delete_debug_logs_by_conversation,
            commands::clear_debug_logs,
            commands::get_character_emotions,
            commands::save_character_emotions,
            commands::get_character_affinities,
            commands::save_character_affinities,
            commands::get_deleted_memory_entries,
            commands::save_deleted_memory_entries,
            commands::clear_deleted_memory_entries,
            commands::get_model_roles,
            commands::save_model_roles,
            commands::pick_files,
            commands::read_file_base64,
            commands::get_memory_entries_page,
            commands::get_debug_logs_page,
            commands::get_debug_logs_count,
            commands::get_bot_integrations,
            commands::save_bot_integration,
            commands::delete_bot_integration,
            commands::get_bot_conversations,
            commands::save_bot_conversation,
            commands::delete_bot_conversation,
            commands::start_bot_integration,
            commands::stop_bot_integration,
            commands::send_bot_message,
            commands::send_bot_group_message,
            commands::send_wechat_message,
            commands::test_bot_connection,
            commands::get_bot_statuses,
            commands::download_and_save_file,
            commands::get_app_data_dir,
            commands::save_file_to_db,
            commands::get_file_from_db,
            commands::get_file_data_only,
            commands::get_files_page,
            commands::delete_file_from_db,
            commands::get_file_stats,
            commands::get_mbti_tests,
            commands::save_mbti_test,
            commands::delete_mbti_test,
            commands::get_user_profile,
            commands::save_user_profile,
            commands::get_backups,
            commands::create_backup,
            commands::get_backup_data,
            commands::delete_backup,
            commands::prune_old_backups,
            commands::get_backup_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
