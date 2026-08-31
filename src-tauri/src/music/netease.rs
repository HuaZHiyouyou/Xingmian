use super::{MusicSource, UnifiedSong, PlayUrlResult, SearchResult};
use async_trait::async_trait;
use serde::Deserialize;

pub struct NeteaseMusic {
    client: reqwest::Client,
}

impl NeteaseMusic {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { client }
    }
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResponse {
    code: Option<u64>,
    result: Option<NeteaseSearchResult>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResult {
    songs: Option<Vec<NeteaseSong>>,
    #[serde(rename = "songCount")]
    song_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSong {
    id: u64,
    name: String,
    artists: Option<Vec<NeteaseArtist>>,
    album: Option<NeteaseAlbum>,
    /// 网易云API返回的是 duration（毫秒），不是 dt
    duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct NeteaseArtist {
    #[allow(dead_code)]
    id: Option<u64>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeteaseAlbum {
    #[allow(dead_code)]
    id: Option<u64>,
    name: Option<String>,
    #[serde(rename = "picUrl")]
    pic_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeteasePlayUrlResponse {
    data: Option<Vec<NeteasePlayUrlData>>,
}

#[derive(Debug, Deserialize)]
struct NeteasePlayUrlData {
    url: Option<String>,
    br: Option<u64>,
    size: Option<u64>,
    r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeteaseLyricsResponse {
    #[allow(dead_code)]
    code: Option<u64>,
    lrc: Option<NeteaseLrc>,
    tlyric: Option<NeteaseLrc>,
}

#[derive(Debug, Deserialize)]
struct NeteaseLrc {
    lyric: Option<String>,
}

#[async_trait]
impl MusicSource for NeteaseMusic {
    fn name(&self) -> &str {
        "netease"
    }

    async fn search(&self, keyword: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult> {
        let offset = (page - 1) * page_size;
        let url = format!(
            "https://music.163.com/api/search/get/web?s={}&type=1&offset={}&total=true&limit={}",
            urlencoding::encode(keyword),
            offset,
            page_size
        );

        log::info!("[Netease] searching: keyword={}, page={}, size={}", keyword, page, page_size);

        let resp = self.client
            .get(&url)
            .header("Referer", "https://music.163.com/")
            .send()
            .await?;

        let status = resp.status();
        let body = resp.text().await?;
        log::debug!("[Netease] status={}, body={}", status, &body[..body.len().min(500)]);

        if !status.is_success() {
            anyhow::bail!("网易云搜索HTTP错误: {}", status);
        }

        let search_resp: NeteaseSearchResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        if let Some(code) = search_resp.code {
            if code != 200 {
                anyhow::bail!("网易云API错误码: {}", code);
            }
        }

        let result = search_resp.result.ok_or_else(|| anyhow::anyhow!("网易云：无result字段"))?;
        let total = result.song_count.unwrap_or(0);
        let songs = result.songs.unwrap_or_default();

        log::info!("[Netease] found {} songs, total={}", songs.len(), total);

        // 🆕 修复封面缺失：legacy 搜索端点的 picUrl 常为空，
        //    批量调用官方 song/detail 接口补全封面（一次请求覆盖整页）
        let ids: Vec<String> = songs.iter().map(|s| s.id.to_string()).collect();
        let mut cover_map: std::collections::HashMap<u64, String> = std::collections::HashMap::new();
        if !ids.is_empty() {
            let detail_url = format!("https://music.163.com/api/song/detail?ids=[{}]", ids.join(","));
            if let Ok(detail_resp) = self.client
                .get(&detail_url)
                .header("Referer", "https://music.163.com/")
                .send()
                .await
            {
                if let Ok(detail) = detail_resp.json::<serde_json::Value>().await {
                    if let Some(list) = detail["songs"].as_array() {
                        for s in list {
                            if let (Some(id), Some(pic)) = (
                                s["id"].as_u64(),
                                s["album"]["picUrl"].as_str(),
                            ) {
                                if !pic.is_empty() {
                                    cover_map.insert(id, pic.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut unified_songs = Vec::new();
        for song in songs {
            let artists = song.artists
                .unwrap_or_default()
                .iter()
                .map(|a| a.name.clone().unwrap_or_default())
                .filter(|n| !n.is_empty())
                .collect::<Vec<_>>()
                .join("、");

            let album_name = song.album.as_ref().and_then(|a| a.name.clone());
            // 🆕 封面：detail 批量结果优先（可靠），其次搜索返回的 picUrl
            let cover = cover_map.get(&song.id).cloned().or_else(|| {
                song.album.as_ref()
                    .and_then(|a| a.pic_url.clone())
                    .filter(|url| !url.is_empty())
            });
            // duration 返回的是毫秒，转成秒
            let duration = song.duration.unwrap_or(0) / 1000;

            unified_songs.push(UnifiedSong {
                id: song.id.to_string(),
                title: song.name,
                artist: if artists.is_empty() { "未知艺术家".to_string() } else { artists },
                album: album_name,
                duration,
                platform: "netease".to_string(),
                cover,
                lyrics: None,
            });
        }

        Ok(SearchResult {
            songs: unified_songs,
            has_more: ((page * page_size) as u64) < total,
            total,
        })
    }

    async fn get_play_url(&self, song_id: &str) -> anyhow::Result<PlayUrlResult> {
        // 方案1: 外链跳转
        let outer_url = format!("https://music.163.com/song/media/outer/url?id={}.mp3", song_id);
        let resp = self.client
            .get(&outer_url)
            .header("Referer", "https://music.163.com/")
            .send()
            .await?;

        let final_url = resp.url().to_string();
        if resp.status().is_success() && final_url != outer_url && final_url.starts_with("http") {
            return Ok(PlayUrlResult {
                url: final_url,
                quality: "320kbps".to_string(),
                format: "mp3".to_string(),
                file_size: None,
                needs_proxy: false,
                fallback_urls: vec![],
            });
        }

        // 方案2: API获取
        let api_url = format!(
            "https://music.163.com/api/song/enhance/player/url?ids=[{}]&br=320000",
            song_id
        );
        let resp = self.client
            .get(&api_url)
            .header("Referer", "https://music.163.com/")
            .send()
            .await?;

        let body = resp.text().await?;
        let url_resp: NeteasePlayUrlResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        if let Some(data) = url_resp.data {
            for item in data {
                if let Some(url) = item.url {
                    return Ok(PlayUrlResult {
                        url,
                        quality: format!("{}kbps", item.br.unwrap_or(320) / 1000),
                        format: item.r#type.unwrap_or_else(|| "mp3".to_string()),
                        file_size: item.size,
                        needs_proxy: false,
                        fallback_urls: vec![],
                    });
                }
            }
        }

        anyhow::bail!("网易云：无法获取播放链接")
    }

    async fn get_lyrics(&self, song_id: &str) -> anyhow::Result<Option<String>> {
        let url = format!(
            "https://music.163.com/api/song/lyric?id={}&lv=1&tv=-1",
            song_id
        );

        let resp = self.client
            .get(&url)
            .header("Referer", "https://music.163.com/")
            .send()
            .await?;

        let body = resp.text().await?;
        let lyrics_resp: NeteaseLyricsResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        // 优先翻译歌词，其次原文
        if let Some(tlyric) = lyrics_resp.tlyric {
            if let Some(lyric) = tlyric.lyric {
                if !lyric.is_empty() {
                    return Ok(Some(lyric));
                }
            }
        }
        if let Some(lrc) = lyrics_resp.lrc {
            return Ok(lrc.lyric);
        }
        Ok(None)
    }

    async fn get_cover(&self, song_id: &str, _album_id: Option<&str>) -> anyhow::Result<Option<String>> {
        let url = format!("https://music.163.com/api/song/detail?ids=[{}]", song_id);
        let resp = self.client
            .get(&url)
            .header("Referer", "https://music.163.com/")
            .send()
            .await?;

        let body = resp.text().await?;
        let detail: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        if let Some(songs) = detail["songs"].as_array() {
            if let Some(song) = songs.first() {
                if let Some(pic_url) = song["album"]["picUrl"].as_str() {
                    return Ok(Some(pic_url.to_string()));
                }
            }
        }
        Ok(None)
    }
}
