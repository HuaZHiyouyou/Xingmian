
mod ai;
mod ai_tasks;
mod anti_cliche;
mod bot;
mod chat;
mod cliche_patterns;
mod commands;
mod crypto;
mod db;
mod mcp;
mod music;
mod post_process;

use bot::BotManager;
use std::sync::Arc;
use tauri::Manager;
use tauri::http::{Request as HttpRequest, Response as HttpResponse};

pub struct BotManagerState {
    pub manager: Arc<BotManager>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        // 🆕 D5: Windows 系统通知（窗口失焦时高优先级主动消息走通知）
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol("file-blob", |ctx: tauri::UriSchemeContext<'_, tauri::Wry>, request: HttpRequest<Vec<u8>>, responder: tauri::UriSchemeResponder| {
            // URL 格式: http://file-blob.localhost/<file-id>
            // 直接以二进制流式返回文件内容，绕过 base64/JSON/IPC 的多倍内存搬运，
            // WebView 原生加载（<img>/<video>/<audio> src），并利用 HTTP 缓存。
            let uri_str = request.uri().to_string();
            let id = uri_str
                .split(['/', '?'])
                .rfind(|s| !s.is_empty() && *s != "http:" && *s != "file-blob.localhost" && *s != "file-blob" && *s != "localhost")
                .unwrap_or("")
                .to_string();

            if id.is_empty() {
                let resp = HttpResponse::builder().status(400).body(b"Missing file id".to_vec()).unwrap();
                responder.respond(resp);
                return;
            }

            // 同步读取（Mutex 保护的 SQLite 读取 MB 级数据通常 <10ms），随后立即响应
            let app = ctx.app_handle().clone();
            let result = (|| -> Result<(String, Vec<u8>), String> {
                use tauri::Manager;
                let state = app.state::<db::DbState>();
                let conn = state.conn.lock().map_err(|e| e.to_string())?;
                let mut stmt = conn
                    .prepare("SELECT mime_type, data FROM files WHERE id = ?1")
                    .map_err(|e| e.to_string())?;
                let row = stmt
                    .query_row(rusqlite::params![id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
                    })
                    .map_err(|_| format!("file not found: {}", id))?;
                Ok(row)
            })();

            match result {
                Ok((mime, bytes)) => {
                    log::info!("[file-blob] serve {} ({} bytes, {})", id, bytes.len(), &mime[..mime.len().min(40)]);
                    let resp = HttpResponse::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "private, max-age=86400")
                        .body(bytes)
                        .unwrap();
                    responder.respond(resp);
                }
                Err(e) => {
                    log::warn!("[file-blob] {} : {}", id, e);
                    let resp = HttpResponse::builder().status(404).body(e.into_bytes()).unwrap();
                    responder.respond(resp);
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("music-proxy", |_ctx: tauri::UriSchemeContext<'_, tauri::Wry>, request: HttpRequest<Vec<u8>>, responder: tauri::UriSchemeResponder| {
            // URL 格式: http://music-proxy.localhost/proxy/<percent-encoded-url>
            let uri_str = request.uri().to_string();
            let target_url = if let Some(encoded) = uri_str.strip_prefix("music-proxy://localhost/proxy/") {
                urlencoding::decode(encoded)
                    .unwrap_or_default()
                    .into_owned()
            } else if let Some(encoded) = uri_str.strip_prefix("http://music-proxy.localhost/proxy/") {
                urlencoding::decode(encoded)
                    .unwrap_or_default()
                    .into_owned()
            } else {
                String::new()
            };

            if target_url.is_empty() {
                let resp = HttpResponse::builder()
                    .status(400)
                    .header("Content-Type", "text/plain")
                    .body(b"Invalid or empty proxy URL".to_vec())
                    .unwrap();
                responder.respond(resp);
                return;
            }

            // 🆕 本地文件支持（file:// 或绝对路径）：读取后带 CORS 头返回，
            //    让本地音乐也能安全接入 WebAudio 频谱分析
            let is_local = target_url.starts_with("file://")
                || target_url.starts_with('/')
                || target_url.contains(":\\");
            if is_local {
                let path = target_url
                    .trim_start_matches("file://")
                    .trim_start_matches("file:/")
                    .to_string();
                tauri::async_runtime::spawn(async move {
                    let ext = std::path::Path::new(&path)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("mp3")
                        .to_lowercase();
                    let mime = match ext.as_str() {
                        "flac" => "audio/flac",
                        "wav" => "audio/wav",
                        "ogg" => "audio/ogg",
                        "m4a" => "audio/mp4",
                        "aac" => "audio/aac",
                        _ => "audio/mpeg",
                    };
                    match tokio::fs::read(&path).await {
                        Ok(bytes) => {
                            let resp = HttpResponse::builder()
                                .status(200)
                                .header("Content-Type", mime)
                                .header("Access-Control-Allow-Origin", "*")
                                .header("Accept-Ranges", "bytes")
                                .body(bytes)
                                .unwrap();
                            responder.respond(resp);
                        }
                        Err(e) => {
                            let resp = HttpResponse::builder()
                                .status(404)
                                .header("Content-Type", "text/plain")
                                .body(format!("file read error: {}", e).into_bytes())
                                .unwrap();
                            responder.respond(resp);
                        }
                    }
                });
                return;
            }

            if !target_url.starts_with("http") {
                let resp = HttpResponse::builder()
                    .status(400)
                    .header("Content-Type", "text/plain")
                    .body(b"Invalid or empty proxy URL".to_vec())
                    .unwrap();
                responder.respond(resp);
                return;
            }

            log::info!("[music-proxy] 代理请求: {}", &target_url[..target_url.len().min(120)]);

            // 异步执行 HTTP 请求
            tauri::async_runtime::spawn(async move {
                let result = async {
                    let client = reqwest::Client::builder()
                        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                        .timeout(std::time::Duration::from_secs(30))
                        .build()?;

                    let resp = client.get(&target_url)
                        .header("Referer", "https://music.163.com/")
                        .send()
                        .await?;

                    let status = resp.status().as_u16();
                    let content_type = resp.headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("audio/mpeg")
                        .to_string();

                    log::info!("[music-proxy] 响应状态: {}, Content-Type: {}", status, content_type);

                    let bytes = resp.bytes().await?;

                    Ok::<_, Box<dyn std::error::Error + Send + Sync>>(HttpResponse::builder()
                        .status(status)
                        .header("Content-Type", content_type)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes.to_vec())
                        .unwrap())
                }.await;

                match result {
                    Ok(resp) => responder.respond(resp),
                    Err(e) => {
                        log::error!("[music-proxy] 请求失败: {}", e);
                        let resp = HttpResponse::builder()
                            .status(502)
                            .header("Content-Type", "text/plain")
                            .body(format!("Proxy request failed: {}", e).into_bytes())
                            .unwrap();
                        responder.respond(resp);
                    }
                }
            });
        })
        .setup(|app| {
            db::init_db(app.handle())?;
            let bot_manager = Arc::new(BotManager::new());
            app.manage(BotManagerState {
                manager: bot_manager,
            });
            app.manage(music::commands::MusicState::new());
            // 🆕 MCP 连接管理器 + 启动时自动连接已启用的服务器
            app.manage(mcp::McpManager::new());
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                mcp::auto_connect_all(&app_handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platforms,
            commands::save_platforms,
            commands::get_conversations,
            commands::get_conversations_page,
            commands::get_conversation_messages,
            commands::save_conversations,
            commands::save_conversation,
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
            commands::get_memory_entries_available_dates,
            commands::get_debug_logs_available_dates,
            commands::get_emotion_records_available_dates,
            commands::get_bot_integrations,
            commands::save_bot_integration,
            commands::delete_bot_integration,
            commands::generate_qrcode,
            commands::get_bot_conversations,
            commands::save_bot_conversation,
            commands::delete_bot_conversation,
            commands::start_bot_integration,
            commands::stop_bot_integration,
            commands::send_bot_message,
            commands::send_bot_group_message,
            commands::send_wechat_message,
            commands::send_bot_reply,
            commands::test_bot_connection,
            commands::cleanup_zombie_conversations,
            commands::prune_debug_logs,
            commands::delete_debug_logs_by_ids,
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
            commands::get_ui_config,
            commands::save_ui_config,
            commands::get_ai_diaries,
            commands::save_ai_diary,
            commands::update_ai_diary,
            commands::delete_ai_diary,
            commands::get_ai_activities,
            commands::batch_save_ai_activities,
            commands::delete_ai_activities_by_date,
            commands::get_current_ai_activity,
            commands::update_ai_activity_status,
            commands::get_ai_activities_available_dates,
            commands::batch_save_ai_life_events,
            commands::get_ai_life_events,
            commands::mark_ai_life_events_injected,
            commands::save_ai_content_proposals,
            commands::get_ai_content_proposals,
            commands::decide_ai_content_proposal,
            commands::get_ai_life_config,
            commands::save_ai_life_config,
            commands::get_ai_attributes,
            commands::save_ai_attributes,
            commands::get_ai_inventory,
            commands::save_ai_inventory_items,
            commands::delete_ai_inventory_item,
            commands::get_ai_economy,
            commands::save_ai_economy,
            commands::add_ai_transaction,
            commands::get_ai_transactions,
            commands::get_world_configs,
            commands::save_world_config,
            commands::delete_world_config,
            ai::call_ai,
            ai::call_ai_stream,
            chat::process_message,
            ai_tasks::extract_memories,
            ai_tasks::analyze_character_emotion,
            ai_tasks::analyze_affinity_change,
            ai_tasks::generate_reflection,
            ai_tasks::generate_conversation_summary,
            ai_tasks::generate_thinking,
            ai_tasks::generate_analysis,
            ai_tasks::analyze_message_importance,
            ai_tasks::advise_reply_length,
            post_process::process_post_pipeline,
            music::commands::music_search,
            music::commands::music_get_play_url,
            music::commands::music_get_lyrics,
            music::commands::music_get_cover,
            music::commands::music_get_platforms,
            music::commands::music_resolve_song,
            music::commands::music_proxy_start,
            mcp::mcp_get_servers,
            mcp::mcp_save_server,
            mcp::mcp_delete_server,
            mcp::mcp_connect,
            mcp::mcp_disconnect,
            mcp::mcp_list_tools,
            mcp::mcp_call_tool,
            mcp::mcp_status,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("启动失败: {}", e);
            std::process::exit(1);
        });
}
