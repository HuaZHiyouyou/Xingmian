use crate::music::{MusicManager, UnifiedSong, PlayUrlResult};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

/// 应用全局状态中的音乐管理器
pub struct MusicState {
    pub manager: Arc<MusicManager>,
}

impl MusicState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(MusicManager::new()),
        }
    }
}

/// 搜索请求参数
#[derive(Debug, Deserialize)]
pub struct MusicSearchRequest {
    pub keyword: String,
    pub platform: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// 搜索响应
#[derive(Debug, Serialize)]
pub struct MusicSearchResponse {
    pub songs: Vec<UnifiedSong>,
    pub total: u64,
    pub has_more: bool,
    pub searched_platforms: Vec<String>,
}

/// 播放URL请求
#[derive(Debug, Deserialize)]
pub struct GetPlayUrlRequest {
    pub song_id: String,
    pub platform: String,
}

/// 歌词请求
#[derive(Debug, Deserialize)]
pub struct GetLyricsRequest {
    pub song_id: String,
    pub platform: String,
}

/// 封面请求
#[derive(Debug, Deserialize)]
pub struct GetCoverRequest {
    pub song_id: String,
    pub platform: String,
    pub album_id: Option<String>,
}

/// 搜索音乐（支持多源聚合或单源搜索）
#[tauri::command]
pub async fn music_search(
    state: State<'_, MusicState>,
    request: MusicSearchRequest,
) -> Result<MusicSearchResponse, String> {
    let manager = &state.manager;
    let page = request.page.unwrap_or(1);
    let page_size = request.page_size.unwrap_or(20);

    let (songs, total, has_more, searched_platforms) = if let Some(ref platform) = request.platform {
        // 单源搜索
        match manager.search_single(&request.keyword, platform, page, page_size).await {
            Ok(result) => {
                let total = result.total;
                let has_more = result.has_more;
                (result.songs, total, has_more, vec![platform.clone()])
            }
            Err(e) => {
                log::warn!("搜索平台 {} 失败: {}", platform, e);
                (vec![], 0, false, vec![])
            }
        }
    } else {
        // 多源聚合搜索
        let songs = manager.search_all(&request.keyword, page, page_size).await;
        let total = songs.len() as u64;
        let platforms = manager.available_platforms();
        (songs, total, false, platforms)
    };

    Ok(MusicSearchResponse {
        songs,
        total,
        has_more,
        searched_platforms,
    })
}

/// 获取播放URL（含多源降级）
#[tauri::command]
pub async fn music_get_play_url(
    state: State<'_, MusicState>,
    request: GetPlayUrlRequest,
) -> Result<PlayUrlResult, String> {
    let manager = &state.manager;

    manager
        .get_play_url(&request.song_id, &request.platform)
        .await
        .map_err(|e| format!("获取播放URL失败: {}", e))
}

/// 获取歌词
#[tauri::command]
pub async fn music_get_lyrics(
    state: State<'_, MusicState>,
    request: GetLyricsRequest,
) -> Result<Option<String>, String> {
    let manager = &state.manager;

    manager
        .get_lyrics(&request.song_id, &request.platform)
        .await
        .map_err(|e| format!("获取歌词失败: {}", e))
}

/// 获取封面URL
#[tauri::command]
pub async fn music_get_cover(
    state: State<'_, MusicState>,
    request: GetCoverRequest,
) -> Result<Option<String>, String> {
    let manager = &state.manager;

    manager
        .get_cover(&request.song_id, &request.platform, request.album_id.as_deref())
        .await
        .map_err(|e| format!("获取封面失败: {}", e))
}

/// 获取可用平台列表
#[tauri::command]
pub async fn music_get_platforms(
    state: State<'_, MusicState>,
) -> Result<Vec<String>, String> {
    Ok(state.manager.available_platforms())
}

/// 🆕 启动本地音频流代理（幂等），返回端口。
/// 前端将在线/本地音源统一走 `http://127.0.0.1:{port}/stream?url=...`，
/// 代理注入 CORS 头，使 WebAudio AnalyserNode 可安全分析真实频谱。
#[tauri::command]
pub async fn music_proxy_start() -> Result<u16, String> {
    super::proxy::ensure_proxy_started()
        .await
        .map_err(|e| format!("启动音频代理失败: {}", e))
}

/// 🆕 智能换源解析请求
#[derive(Debug, Deserialize)]
pub struct ResolveSongRequest {
    pub title: String,
    pub artist: Option<String>,
    pub original_platform: String,
    pub original_song_id: String,
    /// 原曲时长（秒），用于模糊匹配加分
    pub duration: Option<u64>,
    /// 备用平台优先级链（缺省 netease→qq→kugou）
    pub fallback_platforms: Option<Vec<String>>,
}

/// 🆕 智能换源解析响应
#[derive(Debug, Serialize)]
pub struct ResolveSongResponse {
    /// 跨平台匹配到的歌曲（None = 原平台直接成功）
    pub matched: Option<UnifiedSong>,
    pub play_url: Option<PlayUrlResult>,
    /// 尝试过的平台（诊断用）
    pub tried: Vec<String>,
}

/// 字符重叠率（0~1）：衡量标题相似度
fn title_similarity(a: &str, b: &str) -> f64 {
    let norm = |s: &str| {
        s.to_lowercase()
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '(' && *c != ')' && *c != '（' && *c != '）')
            .collect::<Vec<_>>()
    };
    let (sa, sb) = (norm(a), norm(b));
    if sa.is_empty() || sb.is_empty() { return 0.0; }
    let mut matched = 0usize;
    let mut sb_used = vec![false; sb.len()];
    for ca in &sa {
        for (j, cb) in sb.iter().enumerate() {
            if !sb_used[j] && ca == cb {
                sb_used[j] = true;
                matched += 1;
                break;
            }
        }
    }
    matched as f64 / sa.len().max(sb.len()) as f64
}

/// 🆕 智能换源解析：原平台失败 → 按优先级链搜索备用平台 →
/// 标题相似度+艺术家+时长模糊匹配 → 取播放地址。
/// 解决"歌源失效需重新搜索替换"与"单平台版权限制"问题。
#[tauri::command]
pub async fn music_resolve_song(
    state: State<'_, MusicState>,
    request: ResolveSongRequest,
) -> Result<ResolveSongResponse, String> {
    let manager = &state.manager;
    let chain = request.fallback_platforms.clone().unwrap_or_else(|| {
        vec!["netease".to_string(), "qq".to_string(), "kugou".to_string()]
    });
    let mut tried: Vec<String> = Vec::new();

    // 1) 原平台直接尝试
    tried.push(request.original_platform.clone());
    if let Ok(r) = manager.get_play_url(&request.original_song_id, &request.original_platform).await {
        if !r.url.is_empty() {
            return Ok(ResolveSongResponse { matched: None, play_url: Some(r), tried });
        }
    }

    // 2) 备用平台链：搜索 → 模糊匹配 → 取 URL
    let query = match request.artist.as_deref() {
        Some(a) if !a.trim().is_empty() => format!("{} {}", request.title.trim(), a.trim()),
        _ => request.title.trim().to_string(),
    };

    for platform in &chain {
        if *platform == request.original_platform { continue; }
        tried.push(platform.clone());
        let search = match manager.search_single(&query, platform, 1, 10).await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[Resolve] 平台 {} 搜索失败: {}", platform, e);
                continue;
            }
        };

        let title_l = request.title.to_lowercase();
        let artist_l = request.artist.clone().unwrap_or_default().to_lowercase();
        let mut best: Option<(f64, &UnifiedSong)> = None;
        for song in &search.songs {
            let mut score = title_similarity(&title_l, &song.title) * 3.0;
            if !artist_l.is_empty() && song.artist.to_lowercase().contains(&artist_l) {
                score += 1.5;
            }
            if let Some(dur) = request.duration {
                if dur > 0 && song.duration > 0 {
                    let diff = (dur as i64 - song.duration as i64).unsigned_abs();
                    if diff <= 5 { score += 1.2; }
                    else if diff <= 15 { score += 0.6; }
                    else if diff > 45 { score -= 1.0; }
                }
            }
            if score >= 2.0
                && best.as_ref().map(|(b, _)| score > *b).unwrap_or(true)
            {
                best = Some((score, song));
            }
        }

        if let Some((_, song)) = best {
            match manager.get_play_url(&song.id, platform).await {
                Ok(r) if !r.url.is_empty() => {
                    log::info!("[Resolve] {} → {} 匹配「{} / {}」", request.original_platform, platform, song.title, song.artist);
                    return Ok(ResolveSongResponse {
                        matched: Some(song.clone()),
                        play_url: Some(r),
                        tried,
                    });
                }
                Ok(_) => { log::warn!("[Resolve] {} 匹配到但URL为空", platform); }
                Err(e) => { log::warn!("[Resolve] {} 取URL失败: {}", platform, e); }
            }
        }
    }

    Ok(ResolveSongResponse { matched: None, play_url: None, tried })
}
